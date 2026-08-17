"""The generic LLM node helper: prompt + JSON schema -> validated dict.

The one rule for agent LLM calls: **LLM nodes propose, deterministic nodes
dispose.** An LLM node only ever produces a schema-validated structured value; it
never writes to the DB, sends anything, or decides control flow — deterministic
nodes do that with the value it proposed.

``ask_structured`` is that helper. It routes through ``portioning/llm.py`` (the
single LLM entry point — no LangChain chat-model wrappers), validates the response
against the schema, and retries a bounded number of times on a bad response. A
malformed setting / missing key (``LLMNotConfigured``) is a configuration fault,
not a transient one, so it is *not* retried — it surfaces immediately.
"""
import logging

from portioning import llm

from agents.schema import SchemaValidationError, validate_structured

logger = logging.getLogger(__name__)

# One prompt attempt + this many retries. The ticket pins the retry budget at 2,
# i.e. at most three provider calls before a run is declared failed.
MAX_RETRIES = 2


class AskStructuredError(Exception):
    """Every attempt to get a schema-valid structured response failed.

    ``attempts`` is the total number of provider calls made (retries + 1), so
    callers/tests can assert the retry budget was spent exactly.
    """

    def __init__(self, message, attempts):
        super().__init__(message)
        self.attempts = attempts


def ask_structured(*, task_setting, system, user_content, schema, max_retries=MAX_RETRIES):
    """Return ``(data, model_used, attempts)`` for a schema-valid LLM response.

    Retries up to ``max_retries`` times on an unparseable or off-schema response.
    Raises :class:`AskStructuredError` once the budget is spent. Propagates
    ``LLMNotConfigured`` unretried (a config fault, not a transient one).
    """
    last_error = None
    attempts = 0
    for attempt in range(max_retries + 1):
        attempts = attempt + 1
        try:
            data, model_used = llm.complete_structured(task_setting, system, user_content, schema)
            validate_structured(data, schema)
            return data, model_used, attempts
        except llm.LLMNotConfigured:
            raise
        except (llm.LLMError, SchemaValidationError) as exc:
            last_error = exc
            logger.info("ask_structured attempt %d/%d failed: %s", attempts, max_retries + 1, exc)
    raise AskStructuredError(str(last_error), attempts=attempts) from last_error
