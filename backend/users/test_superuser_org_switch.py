"""Superuser org-switch resolution for JWT-authenticated API requests.

Regression for: OrgMiddleware runs BEFORE DRF's CookieJWTAuthentication, so on a
JWT request request.user is anonymous at middleware time and the switcher's
session ``org_override`` was never applied — a superuser stayed stuck on their
own org whatever they picked. get_request_org now resolves the override post-auth.
"""
from types import SimpleNamespace

from django.test import TestCase

from users.models import Organisation, User
from users.mixins import get_request_org, is_superuser_all_orgs


def jwt_request(user, override=None):
    """A JWT-style request: OrgMiddleware left request.organisation unset (it ran
    before auth) and set no all-orgs flag; the session carries the switcher pick."""
    session = {} if override is None else {'org_override': override}
    return SimpleNamespace(user=user, session=session)


class SuperuserOrgSwitchTests(TestCase):
    def setUp(self):
        self.a = Organisation.objects.create(name="A", slug="a", country="US")
        self.b = Organisation.objects.create(name="B", slug="b", country="US")
        self.su = User.objects.create_user(email="su@x.com", password="x",
                                            organisation=self.a, is_superuser=True, is_staff=True)
        self.regular = User.objects.create_user(email="u@x.com", password="x", organisation=self.a)

    def test_superuser_switch_resolves_to_the_chosen_org(self):
        # The bug: this returned org A (own) instead of B.
        self.assertEqual(get_request_org(jwt_request(self.su, override=self.b.pk)), self.b)

    def test_superuser_no_override_uses_own_org(self):
        self.assertEqual(get_request_org(jwt_request(self.su)), self.a)

    def test_superuser_stale_override_falls_back_to_own_org(self):
        self.assertEqual(get_request_org(jwt_request(self.su, override=999999)), self.a)

    def test_all_orgs_override(self):
        req = jwt_request(self.su, override='__all__')
        self.assertIsNone(get_request_org(req))
        self.assertTrue(is_superuser_all_orgs(req))

    def test_specific_override_is_not_all_orgs(self):
        self.assertFalse(is_superuser_all_orgs(jwt_request(self.su, override=self.b.pk)))

    def test_regular_user_ignores_override_and_uses_own_org(self):
        # A non-superuser can't switch — any override is ignored.
        self.assertEqual(get_request_org(jwt_request(self.regular, override=self.b.pk)), self.a)
        self.assertFalse(is_superuser_all_orgs(jwt_request(self.regular, override='__all__')))

    def test_middleware_set_org_is_still_preferred(self):
        # Session-auth path (e.g. Django admin): OrgMiddleware already resolved it.
        req = jwt_request(self.su, override=self.b.pk)
        req.organisation = self.a  # what middleware set
        self.assertEqual(get_request_org(req), self.a)
