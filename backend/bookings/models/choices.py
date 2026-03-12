from django.db import models


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
    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class SourceOption(ChoiceOptionBase):
    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class ServiceStyleOption(ChoiceOptionBase):
    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class LeadStatusOption(ChoiceOptionBase):
    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]


class LostReasonOption(ChoiceOptionBase):
    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]
