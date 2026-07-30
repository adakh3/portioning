"""REL-416 AC6 — `migrate` then `loaddata seed.json` stays clean.

The hazard this pins: `DietaryTag` is created by a data migration AND dumped into
`seed.json` (it lives in the `dishes` app, which the documented dumpdata command
covers). If those two ever disagree about primary keys, the dev seed cycle blows
up on a unique-slug conflict — the kind of break that only shows on a fresh clone.
"""
from django.conf import settings
from django.core.management import call_command
from django.test import TestCase

from dishes.models import DietaryTag


class SeedCycleTests(TestCase):
    def test_loaddata_over_a_migrated_database_is_clean(self):
        # The test DB has already been migrated, so the vocabulary is present —
        # exactly the state a dev is in when they run loaddata.
        before = set(DietaryTag.objects.values_list('slug', flat=True))
        self.assertTrue(before, 'the data migration should have seeded the vocabulary')

        call_command('loaddata', str(settings.BASE_DIR / 'seed.json'), verbosity=0)

        # No duplicate slugs — the fixture overwrote the migration's rows in place
        # rather than inserting a second copy of each tag.
        self.assertEqual(
            DietaryTag.objects.count(),
            DietaryTag.objects.values('slug').distinct().count(),
        )
        self.assertEqual(set(DietaryTag.objects.values_list('slug', flat=True)), before)

    def test_seed_file_carries_the_vocabulary(self):
        # If a future regeneration drops these rows, a dev who seeds from the
        # fixture alone would get dishes pointing at tags that don't exist.
        import json
        with open(settings.BASE_DIR / 'seed.json') as fh:
            rows = json.load(fh)
        slugs = {r['fields']['slug'] for r in rows if r['model'] == 'dishes.dietarytag'}
        self.assertEqual(slugs, set(DietaryTag.objects.values_list('slug', flat=True)))
