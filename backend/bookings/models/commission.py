from decimal import Decimal

from django.db import models

from users.managers import TenantManager
from users.model_mixins import OrgScopedModel
from bookings.models.settings import COMMISSION_MODEL_CHOICES


class CommissionPlan(OrgScopedModel, models.Model):
    """A named commission structure (e.g. by seniority: Junior / Senior / Lead).

    Salespeople are assigned a plan; the org's ``is_default`` plan is used for
    anyone unassigned. A plan holds the model + flat rate, and (for accelerated)
    its bands via the ``bands`` reverse relation.
    """
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='commission_plans',
    )
    name = models.CharField(max_length=100)
    commission_model = models.CharField(
        max_length=20, choices=COMMISSION_MODEL_CHOICES, default='flat',
        help_text='Flat rate, or accelerated bands keyed to target attainment.',
    )
    commission_flat_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        help_text='Commission rate % on all revenue (used when the model is flat).',
    )
    is_default = models.BooleanField(
        default=False, help_text='Used for salespeople with no plan assigned (one per org).',
    )

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'name'], name='uniq_org_commission_plan_name',
            ),
        ]

    def __str__(self):
        return self.name


class CommissionBand(OrgScopedModel, models.Model):
    """One marginal band of a plan's accelerated structure.

    A band starts at ``min_attainment_pct`` (percent of the rep's target) and
    runs until the next band's threshold. Revenue in the band earns ``rate``.
    The lowest band should start at 0 so all revenue is covered.
    """
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='commission_bands',
    )
    plan = models.ForeignKey(
        'bookings.CommissionPlan', on_delete=models.CASCADE, related_name='bands', null=True,
    )
    min_attainment_pct = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal('0.00'),
        help_text='Band starts at this % of target attainment (e.g. 0, 100, 120).',
    )
    rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        help_text='Commission rate % applied to revenue that falls in this band.',
    )

    class Meta:
        ordering = ['min_attainment_pct']
        constraints = [
            models.UniqueConstraint(
                fields=['plan', 'min_attainment_pct'],
                name='uniq_plan_commission_band_threshold',
            ),
        ]

    def __str__(self):
        return f'≥{self.min_attainment_pct}% of target → {self.rate}%'


class SalesTarget(OrgScopedModel, models.Model):
    """A salesperson's commission setup: their target amount per period and the
    commission plan they're on (null = the org's default plan)."""
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='sales_targets',
    )
    user = models.ForeignKey(
        'users.User', on_delete=models.CASCADE, related_name='sales_targets',
    )
    plan = models.ForeignKey(
        'bookings.CommissionPlan', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='targets',
    )
    amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0.00'),
        help_text='Revenue target per period for this salesperson.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'user'], name='uniq_org_user_sales_target',
            ),
        ]

    def __str__(self):
        return f'{self.user_id} target {self.amount}'
