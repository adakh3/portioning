"""Role model: admin tier sits below owner. Admins get org settings + user
management, but cannot touch the owner. Managers don't get admin settings.
Superuser maps to owner."""
from django.test import TestCase
from rest_framework.test import APIClient

from users.models import Organisation, User

SETTINGS_PATCH = "/api/bookings/settings/"
LEAD_STATUS = "/api/bookings/settings/lead-statuses/"
USERS = "/api/auth/users/"
ORGANISATIONS = "/api/auth/organisations/"


class TestRolePermissions(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="RoleOrg", slug="roleorg", country="PK")
        self.owner = self._u("owner@x.com", "owner")
        self.admin = self._u("admin@x.com", "admin")
        self.manager = self._u("manager@x.com", "manager")
        # A superuser operating within an org context (as if switched into it).
        # .create() bypasses the model clean() guard that forbids superuser+org.
        self.su = User.objects.create(
            email="su@x.com", is_superuser=True, is_staff=True, is_active=True, organisation=self.org,
        )

    def _u(self, email, role):
        return User.objects.create(email=email, role=role, organisation=self.org, is_active=True)

    def _c(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    # --- settings (admin/owner only; not manager) ---
    def test_admin_can_edit_org_settings_manager_cannot(self):
        self.assertEqual(self._c(self.admin).patch(SETTINGS_PATCH, {"currency_symbol": "$"}, format="json").status_code, 200)
        self.assertIn(self._c(self.manager).patch(SETTINGS_PATCH, {"currency_symbol": "£"}, format="json").status_code, (401, 403))

    def test_admin_can_manage_lead_statuses_manager_cannot(self):
        self.assertEqual(self._c(self.admin).post(LEAD_STATUS, {"label": "New Stage"}, format="json").status_code, 201)
        self.assertIn(self._c(self.manager).post(LEAD_STATUS, {"label": "Nope"}, format="json").status_code, (401, 403))

    def test_superuser_maps_to_owner_for_settings(self):
        self.assertEqual(self._c(self.su).patch(SETTINGS_PATCH, {"currency_symbol": "€"}, format="json").status_code, 200)

    def test_org_switcher_list_excludes_inactive_orgs(self):
        # Admin can deactivate an org; the switcher endpoint must then hide it.
        Organisation.objects.create(name="Active Co", slug="active-co", country="PK", is_active=True)
        Organisation.objects.create(name="Gone Co", slug="gone-co", country="PK", is_active=False)
        res = self._c(self.su).get(ORGANISATIONS)
        self.assertEqual(res.status_code, 200)
        names = [o["name"] for o in res.json()]
        self.assertIn("Active Co", names)
        self.assertNotIn("Gone Co", names)

    # --- user management (admin/owner; admin can't touch owner) ---
    def test_admin_can_create_non_owner(self):
        res = self._c(self.admin).post(USERS, {"email": "m2@x.com", "first_name": "M", "last_name": "Two", "role": "manager"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)

    def test_admin_cannot_create_owner(self):
        res = self._c(self.admin).post(USERS, {"email": "o2@x.com", "first_name": "O", "last_name": "Two", "role": "owner"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_admin_cannot_edit_owner(self):
        res = self._c(self.admin).patch(f"{USERS}{self.owner.id}/", {"first_name": "Hacked"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.owner.refresh_from_db()
        self.assertNotEqual(self.owner.first_name, "Hacked")

    def test_admin_cannot_promote_to_owner(self):
        res = self._c(self.admin).patch(f"{USERS}{self.manager.id}/", {"role": "owner"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_owner_can_edit_owner(self):
        res = self._c(self.owner).patch(f"{USERS}{self.owner.id}/", {"first_name": "Boss"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_manager_cannot_access_user_management(self):
        self.assertIn(self._c(self.manager).get(USERS).status_code, (401, 403))
