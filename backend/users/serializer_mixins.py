"""Serializer mixins that enforce org-scoping at the API boundary.

OWASP A01 (Broken Access Control) / A04 (Insecure Design): a writable FK field
on a serializer accepts any PK in `Model.objects.all()` by default. That lets a
client in org A assign an FK that points to an object in org B. We fix this
centrally by narrowing every writable FK's queryset to the request's org.
"""
from django.core.exceptions import FieldDoesNotExist
from rest_framework import serializers

from users.mixins import get_request_org, is_superuser_all_orgs


def _is_org_scoped(model):
    """True if the model has a direct `organisation` column."""
    try:
        model._meta.get_field('organisation')
        return True
    except FieldDoesNotExist:
        return False


class OrgScopedSerializerMixin:
    """Auto-scope every writable FK / M2M field to the request's org.

    For each `PrimaryKeyRelatedField` (including the child of `ManyRelatedField`)
    whose related model has an `organisation` column, narrow `queryset` to
    `Model.objects.filter(organisation=request_org)`. Superusers in all-orgs
    mode keep the unscoped queryset.

    If the request has no org (and the user is not a superuser-all-orgs), the
    queryset is set to `.none()` — safer to fail validation than to allow
    cross-tenant references.
    """

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request') if hasattr(self, 'context') else None
        if request is None:
            return fields

        if is_superuser_all_orgs(request):
            return fields

        org = get_request_org(request)

        for field in fields.values():
            target = getattr(field, 'child_relation', field)
            if not isinstance(target, serializers.PrimaryKeyRelatedField):
                continue
            if target.read_only:
                continue
            qs = getattr(target, 'queryset', None)
            if qs is None:
                continue
            if not _is_org_scoped(qs.model):
                continue
            if org is not None:
                target.queryset = qs.model.objects.filter(organisation=org)
            else:
                target.queryset = qs.model.objects.none()
        return fields


class OrgScopedModelSerializer(OrgScopedSerializerMixin, serializers.ModelSerializer):
    """Drop-in replacement for ModelSerializer with org-scoped FK validation."""
    pass
