"""Tests for org-scoped security boundaries (defense in depth).

Layer 1 — serializer (OrgScopedModelSerializer): writable FK fields reject PKs
that belong to another organisation at the API boundary (clean 400s).
Layer 2 — model (OrgScopedModel.save / m2m_changed): the data-layer backstop
that fires for admin/shell/non-DRF writes too.
Plus LeadBulkUpdateView, whose bulk `.update()` bypasses both layers and so
validates explicitly.

OWASP A01 (Broken Access Control) / A04 (Insecure Design).
"""
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, APIClient

from users.models import Organisation, User
from staff.models import LaborRole, StaffMember
from staff.serializers import ShiftSerializer
from bookings.models import Lead
from bookings.models.leads import ProductLine


def make_org(slug, name=None, country="PK"):
    return Organisation.objects.create(slug=slug, name=name or slug.title(), country=country)


def make_user(org, email, role="owner", **kwargs):
    return User.objects.create(
        email=email, first_name="T", last_name="U", role=role, organisation=org, **kwargs
    )


def make_request(user, all_orgs=False):
    """Build a bare request whose effective org resolves to `user.organisation`.

    OrgMiddleware doesn't run for the request factory, so get_request_org()
    falls back to user.organisation — exactly the path the mixin relies on.
    """
    request = APIRequestFactory().post("/")
    request.user = user
    if all_orgs:
        request._org_all_override = True
    return request


class OrgScopedSerializerMixinTests(TestCase):
    """A writable FK field must only accept PKs from the request's org."""

    def setUp(self):
        self.org_a = make_org("org-a")
        self.org_b = make_org("org-b")
        self.user_a = make_user(self.org_a, "a@example.com")
        self.role_a = LaborRole.objects.create(organisation=self.org_a, name="Server A", default_hourly_rate="20.00")
        self.role_b = LaborRole.objects.create(organisation=self.org_b, name="Server B", default_hourly_rate="20.00")

    def _validate_role(self, role_pk, request):
        serializer = ShiftSerializer(
            data={
                "role": role_pk,
                "event": 999999,  # irrelevant: we only assert on the `role` field
                "start_time": timezone.now().isoformat(),
                "end_time": (timezone.now() + timedelta(hours=4)).isoformat(),
            },
            context={"request": request},
        )
        serializer.is_valid()
        return serializer.errors

    def test_rejects_fk_from_other_org(self):
        errors = self._validate_role(self.role_b.pk, make_request(self.user_a))
        self.assertIn("role", errors)

    def test_accepts_fk_from_own_org(self):
        errors = self._validate_role(self.role_a.pk, make_request(self.user_a))
        self.assertNotIn("role", errors)

    def test_rejects_fk_when_request_has_no_org(self):
        orphan = make_user(self.org_a, "orphan@example.com")
        orphan.organisation = None
        orphan.save(update_fields=["organisation"])
        errors = self._validate_role(self.role_a.pk, make_request(orphan))
        self.assertIn("role", errors)

    def test_superuser_all_orgs_keeps_unscoped_queryset(self):
        su = make_user(self.org_a, "su@example.com", is_superuser=True, is_staff=True)
        errors = self._validate_role(self.role_b.pk, make_request(su, all_orgs=True))
        self.assertNotIn("role", errors)


class LeadBulkUpdateOrgScopingTests(TestCase):
    """Bulk assign/product actions must reject FK values from another org."""

    URL = "/api/bookings/leads/bulk/"

    def setUp(self):
        self.org_a = make_org("bulk-a")
        self.org_b = make_org("bulk-b")
        self.user_a = make_user(self.org_a, "bulk-a@example.com")
        self.user_b = make_user(self.org_b, "bulk-b@example.com")
        self.product_a = ProductLine.objects.create(organisation=self.org_a, name="Catering")
        self.product_b = ProductLine.objects.create(organisation=self.org_b, name="Catering")
        self.lead = Lead.objects.create(
            organisation=self.org_a,
            contact_name="John Smith",
            contact_email="john@test.com",
            source="website",
            event_type="wedding",
            event_date="2026-06-15",
            guest_estimate=100,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user_a)

    def test_assign_to_user_in_other_org_rejected(self):
        resp = self.client.post(
            self.URL,
            {"ids": [self.lead.pk], "action": "assign", "value": self.user_b.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.lead.refresh_from_db()
        self.assertIsNone(self.lead.assigned_to_id)

    def test_set_product_from_other_org_rejected(self):
        resp = self.client.post(
            self.URL,
            {"ids": [self.lead.pk], "action": "product", "value": self.product_b.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.lead.refresh_from_db()
        self.assertIsNone(self.lead.product_id)

    def test_set_product_from_own_org_succeeds(self):
        resp = self.client.post(
            self.URL,
            {"ids": [self.lead.pk], "action": "product", "value": self.product_a.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.lead.refresh_from_db()
        self.assertEqual(self.lead.product_id, self.product_a.pk)


class OrgScopedModelLayerTests(TestCase):
    """OrgScopedModel.save() blocks cross-org FKs on non-DRF write paths."""

    def setUp(self):
        self.org_a = make_org("model-a")
        self.org_b = make_org("model-b")
        self.product_a = ProductLine.objects.create(organisation=self.org_a, name="Catering")
        self.product_b = ProductLine.objects.create(organisation=self.org_b, name="Catering")

    def _new_lead(self, **kwargs):
        defaults = dict(
            organisation=self.org_a,
            contact_name="John Smith",
            contact_email="john@test.com",
            source="website",
            event_type="wedding",
            event_date="2026-06-15",
            guest_estimate=100,
        )
        defaults.update(kwargs)
        return Lead(**defaults)

    def test_save_rejects_fk_from_other_org(self):
        lead = self._new_lead(product=self.product_b)
        with self.assertRaises(ValidationError):
            lead.save()
        self.assertFalse(Lead.objects.filter(contact_email="john@test.com").exists())

    def test_save_accepts_fk_from_own_org(self):
        lead = self._new_lead(product=self.product_a)
        lead.save()  # must not raise
        self.assertEqual(lead.product_id, self.product_a.pk)

    def test_save_allows_null_fk(self):
        lead = self._new_lead(product=None)
        lead.save()  # null FK is not a cross-org reference
        self.assertIsNone(lead.product_id)


class OrgScopedM2MTests(TestCase):
    """m2m_changed backstop blocks linking M2M rows from another org."""

    def setUp(self):
        self.org_a = make_org("m2m-a")
        self.org_b = make_org("m2m-b")
        self.staff = StaffMember.objects.create(organisation=self.org_a, name="Bob")
        self.role_a = LaborRole.objects.create(organisation=self.org_a, name="Server A", default_hourly_rate="20.00")
        self.role_b = LaborRole.objects.create(organisation=self.org_b, name="Server B", default_hourly_rate="20.00")

    def test_add_role_from_other_org_rejected(self):
        # .add() opens its own transaction; the signal raising aborts it.
        # Wrap in a savepoint so the outer test transaction stays usable.
        with self.assertRaises(ValidationError):
            with transaction.atomic():
                self.staff.roles.add(self.role_b)
        self.assertEqual(self.staff.roles.count(), 0)

    def test_add_role_from_own_org_succeeds(self):
        self.staff.roles.add(self.role_a)
        self.assertEqual(self.staff.roles.count(), 1)
