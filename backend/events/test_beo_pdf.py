"""Render-and-extract tests for the BEO — the day-of Banquet Event Order (REL-444).

Build a real event, render it with ``generate_beo_pdf``, pull the text back out with
pypdf, and assert what the kitchen/banquet/venue actually see. Golden-style, like
``bookings/test_pdf_golden.py``: a PDF that builds without raising proves nothing
about whether the vendor covers made it onto the page.

Traced to the ticket's acceptance criteria — each test names the AC it covers.
"""
import datetime
import io
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from bookings.models.settings import OrgSettings
from bookings.models.signatures import BookingSignature
from bookings.pdf_beo import generate_beo_pdf
from bookings.services.beo import issue_beo_revision
from dishes.models import DietaryTag, DietaryTagKind
from dishes.tests import make_category, make_dish
from equipment.models import EquipmentItem, EquipmentReservation
from events.models import (
    BookingCourse, BookingGuestCount, BookingMeal, BookingTimelineEntry,
    Event, EventDishComment, MealAudience,
)
from rules.models import GuestSegment
from staff.models import LaborRole, Shift, StaffMember

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - pypdf is a declared dependency
    HAVE_PYPDF = False


def _dt(hour, day=1):
    return datetime.datetime(2026, 8, day, hour, 0, tzinfo=datetime.timezone.utc)


class BEOTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _event(self, org=None, **kwargs):
        defaults = dict(
            organisation=org or self.org, name="Khan Wedding",
            event_date=datetime.date(2026, 8, 1), guest_count=100,
            status="confirmed", event_type="wedding", service_style="plated",
            price_per_head=Decimal("137.77"),
        )
        defaults.update(kwargs)
        return Event.objects.create(**defaults)

    def _text(self, event):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        reader = PdfReader(io.BytesIO(generate_beo_pdf(event)))
        return "\n".join(p.extract_text() for p in reader.pages)

    def _vendor_segment(self, name="Vendors"):
        return GuestSegment.objects.create(
            organisation=self.org, name=name, counts_toward_total=False,
            price_multiplier=Decimal("0.5000"), sort_order=9,
        )

    def _adults_segment(self):
        # A named in-count segment of our own, NOT the seeded default — that one is
        # called "gents" in this org's seed data, which would make the breakdown
        # assertions below pass or fail on seed wording rather than on the BEO.
        return GuestSegment.objects.get_or_create(
            organisation=self.org, name="Adults",
            defaults={"counts_toward_total": True, "sort_order": 0},
        )[0]


