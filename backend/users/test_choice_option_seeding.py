"""A new org's choice dropdowns must not contain duplicate labels.

`seed_starter_catalog` used to seed its own event types / meal types / service
styles / sources on top of the ones `bookings.defaults.seed_choice_defaults`
already owns — with *different slugs for the same label*. Both run when an
Organisation is created, so every new org shipped with dropdowns showing
"Family Style" twice, "Drop-off / Delivery" twice and "Holiday Party" twice.

Worse than cosmetic: the two entries store different values, so whichever the
user happened to pick split the same real-world choice across two slugs for
filtering, grouping and reporting.

`bookings/defaults.py` is the documented single source of truth for these
(CLAUDE.md), so the catalog seeder no longer seeds them at all.
"""
from collections import Counter

from django.test import TestCase

from bookings.models.choices import (
    EventTypeOption, MealTypeOption, ServiceStyleOption, SourceOption,
)
from users.models import Organisation


class ChoiceOptionSeedingTests(TestCase):
    def setUp(self):
        # The post_save signal seeds the choice defaults (and the starter catalog).
        self.org = Organisation.objects.create(name='Fresh Co', slug='fresh-co')

    def _labels(self, model):
        return [o.label for o in model.objects.filter(organisation=self.org)]

    def test_no_choice_type_has_duplicate_labels(self):
        for model in (EventTypeOption, MealTypeOption, ServiceStyleOption, SourceOption):
            labels = self._labels(model)
            dupes = {label: n for label, n in Counter(labels).items() if n > 1}
            self.assertEqual(
                dupes, {},
                f'{model.__name__} seeded duplicate labels for a new org: {dupes}',
            )

    def test_no_choice_type_has_duplicate_values(self):
        for model in (EventTypeOption, MealTypeOption, ServiceStyleOption, SourceOption):
            values = [o.value for o in model.objects.filter(organisation=self.org)]
            self.assertEqual(len(values), len(set(values)), f'{model.__name__} duplicate values')

    def test_the_dropdowns_are_still_populated(self):
        # Guard the fix from the other direction: removing the catalog seeder must
        # not leave a new org with empty pickers.
        for model in (EventTypeOption, MealTypeOption, ServiceStyleOption, SourceOption):
            self.assertGreater(
                len(self._labels(model)), 0,
                f'{model.__name__} left empty for a new org',
            )

    def test_the_service_styles_are_the_documented_defaults(self):
        self.assertIn('Family Style', self._labels(ServiceStyleOption))
        values = {o.value for o in ServiceStyleOption.objects.filter(organisation=self.org)}
        self.assertIn('family', values)         # bookings/defaults.py owns the slug
        self.assertNotIn('family_style', values)  # the catalog seeder's rival slug
