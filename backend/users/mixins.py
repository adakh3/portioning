def get_request_org(request):
    """Get organisation from the request user (works with DRF auth)."""
    user = getattr(request, 'user', None)
    if user is not None and getattr(user, 'is_authenticated', False):
        return getattr(user, 'organisation', None)
    return None


class OrgQuerySetMixin:
    """Filter queryset by the authenticated user's organisation."""

    def get_queryset(self):
        qs = super().get_queryset()
        org = get_request_org(self.request)
        if org is not None:
            qs = qs.filter(organisation=org)
        return qs


class OrgCreateMixin:
    """Auto-set organisation on create from the authenticated user."""

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))