class BEOSectionTests(BEOTestBase):
    """AC1, AC3, AC4, AC5, AC8, AC9 — the sections and the order they read in."""

    def _full_event(self):
        from bookings.models import Contact, Venue
        e = self._event(
            guaranteed_count=95, final_count=92,
            final_count_due=datetime.date(2026, 7, 18),
            primary_contact=Contact.objects.create(
                organisation=self.org, name="Jane Doe", phone="555-0199"),
            venue=Venue.objects.create(
                organisation=self.org, name="The Grand Hall", city="Austin"),
            kitchen_instructions="No pork. Halal only.",
            banquet_instructions="White linen, gold chargers.",
            setup_instructions="Stage against the north wall.",
        )
        BookingTimelineEntry.objects.create(
            event=e, time=datetime.time(14, 0), label="Load in",
            date=datetime.date(2026, 7, 31), sort_order=0,
        )
        BookingTimelineEntry.objects.create(
            event=e, time=datetime.time(19, 0), label="Dinner service", sort_order=1,
        )
        cat = make_category(org=self.org)
        starter = make_dish(org=self.org, category=cat, name="Burrata")
        main = make_dish(org=self.org, category=cat, name="Filet Mignon")
        e.dishes.set([starter, main])
        c1 = BookingCourse.objects.create(event=e, name="Starter", sort_order=0)
        c2 = BookingCourse.objects.create(event=e, name="Main", sort_order=1)
        EventDishComment.objects.create(event=e, dish=starter, course=c1)
        EventDishComment.objects.create(event=e, dish=main, course=c2)

        role = LaborRole.objects.create(organisation=self.org, name="Server",
                                        default_hourly_rate=Decimal("25.00"))
        staff = StaffMember.objects.create(organisation=self.org, name="Ada Cook")
        Shift.objects.create(event=e, role=role, staff_member=staff,
                             start_time=_dt(14), end_time=_dt(23))
        Shift.objects.create(event=e, role=role, start_time=_dt(16), end_time=_dt(23))

        item = EquipmentItem.objects.create(organisation=self.org, name="Chafing dish",
                                            stock_quantity=40)
        EquipmentReservation.objects.create(event=e, equipment=item, quantity_out=12)
        return e

    def test_every_section_renders_in_ops_order(self):
        text = self._text(self._full_event())

        # AC1 — the document identifies itself and which copy this is.
        self.assertIn("BANQUET EVENT ORDER", text)
        self.assertIn("BEO #", text)
        self.assertIn("Rev 1", text)

        for header in ["GUEST COUNT", "TIMELINE", "MENU", "STAFFING", "EQUIPMENT",
                       "KITCHEN INSTRUCTIONS", "BANQUET INSTRUCTIONS",
                       "SETUP INSTRUCTIONS", "CONTACTS"]:
            self.assertIn(header, text, f"missing section: {header}")

        # The sheet reads in the order the day runs: who's coming, when, what they
        # eat, who cooks it, what to load, then the notes and the phone numbers.
        order = ["GUEST COUNT", "TIMELINE", "MENU", "STAFFING", "EQUIPMENT",
                 "KITCHEN INSTRUCTIONS", "CONTACTS"]
        positions = [text.find(h) for h in order]
        self.assertEqual(positions, sorted(positions), f"sections out of order: {order}")

    def test_timeline_entries_render_with_day_before_date(self):
        # AC3 — entries win, and a step on another day says so.
        text = self._text(self._full_event())
        self.assertIn("Load in", text)
        self.assertIn("Dinner service", text)
        self.assertIn("31 Jul", text)  # the load-in is the afternoon before
        self.assertNotIn("Setup Time:", text)  # legacy slots must NOT also appear

    def test_legacy_times_render_when_there_are_no_entries(self):
        # AC3 — entries-win-ELSE-legacy, the same rule as the other two surfaces.
        e = self._event(setup_time=_dt(16), meal_time=_dt(20))
        text = self._text(e)
        self.assertIn("Setup Time:", text)
        self.assertIn("Meal Time:", text)

    def test_guest_breakdown_and_guarantee(self):
        # AC5 — the in-count breakdown plus where the guarantee stands.
        e = self._full_event()
        e.guest_count = 0
        e.save(update_fields=["guest_count"])
        adults = self._adults_segment()
        kids = GuestSegment.objects.create(organisation=self.org, name="Kids",
                                           portion_multiplier=0.6, sort_order=1)
        BookingGuestCount.objects.create(event=e, segment=adults, count=80)
        BookingGuestCount.objects.create(event=e, segment=kids, count=20)
        text = self._text(e)
        self.assertIn("Adults", text)
        self.assertIn("Kids", text)
        self.assertIn("Total guests:", text)
        self.assertIn("100", text)  # 80 + 20
        self.assertIn("Guaranteed count:", text)
        self.assertIn("Final count:", text)
        self.assertIn("Final count due:", text)

    def test_additional_covers_sit_outside_the_guest_total(self):
        # AC5 — vendor covers are real plates but deliberately not guests, so the
        # sheet has to show both numbers rather than one blended one.
        e = self._event(guest_count=0)
        BookingGuestCount.objects.create(event=e, segment=self._adults_segment(), count=100)
        BookingGuestCount.objects.create(event=e, segment=self._vendor_segment(), count=8)
        text = self._text(e)
        self.assertIn("Adults", text)
        self.assertIn("additional cover", text)
        self.assertIn("Total guests:", text)
        self.assertIn("Total covers:", text)
        # 100 guests, 108 covers — the distinction the block exists for.
        self.assertIn("108", text)

    def test_guarantee_lines_are_omitted_until_there_is_a_guarantee(self):
        # AC5 — an empty "Final count:" label would read as a recorded zero.
        text = self._text(self._event())
        self.assertIn("GUEST COUNT", text)
        for absent in ["Guaranteed count:", "Final count:", "Final count due:"]:
            self.assertNotIn(absent, text)

    def test_empty_sections_are_omitted_rather_than_rendered_blank(self):
        # AC8/AC9 — a bare event should print no headers it has nothing to fill.
        text = self._text(self._event())
        for absent in ["STAFFING", "EQUIPMENT", "MENU", "CONTACTS",
                       "KITCHEN INSTRUCTIONS", "BANQUET INSTRUCTIONS",
                       "SETUP INSTRUCTIONS", "ADDITIONAL MEALS", "VENDOR MEALS",
                       "ADD-ONS & EXTRAS", "VENUE ACCESS", "EVENT NOTES"]:
            self.assertNotIn(absent, text, f"empty section rendered anyway: {absent}")
        # …but it is still a BEO, with the identity and guests that always apply.
        self.assertIn("BANQUET EVENT ORDER", text)
        self.assertIn("GUEST COUNT", text)

    def test_staffing_names_the_unassigned_shift(self):
        # AC8 — an empty slot on the roster has to read as an empty slot.
        text = self._text(self._full_event())
        self.assertIn("Ada Cook", text)
        self.assertIn("Unassigned", text)
        self.assertIn("Server", text)

    def test_equipment_lists_item_and_quantity(self):
        text = self._text(self._full_event())  # AC8
        self.assertIn("Chafing dish", text)
        self.assertIn("12", text)

    def test_staffing_and_equipment_omitted_when_empty(self):
        # AC8 — each section disappears rather than printing an empty table.
        text = self._text(self._event())
        self.assertNotIn("STAFFING", text)
        self.assertNotIn("EQUIPMENT", text)

    def test_contacts_render_customer_and_venue(self):
        # AC9
        from bookings.models import Contact, Venue
        venue = Venue.objects.create(
            organisation=self.org, name="The Grand Hall", address_line1="1 High St",
            city="Austin", contact_name="Dana Venue", contact_phone="555-0100",
        )
        contact = Contact.objects.create(organisation=self.org, name="Jane Doe",
                                         phone="555-0199", email="jane@example.com")
        contact.refresh_from_db()  # Contact.save normalises the number to E.164
        text = self._text(self._event(venue=venue, primary_contact=contact))
        self.assertIn("CONTACTS", text)
        self.assertIn("Jane Doe", text)
        self.assertIn("jane@example.com", text)
        self.assertIn(contact.phone, text)
        self.assertIn("The Grand Hall", text)
        self.assertIn("Dana Venue", text)
        self.assertIn("555-0100", text)


