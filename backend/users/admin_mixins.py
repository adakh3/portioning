"""Shared admin mixins for the multi-tenant Django admin."""


class OrgVisibleAdminMixin:
    """Surface the owning organisation as a list column + sidebar filter.

    A superuser manages every tenant from one admin, so org-scoped models need to
    show which org each row belongs to and let you filter to a single org.
    Prepends ``organisation`` to ``list_display`` / ``list_filter`` unless already
    present. For models whose org is reached via a relation, set ``org_field``
    (e.g. ``'role__organisation'``) — used for the filter; the column is left to
    the concrete admin.
    """

    org_field = "organisation"

    def get_list_display(self, request):
        ld = list(super().get_list_display(request))
        # Append (not prepend) so the model's natural first column stays the
        # clickable link and any list_editable config is unaffected.
        if self.org_field == "organisation" and "organisation" not in ld:
            ld = [*ld, "organisation"]
        return ld

    def get_list_filter(self, request):
        lf = list(super().get_list_filter(request))
        if self.org_field not in lf:
            lf = [self.org_field, *lf]
        return lf
