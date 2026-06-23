"""Invariant: a user with an organisation is a tenant user and cannot have admin
access (staff or superuser). Admin/system accounts must have no organisation.
This is what keeps org users out of the Django panel entirely."""
from django.core.exceptions import ValidationError
from django.test import TestCase

from users.models import Organisation, User


class TestTenantUserAdminAccessGuard(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Acme", slug="acme", country="PK")

    def test_superuser_with_org_is_rejected(self):
        u = User(email="bad@sys.com", is_superuser=True, organisation=self.org)
        with self.assertRaises(ValidationError) as cm:
            u.clean()
        self.assertIn("organisation", cm.exception.message_dict)

    def test_staff_with_org_is_rejected(self):
        # Staff-but-not-superuser still gets the Django-admin login — also blocked.
        u = User(email="staff@acme.com", is_staff=True, is_superuser=False, organisation=self.org)
        with self.assertRaises(ValidationError):
            u.clean()

    def test_system_account_without_org_is_ok(self):
        # A real admin/system account: staff + superuser, no org.
        User(email="root@sys.com", is_staff=True, is_superuser=True).clean()  # must not raise

    def test_normal_org_user_is_ok(self):
        User(email="rep@acme.com", is_staff=False, is_superuser=False, organisation=self.org).clean()
