from django.db import models
from users.managers import TenantManager


class ChoiceOptionBase(models.Model):
    """Abstract base for org-scoped choice option models."""
    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE,
    )
    value = models.CharField(max_length=50)
    label = models.CharField(max_length=100)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        abstract = True
        ordering = ['sort_order', 'pk']

    def __str__(self):
        return self.label


class EventTypeOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class SourceOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class ServiceStyleOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class LeadStatusOption(ChoiceOptionBase):
    """An org-customizable pipeline stage for leads. `color` drives the kanban
    column / status pill; the semantic flags decouple app behaviour from the
    stage's name so orgs can rename/add stages freely."""
    objects = TenantManager()

    # Named colour from a fixed palette (mapped to classes on the frontend).
    color = models.CharField(max_length=20, blank=True, default='')
    # The default stage new leads start in (exactly one per org).
    is_default = models.BooleanField(default=False)
    # Terminal "won" stage — triggers conversion to an event.
    is_won = models.BooleanField(default=False)
    # Terminal "lost" stage — requires a lost reason.
    is_lost = models.BooleanField(default=False)

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class LostReasonOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class MealTypeOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]

# ArrangementTypeOption / BeverageTypeOption removed — superseded by the
# AddOnProduct catalog (their data was migrated into it).
