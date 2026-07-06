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

# rep email -> (monthly target, this-month closed revenue) — drives dashboard attainment
DEMO_TARGETS = {
    "rep@demo.test": (Decimal("1000000"), Decimal("1200000")),   # 120%
    "rep2@demo.test": (Decimal("800000"), Decimal("600000")),    # 75%
}


class Command(BaseCommand):
    help = "Seed a deterministic demo org, logins and commission data (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--org", default="Demo Co", help="Organisation name to seed into.")

    @transaction.atomic
    def handle(self, *args, **options):
        org_name = options["org"]
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
        settings_obj.target_period = "monthly"
        settings_obj.commission_basis = "event_date"
        settings_obj.fiscal_year_start_month = 1
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
        for name, email in [("Aisha Khan", "aisha@example.com"), ("Bilal Ahmed", "bilal@example.com")]:
            Contact.objects.get_or_create(organisation=org, name=name, defaults={"email": email, "phone": "0300-0000000"})
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
        users = {}
        for email, first, last, role, password in DEMO_USERS:
            u, _ = User.objects.get_or_create(
                email=email,
                defaults={"first_name": first, "last_name": last, "role": role, "organisation": org},
            )
            u.first_name, u.last_name, u.role, u.organisation = first, last, role, org
            u.is_active = True
            u.set_password(password)
            u.save()
            users[email] = u
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(users)} users"))

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
            Event.objects.create(
                organisation=org, name=f"{DEMO_TAG} {rep.first_name}'s event",
                gents=50, ladies=50, event_date=today, assigned_to=rep,
                status="confirmed", total=this_month_revenue,
            )
        self.stdout.write(self.style.SUCCESS(
            f"Seeded targets ({n_periods} monthly cells/rep) + events for {len(rep_emails)} reps"
        ))

        # A few leads per rep across the org's statuses, for the pipeline dashboard.
        statuses = list(
            LeadStatusOption.objects.filter(organisation=org, is_active=True)
            .order_by("sort_order").values_list("value", flat=True)
        )
        if statuses:
            for email in rep_emails:
                rep = users[email]
                for j, st in enumerate(statuses[:5]):
                    Lead.objects.create(
                        organisation=org, assigned_to=rep, status=st,
                        contact_name=f"{rep.first_name} Lead {j + 1}",
                        contact_email=f"lead{j + 1}.{rep.email}", contact_phone="000",
                        budget=Decimal("250000"), notes=f"{DEMO_TAG} pipeline sample",
                    )
            self.stdout.write(self.style.SUCCESS(f"Seeded sample leads across {len(statuses[:5])} statuses"))

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Demo logins:"))
        for email, _f, _l, role, password in DEMO_USERS:
            self.stdout.write(f"  {email:20} {password:12} ({role})")

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