class BEOOpsDetailTests(BEOTestBase):
    """AC13–AC17 — the things the form captures that the crew needs on the day."""

    def test_addons_render_as_things_to_bring_not_money(self):
        # AC13 — an add-on is the ONLY record of a lot of real deliverables: nothing
        # turns "20 gold chargers" into an EquipmentReservation, so without this the
        # crew loading the van never learns they were sold.
        from bookings.models import BookingLineItem
        e = self._event()
        BookingLineItem.objects.create(event=e, category="rental", description="Gold chargers",
                                       quantity=Decimal("20.00"), unit="each",
                                       unit_price=Decimal("4.50"))
        BookingLineItem.objects.create(event=e, category="labor", description="Waiter",
                                       quantity=Decimal("5"), unit="per_hour",
                                       unit_price=Decimal("28.00"))
        text = self._text(e)
        self.assertIn("ADD-ONS & EXTRAS", text)
        self.assertIn("Gold chargers", text)
        self.assertIn("20 × Each", text)       # not "20.00" — nobody loads 20.00 chargers
        self.assertIn("Waiter", text)
        self.assertIn("5 × Per Hour", text)
        for money in ["4.50", "28.00", "90.00"]:
            self.assertNotIn(money, text, "the add-on block leaked a price")

    def test_pure_money_addons_are_left_off(self):
        # AC13 — a fee or a discount has nothing to load or roster, and on a document
        # with no amounts a bare "Service fee" row tells the crew nothing.
        from bookings.models import BookingLineItem
        e = self._event()
        BookingLineItem.objects.create(event=e, category="fee", description="Travel fee",
                                       quantity=Decimal("1"), unit="flat",
                                       unit_price=Decimal("120.00"))
        BookingLineItem.objects.create(event=e, category="discount", description="Loyalty discount",
                                       quantity=Decimal("1"), unit="flat",
                                       unit_price=Decimal("-50.00"))
        text = self._text(e)
        self.assertNotIn("ADD-ONS & EXTRAS", text)
        self.assertNotIn("Travel fee", text)
        self.assertNotIn("Loyalty discount", text)

    def test_venue_access_block_renders_the_logistics(self):
        # AC14 — the questions a crew actually rings about.
        from bookings.models import Venue
        venue = Venue.objects.create(
            organisation=self.org, name="The Grand Hall",
            loading_notes="Dock on the river side; van park bay 4.",
            kitchen_access=True, power_water_notes="Three 32A outlets backstage.",
            rules="Music off at 23:30. No open flame.",
        )
        text = self._text(self._event(venue=venue))
        self.assertIn("VENUE ACCESS", text)
        self.assertIn("Dock on the river side", text)
        self.assertIn("Kitchen on site:", text)
        self.assertIn("Yes", text)
        self.assertIn("32A outlets", text)
        self.assertIn("Music off at 23:30", text)

    def test_venue_access_block_omitted_when_the_venue_says_nothing(self):
        # AC14 — a lone "Kitchen on site: No" is a default, not a fact anyone asserted.
        from bookings.models import Venue
        venue = Venue.objects.create(organisation=self.org, name="Bare Venue")
        self.assertNotIn("VENUE ACCESS", self._text(self._event(venue=venue)))

    def test_big_eaters_uplift_is_visible_to_the_kitchen(self):
        # AC15 — it scales every portion cooked. The CLIENT's function sheet must
        # still never mention it (asserted in events/test_event_pdf.py).
        e = self._event(big_eaters=True, big_eaters_percentage=20)
        text = self._text(e)
        self.assertIn("Big eaters", text)
        self.assertIn("+20%", text)

    def test_no_big_eaters_line_when_the_flag_is_off(self):
        self.assertNotIn("Big eaters", self._text(self._event(big_eaters=False)))

    def test_event_notes_render_as_their_own_block(self):
        # AC16
        e = self._event(notes="Bride's father is coeliac — seat 12A.")
        text = self._text(e)
        self.assertIn("EVENT NOTES", text)
        self.assertIn("coeliac", text)

    def test_event_owner_is_reachable_from_the_contacts_block(self):
        # AC17 — who site crew ring at the office when the day goes sideways.
        e = self._event(assigned_to=self.user)
        text = self._text(e)
        self.assertIn("Event owner:", text)
        self.assertIn(self.user.get_full_name() or self.user.email, text)

    def test_an_adhoc_venue_keeps_its_city_state_and_zip(self):
        # A van needs the whole address. `venue_address` is the old freeform field and
        # the US parts live in their own columns — rendering only the first drops the
        # city and ZIP off the one document whose job is saying where to go.
        e = self._event(venue=None, venue_address="400 River Rd",
                        venue_city="Austin", venue_state="TX", venue_zip="78701")
        text = self._text(e)
        self.assertIn("400 River Rd", text)
        self.assertIn("Austin", text)
        self.assertIn("TX", text)
        self.assertIn("78701", text)


