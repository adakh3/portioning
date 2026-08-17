"""LangSmith tracing plumbing for agent runs — dev/eval only, opt-in (REL-511).

LangGraph auto-traces to LangSmith when the LangChain tracing env vars are set.
We do **not** want that on by default: LangSmith is a third-party SaaS and agent
traces carry org customer data (lead names, message content). So tracing is:

* **off unless** ``LANGSMITH_TRACING`` is explicitly truthy *and* a key is present,
* configured only through env (no keys in the repo), and
* never enabled in CI or DigitalOcean prod (those environments set none of it).

``configure_tracing()`` is the single seam the runner calls before invoking a
graph, and **our toggle is authoritative** — off means off. LangGraph's tracer
keys off ``LANGCHAIN_TRACING_V2`` / ``LANGSMITH_TRACING`` in the *process* env, so
a no-op disabled path would let a developer's globally-exported LangChain env
silently ship lead data to LangSmith even though our flag is unset. So when
disabled we actively set those flags to ``'false'`` (neutralizing inherited env),
guaranteeing no trace and no LangSmith network call (AC2). When enabled we export
the env the tracer reads. Idempotent either way.
"""
import os

from django.conf import settings


def is_tracing_enabled():
    """True only when tracing is explicitly switched on *and* a key is present.

    Both are required: the flag alone with no key can't authenticate, and a key
    alone must not silently start shipping traces. This is the unit-tested toggle
    (AC5) — prod sets neither, so it is off there by construction.
    """
    return bool(getattr(settings, 'LANGSMITH_TRACING', False)) and bool(
        getattr(settings, 'LANGSMITH_API_KEY', '')
    )


def configure_tracing():
    """Export LangSmith env for LangGraph's tracer iff tracing is enabled.

    Returns True when tracing was turned on for this process, False otherwise.
    When disabled it *forces* the tracer off (see module docstring) — our toggle
    wins over any inherited LangChain/LangSmith env, the guarantee behind AC2.
    """
    if not is_tracing_enabled():
        # Authoritative off: neutralize any tracing env the operator's shell may
        # have exported for other LangChain projects, so agent runs never trace
        # unless *our* flag is explicitly set.
        os.environ['LANGCHAIN_TRACING_V2'] = 'false'
        os.environ['LANGSMITH_TRACING'] = 'false'
        return False
    # LangChain reads these at trace time. Set both the legacy and current flag
    # names so the tracer turns on regardless of langchain-core version.
    os.environ['LANGCHAIN_TRACING_V2'] = 'true'
    os.environ['LANGSMITH_TRACING'] = 'true'
    os.environ['LANGCHAIN_API_KEY'] = settings.LANGSMITH_API_KEY
    os.environ['LANGSMITH_API_KEY'] = settings.LANGSMITH_API_KEY
    os.environ['LANGCHAIN_PROJECT'] = settings.LANGSMITH_PROJECT
    os.environ['LANGSMITH_PROJECT'] = settings.LANGSMITH_PROJECT
    os.environ['LANGCHAIN_ENDPOINT'] = settings.LANGSMITH_ENDPOINT
    os.environ['LANGSMITH_ENDPOINT'] = settings.LANGSMITH_ENDPOINT
    return True
