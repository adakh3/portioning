def get_request_org(request):
    """Get organisation from the request user (works with DRF auth).

    Returns None for superusers without an org (they see all data).
    """
    user = getattr(request, 'user', None)
    if user is not None and getattr(user, 'is_authenticated', False):
        return getattr(user, 'organisation', None)
    return None


def is_superuser_without_org(request):
    """True if user is superuser with no org — should bypass org filtering."""
    user = getattr(request, 'user', None)
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    return getattr(user, 'is_superuser', False) and getattr(user, 'organisation', None) is None


def apply_org_filter(qs, request):
    """Filter queryset by org, unless user is a superuser without org (sees all)."""
    if is_superuser_without_org(request):
        return qs
    org = get_request_org(request)
    if org is not None:
        return qs.filter(organisation=org)
    return qs


class OrgQuerySetMixin:
    """Filter queryset by the authenticated user's organisation.
    Superusers without an org see all data.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        return apply_org_filter(qs, self.request)


class OrgCreateMixin:
    """Auto-set organisation on create from the authenticated user."""

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))
