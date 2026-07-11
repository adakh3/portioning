"""The Organisation admin is a one-stop hub: users, subscription, and settings
are managed as inlines on the org page. Covers the tricky bits — the user inline
must hash passwords, require one on create, and Stripe ids stay editable so a
stale customer can be cleared in place."""
from django.contrib.admin.sites import site
from django.test import TestCase

from users.admin import OrganisationAdmin, OrgUserInline, SubscriptionInline, OrgSettingsInline, OrgUserInlineForm
from users.models import Organisation, User


class OrgHubInlineTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Hub Co", slug="hub-co", country="US")

    def test_org_admin_exposes_the_three_hub_inlines(self):
        admin = OrganisationAdmin(Organisation, site)
        classes = admin.inlines
        self.assertIn(OrgSettingsInline, classes)
        self.assertIn(SubscriptionInline, classes)
        self.assertIn(OrgUserInline, classes)

    def test_subscription_inline_lets_stripe_ids_be_cleared(self):
        # The reset-linkage escape hatch: unlike the standalone admin, the ids are
        # NOT read-only here.
        ro = SubscriptionInline(Organisation, site).get_readonly_fields(request=None)
        self.assertNotIn("stripe_customer_id", ro)
        self.assertNotIn("stripe_subscription_id", ro)


class OrgUserInlineFormTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Hub Co", slug="hub-co", country="US")

    def _form(self, data, instance=None):
        f = OrgUserInlineForm(data=data, instance=instance)
        f.instance.organisation = self.org  # set by the inline's parent in real use
        return f

    def test_new_user_requires_a_password(self):
        f = self._form({"email": "a@x.com", "role": "owner", "is_active": True, "new_password": ""})
        self.assertFalse(f.is_valid())
        self.assertIn("new_password", f.errors)

    def test_creates_user_with_usable_hashed_password(self):
        f = self._form({"email": "owner@x.com", "first_name": "O", "last_name": "K",
                        "role": "owner", "is_active": True, "new_password": "Secret123!"})
        self.assertTrue(f.is_valid(), f.errors)
        user = f.save()
        user.refresh_from_db()
        self.assertTrue(user.check_password("Secret123!"))
        self.assertEqual(user.organisation, self.org)
        self.assertEqual(user.role, "owner")

    def test_editing_without_password_keeps_the_old_one(self):
        user = User.objects.create_user(email="u@x.com", password="Original1!", organisation=self.org)
        f = OrgUserInlineForm(
            data={"email": "u@x.com", "role": "manager", "is_active": True, "new_password": ""},
            instance=user,
        )
        self.assertTrue(f.is_valid(), f.errors)
        f.save()
        user.refresh_from_db()
        self.assertTrue(user.check_password("Original1!"))  # unchanged
        self.assertEqual(user.role, "manager")  # other edits applied
