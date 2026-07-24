from django.test import TestCase


class CIDrillTests(TestCase):
    """DELIBERATE FAILURE — proves the backend required check goes red (REL-360 AC1).
    Throwaway; never merged."""

    def test_deliberate_failure(self):
        self.assertEqual(1, 2, "intentional CI drill failure")
