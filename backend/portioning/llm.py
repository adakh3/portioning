"""One place to call an LLM, whichever supplier serves it.

Every AI task in the app has a Django setting naming its model as
'provider:model' — e.g. 'openai:gpt-5.4-nano' or 'anthropic:claude-haiku-4-5'.
Switching a task to another supplier (or model) is a one-env-var change; no
code changes, no redeploy of anything else. Each provider's API key is its own
env var and only needs to be set if that provider is actually in use.

Current task settings:
    LLM_FOLLOWUP_DRAFTER — the follow-up drafting agent
"""
import json
import logging
import time

from django.conf import settings

logger = logging.getLogger(__name__)

PROVIDER_KEYS = {
    'anthropic': 'ANTHROPIC_API_KEY',
    'openai': 'OPENAI_API_KEY',
}


class LLMError(Exception):
    """The call could not produce a usable structured response."""


class LLMNotConfigured(LLMError):
    """The task's model setting or its provider API key is missing/invalid."""


def resolve(task_setting):
    """Split a task's 'provider:model' setting. Raises LLMNotConfigured."""
    raw = getattr(settings, task_setting, '')
    provider, _, model = raw.partition(':')
    if provider not in PROVIDER_KEYS or not model:
        raise LLMNotConfigured(
            f"{task_setting}={raw!r} — expected 'provider:model' with provider "
            f"one of {sorted(PROVIDER_KEYS)}"
        )
    return provider, model


def is_configured(task_setting):
    """True when the task names a valid model AND its provider key is set."""
    try:
        provider, _ = resolve(task_setting)
    except LLMNotConfigured:
        return False
    return bool(getattr(settings, PROVIDER_KEYS[provider], ''))


def complete_structured(task_setting, system, user_content, schema, max_tokens=1024):
    """Run a completion that must return JSON matching `schema`.

    Returns (data, model_used) where data is the parsed dict and model_used is
    the 'provider:model' string that produced it. Raises LLMError (or the
    provider SDK's own exceptions) on failure — callers decide how to degrade.
    """
    provider, model = resolve(task_setting)
    api_key = getattr(settings, PROVIDER_KEYS[provider], '')
    if not api_key:
        raise LLMNotConfigured(f"{PROVIDER_KEYS[provider]} is not set")

    # Looked up at call time (not a dict frozen at import) so tests can patch
    # the per-provider callers.
    caller = globals()[f'_call_{provider}']
    started = time.monotonic()
    text = caller(model, api_key, system, user_content, schema, max_tokens)
    logger.info(
        "LLM call %s:%s took %.0f ms (in≈%d chars, out≈%d chars)",
        provider, model, (time.monotonic() - started) * 1000,
        len(system) + len(user_content), len(text),
    )
    try:
        data = json.loads(text)
    except (ValueError, TypeError) as exc:
        raise LLMError(f"{provider}:{model} returned unparseable output") from exc
    return data, f"{provider}:{model}"


def _call_anthropic(model, api_key, system, user_content, schema, max_tokens):
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_content}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
    )
    if response.stop_reason == "refusal":
        raise LLMError(f"anthropic:{model} refused the request")
    return next((b.text for b in response.content if b.type == "text"), "")


def _call_openai(model, api_key, system, user_content, schema, max_tokens):
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    kwargs = {}
    if model.startswith('gpt-5'):
        # GPT-5-family models can spend hidden 'reasoning' tokens before
        # answering; drafting a 3-sentence message needs none of that, and the
        # default has changed between 5.x releases — pin it off explicitly.
        kwargs['reasoning_effort'] = 'none'
    response = client.chat.completions.create(
        model=model,
        max_completion_tokens=max_tokens,
        **kwargs,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "structured_response", "strict": True, "schema": schema},
        },
    )
    message = response.choices[0].message
    if getattr(message, 'refusal', None):
        raise LLMError(f"openai:{model} refused the request")
    return message.content or ""