class BEOMenuTests(BEOTestBase):
    """AC4, AC7 — the menu, its dietary flags, and the choice tallies."""

    def _tagged_course_event(self, choice_counts=None):
        """A plated event with a Starter and a Main that offers a choice of three."""
        e = self._event(final_count_due=datetime.date(2026, 7, 18))
        cat = make_category(org=self.org)
        gf = DietaryTag.objects.get_or_create(
            slug="gluten-free", defaults={"label": "Gluten free", "short_label": "GF",
                                          "kind": DietaryTagKind.DIETARY})[0]
        milk = DietaryTag.objects.get_or_create(
            slug="milk", defaults={"label": "Milk", "kind": DietaryTagKind.ALLERGEN})[0]
        starter = make_dish(org=self.org, category=cat, name="Burrata")
        starter.dietary_tags.set([milk])
        beef = make_dish(org=self.org, category=cat, name="Filet Mignon")
        beef.dietary_tags.set([gf])
        salmon = make_dish(org=self.org, category=cat, name="Salmon")
        veg = make_dish(org=self.org, category=cat, name="Wild Mushroom Risotto")
        e.dishes.set([starter, beef, salmon, veg])
        c1 = BookingCourse.objects.create(event=e, name="Starter", sort_order=0)
        c2 = BookingCourse.objects.create(event=e, name="Main", sort_order=1)
        EventDishComment.objects.create(event=e, dish=starter, course=c1)
        counts = choice_counts or {}
        for dish in (beef, salmon, veg):
            EventDishComment.objects.create(
                event=e, dish=dish, course=c2, is_choice=True,
                choice_count=counts.get(dish.name),
            )
        return e

    def test_menu_groups_by_course_with_service_style_once_and_dietary_suffixes(self):
        # AC4
        text = self._text(self._tagged_course_event())
        self.assertIn("MENU", text)
        self.assertIn("Starter", text)
        self.assertIn("Main", text)
        self.assertIn("Service style:", text)
        self.assertEqual(text.count("Service style:"), 1, "service style is booking-level")
        self.assertIn("Burrata (contains milk)", text)
        self.assertIn("Filet Mignon (GF)", text)

    def test_courses_with_no_dishes_yet_render_no_menu_header(self):
        # The menu builder creates a course first and the dishes after, so an event
        # with empty courses is an ordinary in-progress state — not a reason to print
        # a MENU heading over blank space.
        e = self._event()
        BookingCourse.objects.create(event=e, name="Starter", sort_order=0)
        BookingCourse.objects.create(event=e, name="Main", sort_order=1)
        self.assertNotIn("MENU", self._text(e))

    def test_course_less_event_renders_the_flat_menu(self):
        # AC4 — no courses defined, so the flat added-order list still renders.
        e = self._event()
        cat = make_category(org=self.org)
        e.dishes.set([make_dish(org=self.org, category=cat, name="Lamb Biryani")])
        text = self._text(e)
        self.assertIn("MENU", text)
        self.assertIn("Lamb Biryani", text)

    def test_recorded_tallies_render_under_their_course(self):
        # AC7 — the numbers the kitchen cooks to, beneath the course that offers them.
        e = self._tagged_course_event(choice_counts={
            "Filet Mignon": 60, "Salmon": 25, "Wild Mushroom Risotto": 15,
        })
        text = self._text(e)
        self.assertIn("60", text)
        self.assertIn("25", text)
        self.assertIn("15", text)
        self.assertNotIn("choices pending", text)
        # The tallies sit under the Main course, not floating at the top of the menu.
        self.assertLess(text.find("Main"), text.find("60"))

    def test_partly_tallied_course_says_so_instead_of_reading_as_zero(self):
        # AC7 — the dangerous middle state. With the beef counted and the salmon not,
        # "Salmon — —" under an otherwise complete-looking block reads as ZERO salmon.
        # A kitchen that cooks zero salmon because nobody had counted it yet is the
        # exact failure this section exists to prevent.
        e = self._tagged_course_event(choice_counts={"Filet Mignon": 60})
        text = self._text(e)
        self.assertIn("60", text)
        self.assertIn("2 of 3 main choices still", text)
        self.assertIn("incomplete", text)

    def test_tally_lines_carry_the_dietary_suffix_like_the_course_above(self):
        # AC4/AC7 — the tally block is where covers get counted, so it is precisely
        # where "which of these is the gluten-free plate?" has to be answerable.
        e = self._tagged_course_event(choice_counts={
            "Filet Mignon": 60, "Salmon": 25, "Wild Mushroom Risotto": 15,
        })
        text = self._text(e)
        self.assertIn("Filet Mignon (GF) — 60", text.replace("\n", " "))

    def test_pending_line_when_choices_are_offered_but_not_yet_tallied(self):
        # AC7 — silence would read as "no choices", which is the one wrong answer.
        text = self._text(self._tagged_course_event())
        self.assertIn("Main choices pending", text)
        self.assertIn("due 18 Jul 2026", text)

    def test_a_stale_choice_flag_on_a_non_plated_booking_renders_nothing(self):
        # AC7 — switching a booking off plated hides the Menu-choices card, taking the
        # only way to untick with it, so flags DO get left behind (REL-419). Every read
        # is gated on the service style; the BEO must be gated too, or the kitchen gets
        # a "choices pending" line for a buffet nobody will ever tally.
        e = self._tagged_course_event(choice_counts={"Filet Mignon": 60})
        e.service_style = "buffet"
        e.save(update_fields=["service_style"])
        text = self._text(e)
        self.assertNotIn("choices pending", text)
        self.assertNotIn("Choice of:", text)
        # The dishes themselves are still on the menu — they are ordinary dishes now.
        self.assertIn("Filet Mignon", text)

    def test_no_choice_block_when_nothing_is_offered(self):
        # AC7 — a booking with no choices gets no pending line either.
        e = self._event()
        cat = make_category(org=self.org)
        dish = make_dish(org=self.org, category=cat, name="Lamb Biryani")
        e.dishes.set([dish])
        course = BookingCourse.objects.create(event=e, name="Main", sort_order=0)
        EventDishComment.objects.create(event=e, dish=dish, course=course)
        self.assertNotIn("choices pending", self._text(e))


