"""Starter choice-option defaults for a new organisation.

Mainstream-US catering vocabulary so a fresh org's Event Type / Source /
Service Style / Meal Type dropdowns are usable on day one instead of empty.
Every option is fully editable and removable in Settings → these are only a
sensible starting point, seeded once at org creation (and backfillable for
existing orgs via `manage.py seed_org_choices`). All seeding is idempotent:
keyed on (organisation, value), so re-running never duplicates or overwrites
an org's own edits.
"""

# (value, label) — value is the stored key, label is what users see/edit.
EVENT_TYPE_DEFAULTS = [
    ('wedding', 'Wedding'),
    ('corporate', 'Corporate Event'),
    ('birthday', 'Birthday Party'),
    ('anniversary', 'Anniversary'),
    ('baby_shower', 'Baby Shower'),
    ('bridal_shower', 'Bridal Shower'),
    ('graduation', 'Graduation'),
    ('holiday_party', 'Holiday Party'),
    ('fundraiser', 'Fundraiser / Gala'),
    ('cocktail', 'Cocktail Party'),
    ('memorial', 'Memorial'),
    ('other', 'Other'),
]

SOURCE_DEFAULTS = [
    ('website', 'Website'),
    ('referral', 'Referral'),
    ('google', 'Google Search'),
    ('instagram', 'Instagram'),
    ('facebook', 'Facebook'),
    ('yelp', 'Yelp'),
    ('repeat', 'Repeat Customer'),
    ('other', 'Other'),
]

SERVICE_STYLE_DEFAULTS = [
    ('buffet', 'Buffet'),
    ('plated', 'Plated'),
    ('family', 'Family Style'),
    ('stations', 'Food Stations'),
    ('passed', 'Passed Hors d’oeuvres'),
    ('dropoff', 'Drop-off / Delivery'),
]

MEAL_TYPE_DEFAULTS = [
    ('breakfast', 'Breakfast'),
    ('brunch', 'Brunch'),
    ('lunch', 'Lunch'),
    ('dinner', 'Dinner'),
    ('cocktail', 'Cocktail / Appetizers'),
]


def seed_choice_defaults(org, only_if_empty=False):
    """Seed the non-workflow choice dropdowns for one org.

    Idempotent — get_or_create keyed on (org, value) never overwrites an
    org's own edits. With ``only_if_empty=True`` (the backfill path), a
    choice type is seeded ONLY when the org has none of it yet, so an org
    that curated its list — including deleting a default — is left alone.
    New orgs (signal path) start empty, so the default seeds everything.
    """
    from bookings.models.choices import (
        EventTypeOption, SourceOption, ServiceStyleOption, MealTypeOption,
    )
    for model, rows in (
        (EventTypeOption, EVENT_TYPE_DEFAULTS),
        (SourceOption, SOURCE_DEFAULTS),
        (ServiceStyleOption, SERVICE_STYLE_DEFAULTS),
        (MealTypeOption, MEAL_TYPE_DEFAULTS),
    ):
        if only_if_empty and model.objects.filter(organisation=org).exists():
            continue
        for sort_order, (value, label) in enumerate(rows):
            model.objects.get_or_create(
                organisation=org,
                value=value,
                defaults={'label': label, 'sort_order': sort_order},
            )
