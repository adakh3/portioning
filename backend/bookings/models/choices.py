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
    objects = TenantManager()

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


class ArrangementTypeOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class BeverageTypeOption(ChoiceOptionBase):
    objects = TenantManager()

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]
