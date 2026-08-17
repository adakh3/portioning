"""Checkpointer factory: pick the LangGraph saver that matches the live DB.

LangGraph persists a graph's typed state at every super-step to a *checkpointer*,
which is what lets a run pause at a human-in-the-loop interrupt and resume later
— even in a brand-new process. We use SQLite in dev and Postgres in prod, so the
saver has to follow the database:

* dev (SQLite engine)  -> ``SqliteSaver`` over a dedicated checkpoint file
* prod (anything else) -> ``PostgresSaver`` over the app's ``DATABASE_URL``

The selection logic (:func:`checkpointer_kind`) is a pure function so it can be
unit-tested without a real Postgres — the Postgres saver itself is upstream-tested
and can't be exercised locally (dev has no libpq). The Postgres import is lazy for
the same reason: importing it on a dev box (no ``psycopg`` binary) would explode,
and dev never takes that branch.

Thread-key convention (the checkpointer's ``thread_id``):  ``"{agent}:{org_id}:{record_id}"``
built by :func:`thread_key`.
"""
import sqlite3

from django.conf import settings

from langgraph.checkpoint.sqlite import SqliteSaver

SQLITE = 'sqlite'
POSTGRES = 'postgres'


def thread_key(agent, org_id, record_id):
    """The canonical checkpoint thread id for a run. Also the AgentThread key."""
    return f"{agent}:{org_id}:{record_id}"


def checkpointer_kind(engine):
    """Map a Django DB ``ENGINE`` string to the saver we use for it.

    Pure and side-effect free — this is the unit-tested selection seam (AC6).
    """
    return SQLITE if 'sqlite' in engine else POSTGRES


def _default_engine():
    return settings.DATABASES['default']['ENGINE']


def make_checkpointer(*, engine=None, sqlite_path=None):
    """Build the saver for the configured (or given) DB engine.

    ``engine``/``sqlite_path`` are injectable so tests can force a kind and an
    isolated checkpoint file. Callers own the saver's lifetime: the SQLite saver
    holds an open connection, so close it (or use it as a context manager) when a
    long-lived process is done. Graph runs are short, so the runner builds one
    per invocation.
    """
    kind = checkpointer_kind(engine or _default_engine())
    if kind == SQLITE:
        path = sqlite_path or getattr(
            settings, 'AGENT_CHECKPOINT_DB', str(settings.BASE_DIR / 'agent_checkpoints.sqlite3')
        )
        conn = sqlite3.connect(path, check_same_thread=False)
        saver = SqliteSaver(conn)
        saver.setup()
        return saver
    return _make_postgres_saver()


def _make_postgres_saver():
    """Lazily construct the Postgres saver. Imported here (not at module top) so
    a dev box without libpq never trips over the import — dev is always SQLite."""
    from langgraph.checkpoint.postgres import PostgresSaver

    conn_string = settings.DATABASES['default'].get('CONN_STRING') or _postgres_conn_string()
    saver = PostgresSaver.from_conn_string(conn_string).__enter__()
    saver.setup()
    return saver


def _postgres_conn_string():
    db = settings.DATABASES['default']
    user = db.get('USER', '')
    password = db.get('PASSWORD', '')
    host = db.get('HOST', '') or 'localhost'
    port = db.get('PORT', '') or '5432'
    name = db.get('NAME', '')
    auth = user + (f":{password}" if password else '')
    auth = f"{auth}@" if auth else ''
    return f"postgresql://{auth}{host}:{port}/{name}"