class BEOVendorTests(BEOTestBase):
    """AC6 — vendor covers, detected without a vendor flag."""

    def test_segment_audience_meal_renders_the_vendor_block(self):
        e = self._event()
        vendors = self._vendor_segment()
        BookingGuestCount.objects.create(event=e, segment=vendors, count=8)
        cat = make_category(org=self.org)
        meal = BookingMeal.objects.create(
            event=e, label="Crew boxes", audience=MealAudience.SEGMENT,
            audience_segment=vendors, guest_count=8, meal_time=_dt(17),
        )
        meal.dishes.set([make_dish(org=self.org, category=cat, name="Chicken Wrap")])
        text = self._text(e)
        self.assertIn("VENDOR MEALS", text)
        self.assertIn("Vendors", text)
        self.assertIn("Crew boxes", text)
        self.assertIn("Chicken Wrap", text)
        self.assertIn("8 covers", text)
        self.assertIn("17:00", text)  # serve time, because the meal is timed

    def test_additional_covers_row_alone_renders_the_vendor_block(self):
        # AC6, second signal — vendors are on the guest counts with no meal of their
        # own, so they eat the main menu and the sheet says so.
        e = self._event()
        BookingGuestCount.objects.create(event=e, segment=self._adults_segment(), count=100)
        BookingGuestCount.objects.create(event=e, segment=self._vendor_segment(), count=6)
        text = self._text(e)
        self.assertIn("VENDOR MEALS", text)
        self.assertIn("6 covers", text)
        self.assertIn("Served from the main menu", text)

    def test_vendor_block_omitted_when_there_are_no_vendors(self):
        # AC6 — the block disappears entirely rather than rendering empty.
        e = self._event()
        BookingGuestCount.objects.create(event=e, segment=self._adults_segment(), count=100)
        BookingMeal.objects.create(event=e, label="Welcome drinks", guest_count=100,
                                   meal_time=_dt(18))
        text = self._text(e)
        self.assertNotIn("VENDOR MEALS", text)
        self.assertIn("ADDITIONAL MEALS", text)  # the ordinary extra meal still shows

    def test_an_ordinary_extra_meal_shows_its_covers_time_and_own_menu(self):
        # AC12 — the welcome canapés are a second service the kitchen has to cook and
        # plate at a different hour; a day-of sheet that lists only the main menu
        # sends the crew out short.
        e = self._event()
        cat = make_category(org=self.org)
        meal = BookingMeal.objects.create(event=e, label="Welcome canapés",
                                          guest_count=150, meal_time=_dt(18))
        meal.dishes.set([make_dish(org=self.org, category=cat, name="Goat Cheese Tartlet")])
        text = self._text(e)
        self.assertIn("ADDITIONAL MEALS", text)
        self.assertIn("Welcome canapés", text)
        self.assertIn("150 covers", text)
        self.assertIn("18:00", text)
        self.assertIn("Goat Cheese Tartlet", text)

    def test_a_vendor_meal_is_not_also_listed_as_an_ordinary_extra_meal(self):
        # The two blocks partition the meals — one cover, listed once.
        e = self._event()
        vendors = self._vendor_segment()
        BookingGuestCount.objects.create(event=e, segment=vendors, count=8)
        BookingMeal.objects.create(event=e, label="Crew boxes", audience=MealAudience.SEGMENT,
                                   audience_segment=vendors, guest_count=8)
        text = self._text(e)
        self.assertEqual(text.count("Crew boxes"), 1)
        self.assertNotIn("ADDITIONAL MEALS", text)

    def test_a_meal_labelled_vendor_is_not_treated_as_one(self):
        # Free text is not a signal: a custom-count meal called "Vendor lunch" proves
        # nothing about who eats it, and guessing would put phantom covers on the sheet.
        e = self._event()
        BookingMeal.objects.create(event=e, label="Vendor lunch", guest_count=10)
        self.assertNotIn("VENDOR MEALS", self._text(e))


