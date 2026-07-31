"""Dietary & allergen tags on dishes (REL-416).

Traced to the ticket's acceptance criteria:
  AC1 — the fixed vocabulary exists after `migrate` (data migration, not seed.json)
  AC2 — a dish can carry several tags; DishSerializer exposes them additively
  AC3 — tags appear wherever the dish is displayed: menu, quote PDF, event PDF, sign page
  AC4 — an untagged dish renders exactly as it did before this slice
  AC5 — tagging a dish in one org leaves another org's dishes alone
  AC6 — is covered by `test_seed_cycle.py` (migrate → loaddata seed.json)
"""
import datetime
import io
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import BookingLineItem
from bookings.pdf import generate_event_pdf, generate_quote_pdf
from bookings.services.presentation import booking_presentation
from bookings.tests import _make_org, make_contact, make_quote
from dishes.labels import dietary_suffix
from dishes.models import DietaryTag, DietaryTagKind, Dish
from dishes.serializers import DishSerializer
from dishes.tests import make_dish
from events.models import BookingMeal, Event
from tests.base import get_test_user

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - pypdf is a declared dependency
    HAVE_PYPDF = False


def tag(slug):
    return DietaryTag.objects.get(slug=slug)


def pdf_text(data):
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() for page in reader.pages)


# ── AC1 — the vocabulary ships with the schema ──────────────────────────────

class DietaryTagVocabularyTests(TestCase):
    """AC1: a fresh database has the fixed vocabulary, because a data migration
    seeds it — prod never loads seed.json."""

    DIETARY = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'halal', 'kosher']
    FDA_ALLERGENS = ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts',
                     'peanuts', 'wheat', 'soy', 'sesame']

    def test_dietary_slugs_present(self):
        found = set(DietaryTag.objects.filter(kind=DietaryTagKind.DIETARY)
                    .values_list('slug', flat=True))
        self.assertEqual(found, set(self.DIETARY))

    def test_all_nine_fda_allergens_present(self):
        found = set(DietaryTag.objects.filter(kind=DietaryTagKind.ALLERGEN)
                    .values_list('slug', flat=True))
        self.assertEqual(found, set(self.FDA_ALLERGENS))

    def test_every_tag_has_a_display_label_and_badge(self):
        for t in DietaryTag.objects.all():
            self.assertTrue(t.label, f'{t.slug} has no label')
            self.assertTrue(t.badge, f'{t.slug} has no badge text')

    def test_reseeding_is_idempotent_and_keeps_edits(self):
        # The migration keys on slug, so re-running it neither duplicates rows
        # nor overwrites a label an org has since adjusted.
        import importlib
        migration = importlib.import_module(
            'dishes.migrations.0007_dietarytag_dish_dietary_tags')

        gf = tag('gluten_free')
        gf.label = 'GF (house standard)'
        gf.save()
        before = DietaryTag.objects.count()

        class _Apps:
            @staticmethod
            def get_model(app_label, model_name):
                return DietaryTag

        migration.seed_dietary_tags(_Apps, None)

        self.assertEqual(DietaryTag.objects.count(), before)
        self.assertEqual(tag('gluten_free').label, 'GF (house standard)')

    def test_tag_is_global_not_org_scoped(self):
        # Deliberate: the vocabulary is a universal standard, so there is no
        # `organisation` column and `block_cross_org_m2m` correctly skips it.
        field_names = {f.name for f in DietaryTag._meta.get_fields()}
        self.assertNotIn('organisation', field_names)


# ── AC2 — tagging a dish, and the serializer ────────────────────────────────

