"""Seed a deterministic demo dataset so every worktree / fresh clone tests against
the SAME org, logins and commission data.

Idempotent — re-running resets passwords and rebuilds the demo transactional rows
(tagged events/leads) so the state is identical every time. Safe to run repeatedly.

    python manage.py seed_demo            # into "Demo Co"
    python manage.py seed_demo --org "X"  # into a named org

Reference data (dishes/menus/rules) still comes from `loaddata seed.json`; this
command owns the *accounts* and *demo activity* that seed.json deliberately omits.
"""
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from bookings.models import CommissionPlan, CommissionBand, OrgSettings, SalesTarget, RepCommissionPlan
from bookings.models.choices import LeadStatusOption, EventTypeOption, MealTypeOption, ServiceStyleOption
from bookings.models import Lead, Account, Contact, ProductLine
from bookings.services.commission import period_position, PERIOD_LENGTHS
from events.models import Event
from payments.models import Subscription, SubscriptionStatus
from users.models import Organisation, User

DEMO_TAG = "[demo]"  # marks rows this command owns, so re-runs can rebuild them cleanly

# email, first, last, role, password
DEMO_USERS = [
    ("owner@demo.test", "Olivia", "Owner", "owner", "Owner123!"),
    ("admin@demo.test", "Adam", "Admin", "admin", "Admin123!"),
    ("manager@demo.test", "Maya", "Manager", "manager", "Manager123!"),
    ("rep@demo.test", "Demo", "Rep", "salesperson", "Sales123!"),
    ("rep2@demo.test", "Sam", "Sales", "salesperson", "Sales123!"),
]

# The org whose logins keep the plain @demo.test addresses — docs, the e2e helper and
# habit all point at it. Every other seeded org gets its own @<slug>.test logins.
DEFAULT_ORG_NAME = "Demo Co"

# rep email -> (monthly target, this-month closed revenue) — drives dashboard attainment
DEMO_TARGETS = {
    "rep@demo.test": (Decimal("1000000"), Decimal("1200000")),   # 120%
    "rep2@demo.test": (Decimal("800000"), Decimal("600000")),    # 75%
}


