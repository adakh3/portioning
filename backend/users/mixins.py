import logging

from users.managers import TenantManager

security_logger = logging.getLogger('tenant.security')


def _superuser_session_override(request):
    """A superuser's org-switcher choice, read from the session. Returns
    ``(org, all_orgs)``; ``(None, False)`` means "no override → own org".

    Resolved HERE (view layer, after DRF auth) rather than trusted from
    OrgMiddleware, because OrgMiddleware runs BEFORE JWT authentication. For the
    app's JWT-authenticated API requests ``request.user`` is anonymous at
    middleware time, so the middleware never applies the switch endpoint's
    ``org_override`` — leaving a superuser stuck on their own org whatever they
    pick in the switcher. Reading it post-auth fixes that.
    """
    session = getattr(request, 'session', None)
    override = session.get('org_override') if session is not None else None
    if override == '__all__':
        return None, True
    if override:
        from users.models import Organisation
        return Organisation.objects.filter(pk=override, is_active=True).first(), False
    return None, False


def get_request_org(request):
    """Effective organisation for the request.

    Prefers what OrgMiddleware set (the session-auth path, e.g. Django admin).
    For JWT-authenticated API requests OrgMiddleware couldn't resolve it (it runs
    before auth), so resolve here with the now-authenticated user — honouring a
    superuser's org-switcher override. Returns None for a superuser in all-orgs
    mode, or a non-superuser with no org.
    """
    org = getattr(request, 'organisation', None)
    if org is not None:
        return org
    user = getattr(request, 'user', None)
    if not (user and getattr(user, 'is_authenticated', False)):
        return None
    if getattr(user, 'is_superuser', False):
        override_org, all_orgs = _superuser_session_override(request)
        if all_orgs:
            return None
        if override_org is not None:
            return override_org
        # no (or stale) override → fall through to the superuser's own org
    return getattr(user, 'organisation', None)


def is_superuser_all_orgs(request):
    """True if a superuser has the explicit all-orgs override active."""
    user = getattr(request, 'user', None)
    if not (user and getattr(user, 'is_authenticated', False)
            and getattr(user, 'is_superuser', False)):
        return False
    # Trust the middleware flag on the session-auth path; otherwise (JWT) read the
    # session ourselves, since middleware ran before auth.
    if getattr(request, '_org_all_override', False):
        return True
    _, all_orgs = _superuser_session_override(request)
    return all_orgs


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
