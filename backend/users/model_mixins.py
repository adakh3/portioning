"""Model-layer enforcement of organisation boundaries on foreign keys.

Defense-in-depth partner to ``OrgScopedModelSerializer`` (see
``users.serializer_mixins``). The serializer layer rejects forged FKs at the API
boundary — clean 400s, and it also covers writable M2M and child models that
derive their org through a parent. This layer is the backstop that fires for
*every* write path DRF can't see: Django admin, management commands, the shell,
or a future view that forgets to use the scoped serializer.

OWASP mapping:
- A01 Broken Access Control — blocks cross-tenant object references (IDOR/BOLA).
- A04 Insecure Design — the secure path is the default; a model opts *out* by
  not mixing this in, rather than opting in to a check at every call site
  (default-deny, ASVS 4.1.5). The logic lives in one place (ASVS 4.1.3).

Scope: this only protects models that have a *direct* ``organisation`` column —
it validates that every FK pointing at another org-scoped row shares this row's
organisation. Child models without a direct org column (line items, payments,
shifts) are covered by the serializer layer, which has the request's org.

Bypass note: queryset ``.update()`` / ``.bulk_create()`` do not call ``save()``,
so those paths must validate explicitly at the call site (see
``LeadBulkUpdateView``).
"""
from django.core.exceptions import FieldDoesNotExist, ValidationError


def model_is_org_scoped(model):
    """True if ``model`` has a direct ``organisation`` column."""
    try:
        model._meta.get_field('organisation')
        return True
    except FieldDoesNotExist:
        return False


class OrgScopedModel:
    """Mixin that blocks cross-organisation foreign keys on save.

    Mix in *before* ``models.Model``::

        class Lead(OrgScopedModel, models.Model):
            organisation = models.ForeignKey(...)

    Adds no fields, so no migration is required. The check runs in both
    ``clean()`` (so Django admin ModelForms surface a clean field error) and
    ``save()`` (the hard backstop, since DRF's ``serializer.save()`` does not
    call ``full_clean()``).
    """

    def _validate_org_scoped_fks(self):
        org_id = getattr(self, 'organisation_id', None)
        if org_id is None:
            # Nothing to scope against yet (e.g. org not assigned). The
            # organisation FK itself is validated by the model's own rules.
            return

        errors = {}
        for field in self._meta.concrete_fields:
            # FK and OneToOne both carry a single related PK on this row.
            if not (field.many_to_one or field.one_to_one):
                continue
            if field.name == 'organisation':
                continue
            related_model = field.related_model
            if related_model is None or not model_is_org_scoped(related_model):
                continue
            fk_id = getattr(self, field.attname)
            if fk_id is None:
                continue
            # _base_manager so a tenant-scoped default manager can't hide the
            # cross-org row we are specifically trying to detect.
            related_org_id = (
                related_model._base_manager.filter(pk=fk_id)
                .values_list('organisation_id', flat=True)
                .first()
            )
            if related_org_id is not None and related_org_id != org_id:
                errors[field.name] = (
                    f'{related_model.__name__} belongs to a different organisation.'
                )

        if errors:
            raise ValidationError(errors)

    def clean(self):
        super().clean()
        self._validate_org_scoped_fks()

    def save(self, *args, **kwargs):
        self._validate_org_scoped_fks()
        super().save(*args, **kwargs)