class Command(BaseCommand):
    help = "Seed a deterministic demo org, logins and commission data (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--org", default=DEFAULT_ORG_NAME, help="Organisation name to seed into.")
        parser.add_argument(
            "--profile", default="plated", choices=["plated", "buffet"],
            help=(
                "What kind of caterer to seed. 'buffet' is a buffet-first, "
                "high-volume operator (big head counts, no plated choices) — use it "
                "to check a change works for a caterer who never plates."
            ),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        org_name = options["org"]
        profile = options["profile"]
        org, created = Organisation.objects.get_or_create(
            name=org_name, defaults={"slug": slugify(org_name) or "demo-co"},
        )
        self.stdout.write(self.style.SUCCESS(f"{'Created' if created else 'Using'} org: {org_name}"))

        # Billing is card-required, so a brand-new org has no access and would be
        # paywalled. This is a dev/demo seed — grant the demo org an active
        # subscription so the whole app is usable without going through Stripe.
        sub, _ = Subscription.objects.get_or_create(organisation=org)
        sub.status = SubscriptionStatus.ACTIVE
        sub.plan_name = sub.plan_name or "Demo (seeded)"
        sub.trial_ends_at = None
        sub.save()

        # Org settings: monthly targets, commission by event date, calendar year.
        settings_obj = OrgSettings.for_org(org)
        # Locale/pricing defaults must match the org's country (e.g. a US org gets a
        # 20% service charge). The org-creation signal normally applies these, but a
        # demo org restored from seed.json via loaddata bypasses the signal AND
        # predates the country-defaults feature (null service charge), and
        # get_or_create above won't re-fire the signal — so re-apply them here so the
        # demo org is always a correct US org (idempotent reset). This is the bug that
        # made a seeded Demo Co show no service charge.
        from users.country_defaults import defaults_for_country
        for _field, _val in defaults_for_country(org.country).items():
            setattr(settings_obj, _field, _val)
        settings_obj.target_period = "monthly"
        settings_obj.commission_basis = "event_date"
        settings_obj.fiscal_year_start_month = 1
        # Starter T&C template — only if the org hasn't set its own (idempotent so
        # re-seeding an existing demo org backfills terms without clobbering edits).
        if not settings_obj.quotation_terms:
            from bookings.default_terms import DEFAULT_QUOTATION_TERMS
            settings_obj.quotation_terms = DEFAULT_QUOTATION_TERMS
        settings_obj.save()

        # Booking-form reference options + a few customers, so the quote/event
        # editors are testable (a fresh org otherwise has empty dropdowns).
        for i, (val, label) in enumerate([
            ("wedding", "Wedding"), ("corporate", "Corporate Event"),
            ("birthday", "Birthday"), ("other", "Other"),
        ]):
            EventTypeOption.objects.get_or_create(organisation=org, value=val, defaults={"label": label, "sort_order": i})
        for i, (val, label) in enumerate([
            ("breakfast", "Breakfast"), ("lunch", "Lunch"), ("hi_tea", "Hi-Tea"), ("dinner", "Dinner"),
        ]):
            MealTypeOption.objects.get_or_create(organisation=org, value=val, defaults={"label": label, "sort_order": i})
        for i, (val, label) in enumerate([
            ("buffet", "Buffet"), ("plated", "Plated"), ("family", "Family Style"), ("mixed", "Mixed Service"),
        ]):
            ServiceStyleOption.objects.get_or_create(organisation=org, value=val, defaults={"label": label, "sort_order": i})
        Account.objects.get_or_create(organisation=org, name="Acme Corp", defaults={"account_type": "company"})
        for i, (name, email) in enumerate([("Aisha Khan", "aisha@example.com"), ("Bilal Ahmed", "bilal@example.com")]):
            Contact.objects.get_or_create(organisation=org, name=name, defaults={"email": email, "phone": f"+1415555200{i}"})
        # Product lines so the booking form's Product picker has options (the first
        # is the org default, pre-selected on new bookings).
        for i, (pname, colour) in enumerate([("Weddings", "#EC4899"), ("Corporate", "#3B82F6"), ("Private Dining", "#10B981")]):
            ProductLine.objects.get_or_create(organisation=org, name=pname, defaults={"colour": colour, "is_default": i == 0})
        # A full featured add-on catalog so the booking form's add-on picker is
        # populated for testing — beverages, rentals/arrangements, fees, labour,
        # plus a couple of multi-variant groups (Soft Drinks, Dera, Packaging).
        from bookings.models import AddOnProduct, AddOnVariant
        addons = [
            # (category, name, base_price, [(variant name, price), ...])
            ("beverage", "Mineral Water 1.5L", "80", []),
            ("beverage", "Mineral Water 500ml", "60", []),
            ("beverage", "Soft Drinks", "0", [("1.5L", "150"), ("Tins", "80")]),
            ("beverage", "Juices", "200", []),
            ("beverage", "Tea & Coffee", "100", []),
            ("beverage", "Green Tea", "50", []),
            ("beverage", "Mocktails", "250", []),
            ("beverage", "Milkshake", "300", []),
            ("rental", "Buffet Station", "10000", []),
            ("rental", "Cocktail / Poseur Table", "8000", []),
            ("rental", "Live Cooking Station", "7500", []),
            ("rental", "Drinks Station", "6000", []),
            ("rental", "Round Table Setting", "350", []),
            ("rental", "Trestle Table Setting", "300", []),
            ("rental", "Dessert Display", "5000", []),
            ("rental", "Sound System", "15000", []),
            ("rental", "Basic Lighting", "12000", []),
            ("rental", "Heater", "2000", []),
            ("rental", "Canopy", "4000", []),
            ("rental", "Dera", "0", [("60 x 90", "75000"), ("90 x 90", "90000")]),
            ("rental", "AC", "8000", []),
            ("rental", "Marquee", "50000", []),
            ("rental", "Stage / Rostrum", "20000", []),
            ("rental", "Sofa", "3000", []),
            ("rental", "Chairs", "100", []),
            ("rental", "Packaging / Boxes", "0", [("Plastic Box", "40"), ("Styrofoam Box", "30")]),
            ("fee", "Transportation", "10000", []),
            ("fee", "Service Charge", "5000", []),
            ("labor", "Ushers", "1500", []),
            ("labor", "Valet", "2000", []),
            ("labor", "Waiters", "1500", []),
        ]
        for i, (cat, name, price, variants) in enumerate(addons):
            p, _ = AddOnProduct.objects.get_or_create(
                organisation=org, name=name,
                defaults={"category": cat, "default_unit": "each",
                          "unit_price": Decimal(price), "is_featured": True,
                          "is_active": True, "sort_order": i},
            )
            for j, (vname, vprice) in enumerate(variants):
                AddOnVariant.objects.get_or_create(
                    organisation=org, product=p, name=vname,
                    defaults={"unit_price": Decimal(vprice), "is_active": True, "sort_order": j},
                )

        # Commission plans: a default flat plan + a "Senior" accelerated plan.
        default_plan = self._plan(org, "Default", model="flat", flat_rate="5", is_default=True)
        senior_plan = self._plan(
            org, "Senior", model="accelerated", flat_rate="0",
            bands=[("0", "4"), ("100", "7")],
        )

        # Users (idempotent; passwords always reset so logins are deterministic).
        #
        # Each org gets its OWN logins. A User's email is unique account-wide, so
        # seeding a second org used to re-home owner@demo.test onto it and silently
        # orphan the first — you could only ever be inside whichever org was seeded
        # last. The default org keeps @demo.test (docs, e2e and muscle memory all use
        # it); any other org gets @<slug>.test.
        domain = "demo.test" if org_name == DEFAULT_ORG_NAME else f"{org.slug}.test"
        users = {}
        for email, first, last, role, password in DEMO_USERS:
            scoped = f"{email.split('@')[0]}@{domain}"
            u, _ = User.objects.get_or_create(
                email=scoped,
                defaults={"first_name": first, "last_name": last, "role": role, "organisation": org},
            )
            u.first_name, u.last_name, u.role, u.organisation = first, last, role, org
            u.is_active = True
            u.set_password(password)
            u.save()
            users[email] = u  # keyed by the CANONICAL email, so DEMO_TARGETS still matches
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(users)} users on @{domain}"))

        # Wipe demo-tagged transactional rows so a re-run rebuilds identical state.
        Event.objects.filter(organisation=org, name__startswith=DEMO_TAG).delete()
        Lead.objects.filter(organisation=org, notes__startswith=DEMO_TAG).delete()

        today = timezone.now().date()
        fy, idx, _ = period_position(today, "monthly", 1)
        n_periods = PERIOD_LENGTHS["monthly"]

        # Per-rep: assign a plan, fill the whole FY's monthly target cells, and book a
        # confirmed event this month so the dashboard shows real attainment.
        rep_emails = ["rep@demo.test", "rep2@demo.test"]
        for i, email in enumerate(rep_emails):
            rep = users[email]
            monthly_target, this_month_revenue = DEMO_TARGETS[email]
            RepCommissionPlan.objects.update_or_create(
                organisation=org, user=rep,
                defaults={"plan": senior_plan if i == 1 else default_plan},
            )
            for p in range(n_periods):
                SalesTarget.objects.update_or_create(
                    organisation=org, user=rep, period_type="monthly",
                    fiscal_year=fy, period_index=p,
                    defaults={"amount": monthly_target},
                )
            # Price the event so the ENGINE produces the demo revenue, instead of
            # writing `total=` directly. A hand-set total is a number no recompute
            # would ever produce: it fails the reconciliation command and violates
            # the total invariant (total = subtotal + charges + tax + gratuity), so
            # the demo data was the first thing to break its own checks (REL-464).
            # Both demo figures divide evenly by 100 covers, so the totals stay exact.
            demo_event = Event.objects.create(
                organisation=org, name=f"{DEMO_TAG} {rep.first_name}'s event",
                guest_count=100, gents=50, ladies=50, event_date=today, assigned_to=rep,
                status="confirmed", price_per_head=this_month_revenue / 100,
                service_style="buffet" if profile == "buffet" else "",
            )
            demo_event.recalculate_totals()
        self.stdout.write(self.style.SUCCESS(
            f"Seeded targets ({n_periods} monthly cells/rep) + events for {len(rep_emails)} reps"
        ))

        if profile == "buffet":
            self._seed_buffet_bookings(org, users["rep@demo.test"], today)

        # A few leads per rep across the org's statuses, for the pipeline dashboard.
        statuses = list(
            LeadStatusOption.objects.filter(organisation=org, is_active=True)
            .order_by("sort_order").values_list("value", flat=True)
        )
        if statuses:
            for ri, email in enumerate(rep_emails):
                rep = users[email]
                for j, st in enumerate(statuses[:5]):
                    Lead.objects.create(
                        organisation=org, assigned_to=rep, status=st,
                        contact_name=f"{rep.first_name} Lead {j + 1}",
                        contact_email=f"lead{j + 1}.{rep.email}",
                        # Valid E.164 (US 555 test range) so the WhatsApp buttons work in dev.
                        contact_phone=f"+1415555{ri}{j:03d}",
                        budget=Decimal("250000"), notes=f"{DEMO_TAG} pipeline sample",
                    )
            self.stdout.write(self.style.SUCCESS(f"Seeded sample leads across {len(statuses[:5])} statuses"))

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING(f"Demo logins for {org_name}:"))
        for email, _f, _l, role, password in DEMO_USERS:
            scoped = f"{email.split('@')[0]}@{domain}"
            self.stdout.write(f"  {scoped:34} {password:12} ({role})")

    def _seed_buffet_bookings(self, org, rep, today):
        """Two menus a buffet-first caterer would actually build.

        A caterer who never plates still needs the menu card to work, and their two
        shapes are the ones a plated demo never produces: a long flat dish list with
        no courses at all, and the same food broken into stations. Both are buffet,
        so neither shows a guest choice — that is the point of having them.
        """
        from events.models import BookingCourse, EventDishComment
        from dishes.models import Dish

        dishes = list(Dish.objects.filter(organisation=org).order_by("id")[:9])
        if not dishes:
            self.stdout.write(self.style.WARNING("No dishes in this org — skipped buffet menus."))
            return
        # A booking with no customer can't be saved from the event form ("Customer is
        # required"), which would make these demo menus look at but not edit.
        contact = Contact.objects.filter(organisation=org).order_by("id").first()

        # 1. The flat one: no courses, so the card is a plain list (REL-451 AC8).
        flat = Event.objects.create(
            organisation=org, name=f"{DEMO_TAG} Corporate lunch buffet",
            guest_count=400, event_date=today, assigned_to=rep, primary_contact=contact,
            status="confirmed", service_style="buffet", price_per_head=Decimal("38.00"),
        )
        flat.dishes.set(dishes)
        for d in dishes:
            EventDishComment.objects.get_or_create(event=flat, dish=d)

        # 2. The same food as stations — courses on a buffet are legitimate, and this
        #    is the booking that proves the card doesn't treat them as plated-only.
        stations = Event.objects.create(
            organisation=org, name=f"{DEMO_TAG} Wedding buffet — stations",
            guest_count=650, event_date=today, assigned_to=rep, primary_contact=contact,
            status="confirmed", service_style="buffet", price_per_head=Decimal("52.00"),
        )
        stations.dishes.set(dishes)
        course_rows = [
            BookingCourse.objects.create(event=stations, name=name, sort_order=i)
            for i, name in enumerate(["Salad Station", "Hot Buffet", "Dessert Table"])
        ]
        for i, d in enumerate(dishes):
            # Three per station, and anything left over stays un-coursed so the
            # "Not in a course yet" section has something real in it.
            course = course_rows[i // 3] if i < 9 else None
            EventDishComment.objects.get_or_create(event=stations, dish=d, defaults={"course": course})

        self.stdout.write(self.style.SUCCESS(
            "Seeded 2 buffet menus: a flat 400-guest list and a 650-guest stations menu"
        ))

    def _plan(self, org, name, *, model, flat_rate, is_default=False, bands=None):
        plan, _ = CommissionPlan.objects.get_or_create(
            organisation=org, name=name, defaults={"is_default": is_default},
        )
        plan.commission_model = model
        plan.commission_flat_rate = Decimal(flat_rate)
        plan.is_default = is_default or plan.is_default
        plan.save()
        CommissionBand.objects.filter(plan=plan).delete()
        for pct, rate in (bands or []):
            CommissionBand.objects.create(
                organisation=org, plan=plan,
                min_attainment_pct=Decimal(pct), rate=Decimal(rate),
            )
        return plan
