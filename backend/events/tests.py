from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from users.models import User


class TestEventListSerialization(TestCase):
    """Guards /api/events/ against serializer-config 500s.

    The pre-existing test_api.test_list_events only hit an EMPTY list, so the
    EventListSerializer's child fields were never bound — masking an
    ImproperlyConfigured error (a field in Meta.fields with no declaration).
    Listing at least one real event binds the fields and exercises the path
    that actually 500'd in production.
    """

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=get_test_user())

    def _create_event(self):
        from dishes.models import Dish
        dish_ids = list(Dish.objects.filter(is_active=True).values_list("id", flat=True)[:3])
        res = self.client.post("/api/events/", {
            "name": "Serialize Me", "date": "2026-03-15",
            "gents": 50, "ladies": 50, "dish_ids": dish_ids,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)

    def test_list_serializes_a_real_event(self):
        self._create_event()
        res = self.client.get("/api/events/")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertTrue(rows, "expected at least one event in the list")
        # product_name is the field that was in Meta.fields but undeclared.
        self.assertIn("product_name", rows[0])

    def test_list_includes_assignee_and_creator_names(self):
        # Regression: the list serializer dropped assigned_to_name, so the events
        # table's Salesperson column always showed "—" even for assigned events.
        # The list also exposes created_by(_name) for the "Created by" filter.
        self._create_event()  # perform_create sets both to the current user
        res = self.client.get("/api/events/")
        rows = res.json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        row = rows[0]
        for field in ("assigned_to", "assigned_to_name", "created_by", "created_by_name"):
            self.assertIn(field, row)
        self.assertTrue(row["assigned_to_name"], "expected the assignee's name in the list row")
        self.assertTrue(row["created_by_name"], "expected the creator's name in the list row")

    def test_calendar_returns_events_for_the_month(self):
        # Guards the calendar against the date->event_date rename: it filtered on a
        # non-existent `date` field and 500'd, so the calendar showed nothing.
        self._create_event()  # date 2026-03-15
        res = self.client.get("/api/events/calendar/?month=2026-03")
        self.assertEqual(res.status_code, 200, res.content)
        day = next((d for d in res.json() if d["date"] == "2026-03-15"), None)
        self.assertIsNotNone(day, "the created event's day should appear in the calendar")
        self.assertGreaterEqual(day["org_event_count"], 1)

    def test_list_accepts_date_range_filters(self):
        # The list view's date_from/date_to filters used the old `date` field too.
        self._create_event()
        res = self.client.get("/api/events/?date_from=2026-03-01&date_to=2026-03-31")
        self.assertEqual(res.status_code, 200, res.content)


class TestEventAssigneePersistence(TestCase):
    """The assignee (used for the Salesperson column + commission attribution)
    must survive create, edits, and a full round-trip save."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.rep = User.objects.create(
            email="rep@test.com", first_name="Rep", last_name="One",
            role="salesperson", organisation=self.org, is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _dish_ids(self):
        from dishes.models import Dish
        return list(Dish.objects.filter(is_active=True).values_list("id", flat=True)[:3])

    def _create(self, **extra):
        payload = {
            "name": "Assignee Test", "date": "2026-03-15",
            "gents": 10, "ladies": 10, "dish_ids": self._dish_ids(), **extra,
        }
        res = self.client.post("/api/events/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def _get(self, event_id):
        return self.client.get(f"/api/events/{event_id}/").json()

    def test_assignee_persists_on_create(self):
        body = self._create(assigned_to=self.rep.id)
        self.assertEqual(body["assigned_to"], self.rep.id)
        got = self._get(body["id"])
        self.assertEqual(got["assigned_to"], self.rep.id)
        self.assertEqual(got["assigned_to_name"], "Rep One")

    def test_assignee_survives_partial_edit_that_omits_it(self):
        # The risky case: editing another field must not wipe the assignee.
        body = self._create(assigned_to=self.rep.id)
        res = self.client.patch(f"/api/events/{body['id']}/", {"name": "Renamed"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        got = self._get(body["id"])
        self.assertEqual(got["name"], "Renamed")
        self.assertEqual(got["assigned_to"], self.rep.id)

    def test_assignee_survives_multi_field_editor_save(self):
        # Mirrors the editor's main save: a multi-field PATCH that includes the
        # assignee alongside other edits.
        body = self._create(assigned_to=self.rep.id)
        res = self.client.patch(
            f"/api/events/{body['id']}/",
            {"name": "Edited", "gents": 20, "ladies": 5,
             "dish_ids": self._dish_ids(), "assigned_to": self.rep.id},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        got = self._get(body["id"])
        self.assertEqual(got["name"], "Edited")
        self.assertEqual(got["assigned_to"], self.rep.id)

    def test_assignee_can_be_reassigned(self):
        body = self._create(assigned_to=self.user.id)
        res = self.client.patch(f"/api/events/{body['id']}/", {"assigned_to": self.rep.id}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self._get(body["id"])["assigned_to"], self.rep.id)


class TestSalespersonEventVisibility(TestCase):
    """A salesperson sees events assigned to them OR created by them — matching
    Lead/Quote list scoping (bookings views), not just ones they created."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.owner = get_test_user()
        self.org = self.owner.organisation
        self.rep = User.objects.create(
            email="rep2@test.com", first_name="Rep", last_name="Two",
            role="salesperson", organisation=self.org, is_active=True,
        )

    def _dish_ids(self):
        from dishes.models import Dish
        return list(Dish.objects.filter(is_active=True).values_list("id", flat=True)[:3])

    def _create_as(self, user, name, **extra):
        client = APIClient()
        client.force_authenticate(user=user)
        payload = {"name": name, "date": "2026-05-01", "gents": 5, "ladies": 5,
                   "dish_ids": self._dish_ids(), **extra}
        res = client.post("/api/events/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()["id"]

    def test_salesperson_sees_assigned_and_created_but_not_others(self):
        assigned = self._create_as(self.owner, "Assigned", assigned_to=self.rep.id)
        created = self._create_as(self.rep, "Created")            # created + assigned to rep
        other = self._create_as(self.owner, "Other", assigned_to=self.owner.id)

        client = APIClient()
        client.force_authenticate(user=self.rep)
        res = client.get("/api/events/?page_size=all")
        self.assertEqual(res.status_code, 200, res.content)
        rows = res.json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        ids = {r["id"] for r in rows}
        self.assertIn(assigned, ids)   # assigned to the rep (created by owner)
        self.assertIn(created, ids)    # created by the rep
        self.assertNotIn(other, ids)   # neither → hidden


class TestDishAddOrder(TestCase):
    """A booking's dishes come back in the order they were added, not alphabetically."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_event_detail_returns_dishes_in_add_order(self):
        from dishes.tests import make_category, make_dish
        cat = make_category(org=self.org)  # one category → default ordering is by name
        z = make_dish(org=self.org, category=cat, name="Zaatar Rice")
        a = make_dish(org=self.org, category=cat, name="Apple Tart")
        m = make_dish(org=self.org, category=cat, name="Mango Lassi")
        posted = [z.id, a.id, m.id]  # deliberately non-alphabetical
        res = self.client.post("/api/events/", {
            "name": "Order", "date": "2026-05-01", "gents": 5, "ladies": 5,
            "dish_ids": posted,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        got = self.client.get(f"/api/events/{res.json()['id']}/").json()
        self.assertEqual(got["dishes"], posted)  # add-order preserved, not re-sorted