class DishTaggingTests(TestCase):
    """AC2: a dish carries several tags and the serializer exposes them."""

    def setUp(self):
        self.org = _make_org(slug='tag-org')
        self.dish = make_dish(org=self.org, name='Grilled Chicken')

    def test_dish_carries_several_tags(self):
        self.dish.dietary_tags.set([tag('gluten_free'), tag('vegan')])
        self.assertEqual(
            set(self.dish.dietary_tags.values_list('slug', flat=True)),
            {'gluten_free', 'vegan'},
        )

    def test_serializer_returns_tags(self):
        self.dish.dietary_tags.set([tag('gluten_free'), tag('milk')])
        data = DishSerializer(self.dish).data
        by_slug = {t['slug']: t for t in data['dietary_tags']}
        self.assertEqual(set(by_slug), {'gluten_free', 'milk'})
        self.assertEqual(by_slug['gluten_free']['short_label'], 'GF')
        self.assertEqual(by_slug['gluten_free']['kind'], 'dietary')
        self.assertEqual(by_slug['milk']['kind'], 'allergen')

    def test_tags_are_read_only_over_the_api(self):
        # Tags are curated in Django admin (AC2); `dishes/urls.py` exposes only a
        # list endpoint, so the serializer deliberately offers no write path.
        self.assertNotIn('dietary_tag_ids', DishSerializer().fields)
        self.assertTrue(DishSerializer().fields['dietary_tags'].read_only)

    def test_serializer_lists_dietary_tags_before_allergens(self):
        # A dish reads as what it IS first, then what it contains. Alphabetical
        # ordering on `kind` would put 'allergen' first, which reads backwards.
        self.dish.dietary_tags.set([tag('milk'), tag('gluten_free'), tag('wheat')])
        kinds = [t['kind'] for t in DishSerializer(self.dish).data['dietary_tags']]
        self.assertEqual(kinds, ['dietary', 'allergen', 'allergen'])

    def test_untagged_dish_serializes_to_an_empty_list(self):
        # AC4 at the serializer: additive, so an untagged dish gains a field but
        # never any content.
        self.assertEqual(DishSerializer(self.dish).data['dietary_tags'], [])

    def test_dish_list_endpoint_returns_tags(self):
        user = get_test_user()
        dish = make_dish(org=user.organisation, name='Tagged Dish')
        dish.dietary_tags.set([tag('gluten_free')])
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.get('/api/dishes/')
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        rows = rows['results'] if isinstance(rows, dict) else rows
        row = next(r for r in rows if r['name'] == 'Tagged Dish')
        self.assertEqual([t['slug'] for t in row['dietary_tags']], ['gluten_free'])

    def test_dish_list_query_count_does_not_grow_with_dish_count(self):
        # The serializer nests tags, so the view must prefetch them — otherwise
        # the dish list costs one extra query per dish. Compare two list calls
        # rather than pinning an absolute number, so unrelated middleware
        # queries don't make this brittle.
        user = get_test_user()
        client = APIClient()
        client.force_authenticate(user=user)

        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        category = make_dish(org=user.organisation, name='Seed Dish').category

        def queries_for(n_dishes):
            Dish.objects.for_org(user.organisation).delete()
            for i in range(n_dishes):
                d = make_dish(category=category, name=f'Dish {i}')
                d.dietary_tags.set([tag('vegan'), tag('soy')])
            with CaptureQueriesContext(connection) as cap:
                client.get('/api/dishes/')
            return len(cap)

        self.assertEqual(queries_for(2), queries_for(8))


# ── The phrasing helper: dietary reads as "is", allergens as "contains" ─────

class DietarySuffixTests(TestCase):
    def test_no_tags_is_empty_string(self):
        # This is what makes AC4 hold everywhere — the suffix is the only thing
        # appended to a dish name, and for an untagged dish it is nothing at all.
        self.assertEqual(dietary_suffix([]), '')

    def test_dietary_only(self):
        self.assertEqual(
            dietary_suffix([tag('gluten_free'), tag('dairy_free')]),
            ' (GF, DF)',
        )

    def test_allergens_only(self):
        self.assertEqual(
            dietary_suffix([tag('milk'), tag('peanuts')]),
            ' (contains milk, peanuts)',
        )

    def test_both_kinds(self):
        self.assertEqual(
            dietary_suffix([tag('vegan'), tag('tree_nuts')]),
            ' (VG; contains tree nuts)',
        )


# ── AC3 / AC4 — every display surface, tagged and untagged ─────────────────

class MenuDisplayTests(TestCase):
    """AC3: tags show in the menu the client sees. AC4: untagged is unchanged."""

    def setUp(self):
        self.org = _make_org(slug='menu-display')
        self.contact = make_contact(org=self.org)
        self.quote = make_quote(org=self.org, primary_contact=self.contact,
                                guest_count=10, price_per_head=Decimal('20'))
        self.quote.refresh_from_db()  # event_date arrives as a str from the factory
        self.tagged = make_dish(org=self.org, name='Chicken Tikka')
        self.plain = make_dish(org=self.org, category=self.tagged.category,
                               name='Steamed Rice')
        self.tagged.dietary_tags.set([tag('gluten_free'), tag('milk')])
        self.quote.dishes.set([self.tagged, self.plain])

    def test_flat_menu_shows_tags_on_the_tagged_dish_only(self):
        pres = booking_presentation(self.quote)
        self.assertIn('Chicken Tikka (GF; contains milk)', pres['menu_flat'])
        # AC4: the untagged dish is its bare name — no empty parens, no change.
        self.assertIn('Steamed Rice', pres['menu_flat'])
        self.assertNotIn('Steamed Rice ', ''.join(pres['menu_flat']))

    def test_grouped_menu_shows_tags(self):
        pres = booking_presentation(self.quote)
        items = [i for group in pres['menu'] for i in group['items']]
        self.assertIn('Chicken Tikka (GF; contains milk)', items)
        self.assertIn('Steamed Rice', items)

    def test_additional_meal_menu_shows_tags(self):
        meal = BookingMeal.objects.create(quote=self.quote, label='Hi-Tea',
                                          guest_count=10, price_per_head=Decimal('5'))
        meal.dishes.set([self.tagged])
        pres = booking_presentation(self.quote)
        self.assertEqual(pres['additional_meals'][0]['items'],
                         ['Chicken Tikka (GF; contains milk)'])

    def test_untagged_booking_menu_is_unchanged(self):
        # AC4 in full: with no dish tagged at all, the presentation is exactly
        # the plain dish names it always was.
        self.tagged.dietary_tags.clear()
        pres = booking_presentation(self.quote)
        self.assertEqual(sorted(pres['menu_flat']), ['Chicken Tikka', 'Steamed Rice'])

    def test_public_sign_page_payload_shows_tags(self):
        from bookings.views.public_sign import serialize_public_booking
        payload = serialize_public_booking(self.quote)
        items = [i for group in payload['menu'] for i in group['items']]
        self.assertIn('Chicken Tikka (GF; contains milk)', items)


