import logging

from users.managers import TenantManager

security_logger = logging.getLogger('tenant.security')


def get_request_org(request):
    """Get effective organisation from the request (set by OrgMiddleware).

    Falls back to user.organisation when middleware hasn't run (e.g. in tests).
    Returns None only for superusers in all-orgs mode.
    """
    org = getattr(request, 'organisation', None)
    if org is not None:
        return org
    # Fallback: middleware didn't run (DRF test client, etc.)
    user = getattr(request, 'user', None)
    if user is not None and getattr(user, 'is_authenticated', False):
        return getattr(user, 'organisation', None)
    return None


def is_superuser_all_orgs(request):
    """True if user is superuser with explicit all-orgs override active."""
    user = getattr(request, 'user', None)
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    if not getattr(user, 'is_superuser', False):
        return False
    return getattr(request, '_org_all_override', False)


# Keep old name as alias during migration — views still import it
is_superuser_without_org = is_superuser_all_orgs


def apply_org_filter(qs, request):
    """Filter queryset by org. Superusers in all-orgs mode see everything.

    Uses TenantManager.for_org() when available, falls back to .filter(organisation=org).
    Returns qs.none() if non-superuser has no org (safety net).
    """
    if is_superuser_all_orgs(request):
        return qs
    org = get_request_org(request)
    if org is not None:
        if hasattr(qs, 'for_org'):
            return qs.for_org(org)
        return qs.filter(organisation=org)
    # Non-superuser with no org — return nothing (safety net)
    return qs.none()


def get_org_object_or_404(model_or_qs, request, **kwargs):
    """Fetch a single object scoped to the user's org, or raise 404.

    On 404, checks if the object exists in another org and logs a warning.
    """
    from django.shortcuts import get_object_or_404
    from django.http import Http404
    qs = model_or_qs if hasattr(model_or_qs, 'filter') else model_or_qs.objects.all()
    qs = apply_org_filter(qs, request)
    try:
        return get_object_or_404(qs, **kwargs)
    except Http404:
        # Check if it exists in another org — log cross-org attempt
        base_qs = model_or_qs if hasattr(model_or_qs, 'filter') else model_or_qs.objects.all()
        if base_qs.filter(**kwargs).exists():
            user = getattr(request, 'user', None)
            org = get_request_org(request)
            model_name = base_qs.model.__name__
            security_logger.warning(
                "Cross-org access blocked: user=%s org=%s tried to access %s(%s)",
                getattr(user, 'pk', '?'), getattr(org, 'pk', '?'),
                model_name, kwargs,
            )
        raise


class OrgQuerySetMixin:
    """Filter queryset by the authenticated user's organisation.
    Superusers in all-orgs mode see all data.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        return apply_org_filter(qs, self.request)


class OrgCreateMixin:
    """Auto-set organisation on create from the authenticated user."""

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))
