"""Characterization tests for the kitchen / additional-meals / portioning path.

These lock in *what the code does today* before the `EventMeal -> BookingMeal`
generalization (the abstract-base-booking refactor). They are a safety net for the
under-tested kitchen path: meals feeding the food total, the serialized
`additional_meals` shape the kitchen UI reads (including per-dish `portion_grams`),
meal replace-on-update, and the auto-portioning that fires when an event is
confirmed.

If one of these breaks during the refactor, the refactor changed behavior the
kitchen relies on — fix the refactor, do NOT relax the test to match new output.
"""
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from calculator.engine.calculator import calculate_portions
from dishes.models import Dish
from events.models import Event, EventDishComment, BookingMeal, BookingMealDishComment
from tests.base import get_test_user


class KitchenMealsCharacterizationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.client = APIClient()
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client.force_authenticate(user=self.user)
        self.dish_ids = list(
            Dish.objects.filter(is_active=True).values_list("id", flat=True)[:3]
        )

    def _create_event(self, **extra):
        payload = {
            "name": "E", "date": "2026-03-15",
            "gents": 60, "ladies": 40, "dish_ids": self.dish_ids,
        }
        payload.update(extra)
        res = self.client.post("/api/events/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    # ── Food total: main meal + additional meals ──────────────────────────────

    def test_food_total_includes_additional_meals(self):
        body = self._create_event(
            price_per_head="100.00",
            additional_meals=[
                {"label": "Breakfast", "guest_count": 30, "price_per_head": "20.00", "dish_ids": self.dish_ids[:1]},
                {"label": "Tea", "guest_count": 10, "price_per_head": "5.00"},
            ],
        )
        ev = Event.objects.get(id=body["id"])
        # main: 100 * (60 + 40) = 10000 ; meals: 20*30 + 5*10 = 650
        self.assertEqual(ev.food_total, Decimal("10650.00"))
        # No line items, so the subtotal equals the food total.
        self.assertEqual(Decimal(body["subtotal"]), Decimal("10650.00"))

    def test_meal_without_price_or_guests_contributes_zero(self):
        body = self._create_event(
            price_per_head="100.00",
            additional_meals=[
                {"label": "No price", "guest_count": 50},          # price None -> 0
                {"label": "No guests", "price_per_head": "20.00"},  # guests 0 -> 0
            ],
        )
        ev = Event.objects.get(id=body["id"])
        self.assertEqual(ev.food_total, Decimal("10000.00"))  # main only

    # ── Serialized additional_meals shape (the kitchen read contract) ─────────

    def test_additional_meals_serialized_shape(self):
        body = self._create_event(
            additional_meals=[{
                "label": "Lunch", "guest_count": 40, "price_per_head": "12.50",
                "dish_ids": self.dish_ids[:2], "notes": "no nuts",
            }],
        )
        res = self.client.get(f"/api/events/{body['id']}/")
        self.assertEqual(res.status_code, 200, res.content)
        meals = res.json()["additional_meals"]
        self.assertEqual(len(meals), 1)
        m = meals[0]
        # The exact keys the kitchen UI consumes.
        for key in ("id", "label", "guest_count", "price_per_head", "dishes",
                    "based_on_template", "meal_time", "notes", "dish_comments"):
            self.assertIn(key, m, f"additional_meals[].{key} missing")
        self.assertEqual(m["label"], "Lunch")
        self.assertEqual(m["guest_count"], 40)
        self.assertEqual(sorted(m["dishes"]), sorted(self.dish_ids[:2]))

    def test_meal_dish_comment_portion_grams_round_trip(self):
        # Per-dish kitchen portions on a meal are created via the ORM (the kitchen
        # path), then exposed through the serializer. Lock that read shape.
        ev = Event.objects.get(id=self._create_event(
            additional_meals=[{"label": "Dinner", "guest_count": 100, "dish_ids": self.dish_ids[:1]}],
        )["id"])
        meal = ev.additional_meals.get()
        BookingMealDishComment.objects.create(
            meal=meal, dish_id=self.dish_ids[0], portion_grams=123.5, comment="extra",
        )
        res = self.client.get(f"/api/events/{ev.id}/")
        dc = res.json()["additional_meals"][0]["dish_comments"]
        self.assertEqual(len(dc), 1)
        self.assertEqual(dc[0]["portion_grams"], 123.5)
        self.assertEqual(dc[0]["dish_id"], self.dish_ids[0])
        self.assertEqual(dc[0]["comment"], "extra")

    # ── Update replaces the whole meal set ────────────────────────────────────

    def test_update_replaces_additional_meals(self):
        body = self._create_event(
            additional_meals=[{"label": "Old", "guest_count": 10, "price_per_head": "5.00"}],
        )
        eid = body["id"]
        res = self.client.patch(f"/api/events/{eid}/", {
            "additional_meals": [
                {"label": "New A", "guest_count": 20, "price_per_head": "6.00"},
                {"label": "New B", "guest_count": 30, "price_per_head": "7.00"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        labels = sorted(BookingMeal.objects.filter(event_id=eid).values_list("label", flat=True))
        self.assertEqual(labels, ["New A", "New B"])  # old meal gone

    # ── Auto-portioning on confirm (the critical kitchen behavior) ────────────

    def test_confirm_autocalculates_dish_comments_from_engine(self):
        body = self._create_event()  # tentative, has dishes, no dish_comments
        eid = body["id"]
        self.assertFalse(EventDishComment.objects.filter(event_id=eid).exists())

        res = self.client.patch(f"/api/events/{eid}/", {"status": "confirmed"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

        comments = EventDishComment.objects.filter(event_id=eid)
        # One comment per dish, portions taken straight from the engine.
        self.assertEqual(comments.count(), len(self.dish_ids))
        engine = calculate_portions(
            dish_ids=self.dish_ids, guests={"gents": 60, "ladies": 40}, org=self.org,
        )
        expected = {p["dish_id"]: p["grams_per_person"] for p in engine["portions"]}
        got = {c.dish_id: c.portion_grams for c in comments}
        self.assertEqual(got, expected)

    def test_confirm_does_not_overwrite_existing_dish_comments(self):
        eid = self._create_event()["id"]
        self.client.patch(f"/api/events/{eid}/", {"status": "confirmed"}, format="json")
        # Pin a portion, then trigger another update while already confirmed.
        c = EventDishComment.objects.filter(event_id=eid).first()
        c.portion_grams = 999.0
        c.save()
        res = self.client.patch(f"/api/events/{eid}/", {"name": "Renamed"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        c.refresh_from_db()
        self.assertEqual(c.portion_grams, 999.0)  # not regenerated

    def test_confirm_without_dishes_creates_no_comments(self):
        body = self._create_event(dish_ids=[])
        eid = body["id"]
        res = self.client.patch(f"/api/events/{eid}/", {"status": "confirmed"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(EventDishComment.objects.filter(event_id=eid).exists())