class QuotePDFDietaryTagTests(TestCase):
    """AC3/AC4 on the customer-facing quote PDF — rendered and extracted."""

    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest('pypdf not installed')
        self.org = _make_org(slug='pdf-tags')
        self.contact = make_contact(org=self.org)
        self.quote = make_quote(org=self.org, primary_contact=self.contact,
                                guest_count=10, price_per_head=Decimal('20'))
        self.dish = make_dish(org=self.org, name='Chicken Tikka')
        self.quote.dishes.set([self.dish])
        self.quote.recalculate_totals()
        self.quote.refresh_from_db()

    def test_tags_render_in_the_menu(self):
        self.dish.dietary_tags.set([tag('gluten_free'), tag('peanuts')])
        text = pdf_text(generate_quote_pdf(self.quote))
        self.assertIn('Chicken Tikka (GF; contains peanuts)', text.replace('\n', ' '))

    def test_untagged_dish_prints_its_bare_name(self):
        text = pdf_text(generate_quote_pdf(self.quote))
        self.assertIn('Chicken Tikka', text)
        self.assertNotIn('Chicken Tikka (', text.replace('\n', ' '))

    def test_additional_meal_menu_shows_tags(self):
        self.dish.dietary_tags.set([tag('vegan')])
        meal = BookingMeal.objects.create(quote=self.quote, label='Hi-Tea',
                                          guest_count=10, price_per_head=Decimal('5'))
        meal.dishes.set([self.dish])
        text = pdf_text(generate_quote_pdf(self.quote)).replace('\n', ' ')
        self.assertIn('ADDITIONAL MEALS', text)
        self.assertIn('Chicken Tikka (VG)', text)


class EventPDFDietaryTagTests(TestCase):
    """The event mirror of the quote PDF test — the function sheet must show the
    same tags, or the kitchen works from a menu the client never saw."""

    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest('pypdf not installed')
        self.org = _make_org(slug='event-pdf-tags')
        self.event = Event.objects.create(
            organisation=self.org, name='Khan Wedding',
            event_date=datetime.date(2026, 8, 1), guest_count=50,
            price_per_head=Decimal('40'), status='confirmed',
        )
        BookingLineItem.objects.create(
            event=self.event, category='labor', description='Waiters',
            quantity=Decimal('2'), unit='each', unit_price=Decimal('100'),
        )
        self.dish = make_dish(org=self.org, name='Baked Salmon')
        self.event.dishes.set([self.dish])
        self.event.recalculate_totals()

    def test_tags_render_in_the_menu(self):
        self.dish.dietary_tags.set([tag('dairy_free'), tag('fish')])
        text = pdf_text(generate_event_pdf(self.event)).replace('\n', ' ')
        self.assertIn('Baked Salmon (DF; contains fish)', text)

    def test_untagged_dish_prints_its_bare_name(self):
        text = pdf_text(generate_event_pdf(self.event)).replace('\n', ' ')
        self.assertIn('Baked Salmon', text)
        self.assertNotIn('Baked Salmon (', text)


# ── AC5 — org isolation ─────────────────────────────────────────────────────

class DietaryTagOrgIsolationTests(TestCase):
    """AC5: the vocabulary is shared, the tagging is not."""

    def setUp(self):
        self.org_a = _make_org(name='Org A', slug='tags-org-a')
        self.org_b = _make_org(name='Org B', slug='tags-org-b')
        self.dish_a = make_dish(org=self.org_a, name='A Dish')
        self.dish_b = make_dish(org=self.org_b, name='B Dish')

    def test_tagging_one_org_leaves_the_other_untouched(self):
        self.dish_a.dietary_tags.set([tag('gluten_free')])
        self.assertEqual(list(self.dish_b.dietary_tags.all()), [])

    def test_both_orgs_share_one_vocabulary(self):
        gf = tag('gluten_free')
        self.dish_a.dietary_tags.set([gf])
        self.dish_b.dietary_tags.set([gf])
        # Same global row on both — no per-org duplicate crept in.
        self.assertEqual(DietaryTag.objects.filter(slug='gluten_free').count(), 1)
        self.assertEqual(gf.dishes.count(), 2)

    def test_org_b_cannot_see_org_a_dishes_through_a_shared_tag(self):
        gf = tag('gluten_free')
        self.dish_a.dietary_tags.set([gf])
        self.dish_b.dietary_tags.set([gf])
        # The tag links both, but the tenant manager still scopes dishes by org.
        visible = Dish.objects.for_org(self.org_b).filter(dietary_tags=gf)
        self.assertEqual([d.name for d in visible], ['B Dish'])
