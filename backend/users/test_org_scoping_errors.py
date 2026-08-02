"""A cross-org FK rejection must reach the client as a 400, not a 500.

The org-scoping guard in ``users.model_mixins`` raises Django's ValidationError from
``Model.save()``. DRF only understands its own ValidationError, so the guard's
rejection fell through to the generic handler and surfaced as an opaque
"Server error (500)" — a correct security decision reported as a crash, with no
indication of which field was wrong.

The mapping lives in the global exception handler on purpose: the guard stays one
centralised, defence-in-depth check rather than something every endpoint re-raises.
"""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import TestCase
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError

from portioning.exception_handler import custom_exception_handler


class _View:
    pass


def _handle(exc):
    return custom_exception_handler(exc, {"view": _View()})


class OrgScopingErrorMappingTests(TestCase):
    def test_a_field_keyed_validation_error_becomes_a_400_with_its_field(self):
        exc = DjangoValidationError({'created_by': ['User belongs to a different organisation.']})

        response = _handle(exc)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('created_by', response.data)
        self.assertIn(
            'different organisation',
            str(response.data['created_by']),
        )

    def test_a_bare_message_validation_error_becomes_a_400(self):
        response = _handle(DjangoValidationError('Nope.'))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Nope.', str(response.data))

    def test_a_drf_validation_error_is_still_a_400(self):
        # Regression guard: the new branch must not shadow DRF's own errors.
        response = _handle(DRFValidationError({'guest_count': ['This field is required.']}))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('guest_count', response.data)

    def test_an_unrelated_exception_is_still_a_500(self):
        response = _handle(RuntimeError('boom'))

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn('detail', response.data)


class CrossOrgQuoteCreateTests(TestCase):
    """The real path that produced the 500: an owner viewing another org creates a
    quote, so ``created_by`` is a user who does not belong to the target org."""

    def test_creating_a_quote_as_a_user_of_another_org_is_a_400(self):
        from rest_framework.test import APIClient

        from bookings.models import Contact
        from tests.base import get_test_user
        from users.models import Organisation, User

        insider = get_test_user()
        other_org = Organisation.objects.create(name='Other Co', slug='other-co')
        outsider = User.objects.create(
            email='outsider@example.com', first_name='Out', last_name='Sider',
            role='owner', organisation=other_org, is_superuser=True, is_staff=True,
        )
        contact = Contact.objects.create(organisation=insider.organisation, name='Client')

        client = APIClient()
        client.force_authenticate(user=outsider)
        response = client.post('/api/bookings/quotes/', {
            'primary_contact': contact.id,
            'event_date': '2026-05-01',
            'guest_count': 10,
        }, format='json')

        # Was a 500 (unhandled Django ValidationError). The rejection itself is
        # correct — only the way it was reported was not.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
