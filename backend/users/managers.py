import logging

from django.db import models

logger = logging.getLogger('tenant')


class TenantQuerySet(models.QuerySet):
    """QuerySet that can be scoped to an organisation."""

    def for_org(self, org):
        """Filter to a specific organisation. This is the primary safe API."""
        if org is None:
            raise ValueError("for_org() requires a non-None organisation")
        return self.filter(organisation=org)


class TenantManager(models.Manager):
    """Manager for models with a direct `organisation` FK.

    Usage in views:  Model.objects.for_org(org).filter(...)
    Usage in admin:  Model.objects.all()  (unrestricted — Django needs this)
    Usage in mgmt:   Model.objects.unscoped().filter(...)  (explicit bypass)
    """

    def get_queryset(self):
        return TenantQuerySet(self.model, using=self._db)

    def for_org(self, org):
        """Scope all subsequent queries to the given organisation."""
        return self.get_queryset().for_org(org)

    def unscoped(self):
        """Explicit bypass — marks intent to access data across orgs."""
        return self.get_queryset()
