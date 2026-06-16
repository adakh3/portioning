import logging

from django.conf import settings

from .models import Organisation

audit_logger = logging.getLogger('tenant.audit')


class CSPMiddleware:
    """Add Content-Security-Policy header to all responses."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not response.has_header('Content-Security-Policy'):
            response['Content-Security-Policy'] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; "
                "font-src 'self' data:; "
                "connect-src 'self' https://wa.me; "
                "frame-ancestors 'none';"
            )
        return response


class OrgMiddleware:
    """Set request.organisation from the authenticated user.

    For superusers, honour a session-based org override so they can
    operate within any customer's org context. The special value '__all__'
    activates all-orgs mode (sets request._org_all_override = True).
    Superusers default to their own org — not to "see everything".
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        org = None
        request._org_all_override = False

        if hasattr(request, 'user') and request.user.is_authenticated:
            if request.user.is_superuser:
                override = request.session.get('org_override')
                if override == '__all__':
                    # Explicit all-orgs mode
                    org = None
                    request._org_all_override = True
                elif override is not None:
                    try:
                        org = Organisation.objects.get(pk=override, is_active=True)
                    except Organisation.DoesNotExist:
                        # Stale override — clear it, fall back to own org
                        request.session.pop('org_override', None)
                        org = request.user.organisation
                else:
                    # No override — superuser sees their own org by default
                    org = request.user.organisation
            else:
                org = request.user.organisation

        request.organisation = org
        return self.get_response(request)
