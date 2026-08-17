"""Checkpointer factory: selection logic (AC6) and the sqlite build path.

The Postgres saver can't be built locally (dev has no libpq), so we test the
*selection* — the pure seam — plus that ``make_checkpointer`` delegates to the
Postgres builder under a Postgres engine, with that builder patched out.
"""
import sqlite3
import tempfile
from unittest.mock import patch

from django.test import SimpleTestCase

from agents import checkpointer as cp
from langgraph.checkpoint.sqlite import SqliteSaver

SQLITE_ENGINE = 'django.db.backends.sqlite3'
POSTGRES_ENGINE = 'django.db.backends.postgresql'


class CheckpointerKindTests(SimpleTestCase):
    def test_sqlite_engine_selects_sqlite(self):
        self.assertEqual(cp.checkpointer_kind(SQLITE_ENGINE), cp.SQLITE)

    def test_postgres_engine_selects_postgres(self):
        self.assertEqual(cp.checkpointer_kind(POSTGRES_ENGINE), cp.POSTGRES)

    def test_non_sqlite_engine_selects_postgres(self):
        # Anything that is not sqlite is treated as Postgres (prod's engine).
        self.assertEqual(cp.checkpointer_kind('django.db.backends.mysql'), cp.POSTGRES)


class ThreadKeyTests(SimpleTestCase):
    def test_thread_key_convention(self):
        self.assertEqual(cp.thread_key('skeleton', 7, 42), 'skeleton:7:42')


class MakeCheckpointerTests(SimpleTestCase):
    def test_sqlite_engine_builds_sqlite_saver_over_given_path(self):
        with tempfile.NamedTemporaryFile(suffix='.sqlite3') as tmp:
            saver = cp.make_checkpointer(engine=SQLITE_ENGINE, sqlite_path=tmp.name)
            try:
                self.assertIsInstance(saver, SqliteSaver)
                # setup() ran: the checkpoints table exists in the file.
                conn = sqlite3.connect(tmp.name)
                names = {r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )}
                conn.close()
                self.assertIn('checkpoints', names)
            finally:
                saver.conn.close()

    def test_postgres_engine_delegates_to_postgres_builder(self):
        sentinel = object()
        with patch.object(cp, '_make_postgres_saver', return_value=sentinel) as mk:
            result = cp.make_checkpointer(engine=POSTGRES_ENGINE)
        self.assertIs(result, sentinel)
        mk.assert_called_once()