class BEORevisionTests(BEOTestBase):
    """AC2 — the revision number, which moves only on purpose."""

    def test_an_event_starts_at_rev_1(self):
        # The original issue is not a revision of anything, so nobody has to do
        # anything to get Rev 1.
        e = self._event()
        self.assertEqual(e.beo_revision, 1)
        self.assertIsNone(e.beo_revised_at)
        text = self._text(e)
        self.assertIn("Rev 1", text)
        self.assertNotIn("Revised", text)

    def test_downloading_never_moves_the_number(self):
        # THE regression this whole design exists for. Printing one copy each for the
        # kitchen, the captain and the venue used to hand out three identical sheets
        # numbered Rev 3, 4 and 5 — and the captain would chase a change that never
        # happened. Ten downloads, one revision.
        e = self._event()
        BookingSignature.objects.create(event=e, signer_name="Client Co")
        for _ in range(10):
            res = self.client.get(f"/api/events/{e.id}/beo/")
            self.assertEqual(res.status_code, 200)
        e.refresh_from_db()
        self.assertEqual(e.beo_revision, 1)
        self.assertIsNone(e.beo_revised_at)

    def test_issuing_a_revision_increments_and_stamps(self):
        e = self._event()
        revision, revised_at = issue_beo_revision(e)
        self.assertEqual(revision, 2)
        self.assertIsNotNone(revised_at)
        text = self._text(e)
        self.assertIn("Rev 2", text)
        self.assertIn("Revised", text)

    def test_issuing_repeatedly_climbs_one_at_a_time(self):
        e = self._event()
        self.assertEqual(issue_beo_revision(e)[0], 2)
        self.assertEqual(issue_beo_revision(e)[0], 3)
        e.refresh_from_db()
        self.assertEqual(e.beo_revision, 3)

    def test_rendering_alone_never_moves_the_number(self):
        e = self._event()
        generate_beo_pdf(e)
        generate_beo_pdf(e)
        e.refresh_from_db()
        self.assertEqual(e.beo_revision, 1)

    def test_the_revise_endpoint_bumps_and_returns_the_event(self):
        e = self._event()
        res = self.client.post(f"/api/events/{e.id}/beo/revise/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["beo_revision"], 2)
        self.assertIsNotNone(res.json()["beo_revised_at"])
        e.refresh_from_db()
        self.assertEqual(e.beo_revision, 2)

    def test_the_revise_endpoint_is_org_scoped(self):
        from users.models import Organisation
        other = Organisation.objects.create(name="Other Co Rev", slug="other-co-rev")
        e = self._event(org=other)
        self.assertEqual(self.client.post(f"/api/events/{e.id}/beo/revise/").status_code, 404)
        e.refresh_from_db()
        self.assertEqual(e.beo_revision, 1)  # and it did NOT bump

    def test_the_revision_is_not_writable_through_the_ordinary_event_api(self):
        # Only the revise endpoint moves it — otherwise an ordinary edit could
        # silently renumber a document the kitchen is holding.
        e = self._event()
        res = self.client.patch(f"/api/events/{e.id}/", {"beo_revision": 99}, format="json")
        self.assertEqual(res.status_code, 200)
        e.refresh_from_db()
        self.assertEqual(e.beo_revision, 1)


class BEONoPricingTests(BEOTestBase):
    """AC10 — an ops document carries no money."""

    def test_no_prices_totals_or_currency_anywhere(self):
        from bookings.models import BookingLineItem
        e = self._event(is_taxable=True, tax_rate=Decimal("0.0825"))
        BookingLineItem.objects.create(event=e, category="rental", description="Linens",
                                       quantity=Decimal("10"), unit="each",
                                       unit_price=Decimal("42.42"))
        BookingMeal.objects.create(event=e, label="Welcome drinks", guest_count=100,
                                   price_per_head=Decimal("19.19"), meal_time=_dt(18))
        e.recalculate_totals()
        text = self._text(e)
        symbol = OrgSettings.for_org(self.org).currency_symbol
        self.assertNotIn(symbol, text)
        for forbidden in ["137.77", "42.42", "19.19", "GRAND TOTAL", "Sub Total",
                          "TOTAL", "Tax", "per head"]:
            self.assertNotIn(forbidden, text, f"BEO leaked pricing: {forbidden}")
        # It still says what is being served and to how many — just not for how much.
        self.assertIn("Welcome drinks", text)
        self.assertIn("100 covers", text)


class BEOEndpointTests(BEOTestBase):
    """AC1 — the download endpoint."""

    def test_endpoint_returns_a_pdf(self):
        e = self._event()
        res = self.client.get(f"/api/events/{e.id}/beo/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/pdf")
        self.assertTrue(res.content.startswith(b"%PDF"))
        self.assertIn("BEO-", res["Content-Disposition"])

    def test_endpoint_is_org_scoped(self):
        from users.models import Organisation
        other = Organisation.objects.create(name="Other Co BEO", slug="other-co-beo")
        e = self._event(org=other)
        self.assertEqual(self.client.get(f"/api/events/{e.id}/beo/").status_code, 404)

    def test_endpoint_requires_authentication(self):
        e = self._event()
        anon = APIClient()
        self.assertIn(anon.get(f"/api/events/{e.id}/beo/").status_code, (401, 403))


class BEODoesNotDisturbTheFunctionSheetTests(BEOTestBase):
    """Safety — the client-facing documents are untouched by this slice."""

    def test_menu_courses_default_still_carries_plain_dish_names(self):
        # `booking_menu_courses` grew a `with_dietary` switch for the BEO; every
        # existing surface calls it without one and must see exactly what it saw
        # before (the quote/event PDF goldens depend on it).
        from bookings.services.presentation import booking_menu_courses
        e = self._event()
        cat = make_category(org=self.org)
        gf = DietaryTag.objects.get_or_create(
            slug="gluten-free", defaults={"label": "Gluten free", "short_label": "GF",
                                          "kind": DietaryTagKind.DIETARY})[0]
        dish = make_dish(org=self.org, category=cat, name="Filet Mignon")
        dish.dietary_tags.set([gf])
        e.dishes.set([dish])
        course = BookingCourse.objects.create(event=e, name="Main", sort_order=0)
        EventDishComment.objects.create(event=e, dish=dish, course=course)

        plain = booking_menu_courses(e)
        self.assertEqual(plain[0]["items"], ["Filet Mignon"])
        tagged = booking_menu_courses(e, with_dietary=True)
        self.assertEqual(tagged[0]["items"], ["Filet Mignon (GF)"])

    def test_the_public_sign_payload_does_not_leak_internal_course_ids(self):
        # `booking_menu_courses` gained `course_id` for the BEO's in-process use. The
        # presentation dict is served verbatim on the UNAUTHENTICATED /b/<token> page,
        # and a BookingCourse pk comes from a sequence shared across every org — so it
        # is dropped on the way out. Nothing on that page consumes it.
        from bookings.services.presentation import booking_presentation
        e = self._event()
        cat = make_category(org=self.org)
        dish = make_dish(org=self.org, category=cat, name="Filet Mignon")
        e.dishes.set([dish])
        course = BookingCourse.objects.create(event=e, name="Main", sort_order=0)
        EventDishComment.objects.create(event=e, dish=dish, course=course)

        groups = booking_presentation(e)["menu_courses"]
        self.assertEqual(groups, [{"name": "Main", "items": ["Filet Mignon"]}])
        for group in groups:
            self.assertNotIn("course_id", group)

    def test_the_beo_endpoint_names_the_file_after_the_revision(self):
        # The browser fetches a blob, and a blob URL carries no Content-Disposition —
        # so this header is the only way the download can be named after the revision
        # it actually is (the caller's copy of the event is already one behind).
        e = self._event()
        first = self.client.get(f"/api/events/{e.id}/beo/")
        self.assertIn(f'filename="BEO-{e.id}-Rev1.pdf"', first["Content-Disposition"])
        # Downloading again names the same file — nothing changed, so nothing is stale.
        again = self.client.get(f"/api/events/{e.id}/beo/")
        self.assertIn(f'filename="BEO-{e.id}-Rev1.pdf"', again["Content-Disposition"])
        # Issue a revision, and only then does the name move.
        self.client.post(f"/api/events/{e.id}/beo/revise/")
        after = self.client.get(f"/api/events/{e.id}/beo/")
        self.assertIn(f'filename="BEO-{e.id}-Rev2.pdf"', after["Content-Disposition"])

    def test_function_sheet_still_renders_its_totals(self):
        from bookings.pdf import generate_event_pdf
        e = self._event()
        e.recalculate_totals()
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        reader = PdfReader(io.BytesIO(generate_event_pdf(e)))
        text = "\n".join(p.extract_text() for p in reader.pages)
        self.assertIn("EVENT FUNCTION SHEET", text)
        self.assertIn("GRAND TOTAL", text)
