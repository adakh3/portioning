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


class TimelinePresetOption(ChoiceOptionBase):
    """A reusable label for a moment in the event-day run-of-show ("Staff arrive",
    "Cocktails", "Cake cutting"). Every caterer runs the day differently, so the
    labels are the org's own — the picker on a booking's timeline offers exactly
    these, and nothing else.

    These rows are also the org's **standard-day template**. "+ Build a
    run-of-show" seeds one row per preset flagged `in_standard_day`, placed at
    `standard_day_offset_minutes` from meal service. So adding, removing,
    retiming or opting a step out of the default day is ordinary Settings work —
    there is no separate template to keep in sync.
    """
    objects = TenantManager()

    in_standard_day = models.BooleanField(
        default=False,
        help_text='Seed this step when a booking builds its default run-of-show.',
    )
    standard_day_offset_minutes = models.IntegerField(
        null=True, blank=True,
        help_text='Minutes from meal service — negative is before (-150 = 2h30 '
                  'before), 0 is meal service itself. Required to be seeded.',
    )

    class Meta(ChoiceOptionBase.Meta):
        unique_together = [('organisation', 'value')]

# ArrangementTypeOption / BeverageTypeOption removed — superseded by the
# AddOnProduct catalog (their data was migrated into it).
