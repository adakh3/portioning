"""Multi-tenancy fixes: labor-role names are per-org, and AllocationRule is
org-scoped (can't reference another org's role)."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from users.models import Organisation
from staff.models import LaborRole, AllocationRule


class LaborRolePerOrgUniqueTests(TestCase):
    def setUp(self):
        self.a = Organisation.objects.create(name="A", slug="a", country="US")
        self.b = Organisation.objects.create(name="B", slug="b", country="US")

    def test_two_orgs_can_each_have_a_server_role(self):
        # Previously LaborRole.name was globally unique — this would have failed.
        LaborRole.objects.create(organisation=self.a, name="Server", default_hourly_rate=Decimal("20"))
        LaborRole.objects.create(organisation=self.b, name="Server", default_hourly_rate=Decimal("25"))
        self.assertEqual(LaborRole.objects.filter(name="Server").count(), 2)

    def test_same_name_twice_in_one_org_is_blocked(self):
        LaborRole.objects.create(organisation=self.a, name="Server", default_hourly_rate=Decimal("20"))
        with self.assertRaises(Exception):
            LaborRole.objects.create(organisation=self.a, name="Server", default_hourly_rate=Decimal("22"))


class AllocationRuleOrgScopingTests(TestCase):
    def setUp(self):
        self.a = Organisation.objects.create(name="A", slug="a", country="US")
        self.b = Organisation.objects.create(name="B", slug="b", country="US")
        self.role_a = LaborRole.objects.create(organisation=self.a, name="Server",
                                               default_hourly_rate=Decimal("20"))

    def test_rule_in_same_org_is_fine(self):
        rule = AllocationRule.objects.create(
            organisation=self.a, role=self.role_a, guests_per_staff=30,
        )
        self.assertEqual(rule.organisation, self.a)

    def test_cannot_reference_another_orgs_role(self):
        # OrgScopedModel.save() blocks a cross-org FK at the model layer.
        rule = AllocationRule(organisation=self.b, role=self.role_a, guests_per_staff=30)
        with self.assertRaises(ValidationError):
            rule.save()
