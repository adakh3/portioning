"""Deleting a dish must not rewrite the menus of bookings that already have it.

`Quote.dishes` / `Event.dishes` / `BookingMeal.dishes` are plain M2M relations,
so deleting a dish cascaded the join rows away and the dish silently vanished
from every booking that had it — historical and already-accepted ones included.
A caterer tidying their catalogue quietly changed what past clients had ordered,
with no warning and no record of the change.

The codebase already protects this class of thing: `Contact` is PROTECTed while
a booking references it, and `GuestSegment` while a `BookingGuestCount` uses it.
Dishes were the gap.

The guard costs nothing, because the intended route already worked: an inactive
dish leaves the pickers (`DishListView` filters `is_active=True`) while every
booking that already has it keeps it.
"""
import datetime
from decimal import Decimal

from django.db.models.deletion import ProtectedError
from django.test import TestCase

from bookings.models import Contact, Quote
from dishes.models import Dish
from dishes.tests import make_category, make_dish
from events.models import BookingMeal, Event
from tests.base import get_test_user


class DishDeleteProtectionTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.category = make_category(org=self.org)

    def _dish(self, name):
        return make_dish(org=self.org, category=self.category, name=name)

    def _quote(self):
        q = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date=datetime.date(2026, 9, 1), guest_count=10,
            price_per_head=Decimal('50'), created_by=self.user,
        )
        q.recalculate_totals()
        return q

    # ── the guard ──────────────────────────────────────────────────────────

    def test_a_dish_on_a_quote_cannot_be_deleted(self):
        dish = self._dish('On a quote')
        quote = self._quote()
        quote.dishes.set([dish])

        with self.assertRaises(ProtectedError):
            dish.delete()

        quote.refresh_from_db()
        self.assertEqual([d.name for d in quote.dishes.all()], ['On a quote'])

    def test_a_dish_on_an_event_cannot_be_deleted(self):
        dish = self._dish('On an event')
        event = Event.objects.create(organisation=self.org, name='E',
                                     event_date=datetime.date(2026, 9, 1), guest_count=10)
        event.dishes.set([dish])

        with self.assertRaises(ProtectedError):
            dish.delete()

        self.assertEqual(event.dishes.count(), 1)

    def test_a_dish_on_an_additional_meal_cannot_be_deleted(self):
        dish = self._dish('On a meal')
        meal = BookingMeal.objects.create(
            quote=self._quote(), label='Crew', guest_count=5,
            price_per_head=Decimal('10'), audience='custom',
        )
        meal.dishes.set([dish])

        with self.assertRaises(ProtectedError):
            dish.delete()

    def test_a_bulk_queryset_delete_is_guarded_too(self):
        # The admin's bulk action deletes by queryset, which bypasses
        # Model.delete() — hence pre_delete rather than an override.
        dish = self._dish('Bulk target')
        self._quote().dishes.set([dish])

        with self.assertRaises(ProtectedError):
            Dish.objects.filter(id=dish.id).delete()

        self.assertTrue(Dish.objects.filter(id=dish.id).exists())

    def test_the_error_names_the_dish_and_points_at_deactivating(self):
        dish = self._dish('Chicken Karahi')
        self._quote().dishes.set([dish])

        with self.assertRaises(ProtectedError) as ctx:
            dish.delete()

        message = str(ctx.exception.args[0])
        self.assertIn('Chicken Karahi', message)
        self.assertIn('1 quote(s)', message)
        self.assertIn('is active', message)

    # ── what must still work ───────────────────────────────────────────────

    def test_an_unused_dish_is_still_deletable(self):
        # Catalogue cleanup must not become impossible.
        dish = self._dish('Never ordered')
        dish.delete()
        self.assertFalse(Dish.objects.filter(name='Never ordered').exists())

    def test_a_dish_only_on_a_menu_template_is_still_deletable(self):
        # A template is reusable config, not a record of something that
        # happened — pulling a dish out of one rewrites no history.
        from menus.models import MenuDishPortion, MenuTemplate

        dish = self._dish('Template only')
        template = MenuTemplate.objects.create(organisation=self.org, name='T')
        MenuDishPortion.objects.create(menu=template, dish=dish, portion_grams=100)

        dish.delete()
        self.assertFalse(Dish.objects.filter(name='Template only').exists())

    def test_deactivating_keeps_the_booking_and_clears_the_picker(self):
        # The intended route: history preserved, dish retired.
        dish = self._dish('Retired')
        quote = self._quote()
        quote.dishes.set([dish])

        dish.is_active = False
        dish.save()

        quote.refresh_from_db()
        self.assertEqual([d.name for d in quote.dishes.all()], ['Retired'])
        self.assertFalse(Dish.objects.filter(id=dish.id, is_active=True).exists())

    def test_a_dish_becomes_deletable_once_the_booking_lets_it_go(self):
        dish = self._dish('Removed later')
        quote = self._quote()
        quote.dishes.set([dish])
        with self.assertRaises(ProtectedError):
            dish.delete()

        quote.dishes.clear()
        dish.delete()  # must not raise
        self.assertFalse(Dish.objects.filter(name='Removed later').exists())
