from decimal import Decimal

from django.db import models

from users.managers import TenantManager
from users.model_mixins import OrgScopedModel


class CommissionBand(OrgScopedModel, models.Model):
    """One marginal band of an org's accelerated commission structure.

    A band starts at ``min_attainment_pct`` (percent of the rep's target) and
    runs until the next band's threshold. Revenue that falls in the band earns
    ``rate``. Only used when ``OrgSettings.commission_model == 'accelerated'``.
    The lowest band should start at 0 so all revenue is covered.
    """
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='commission_bands',
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
                fields=['organisation', 'min_attainment_pct'],
                name='uniq_org_commission_band_threshold',
            ),
        ]

    def __str__(self):
        return f'≥{self.min_attainment_pct}% of target → {self.rate}%'


class SalesTarget(OrgScopedModel, models.Model):
    """A salesperson's recurring revenue target for one period.

    ``amount`` is the target for a single period as defined by
    ``OrgSettings.target_period`` (monthly / quarterly / yearly).
    """
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='sales_targets',
    )
    user = models.ForeignKey(
        'users.User', on_delete=models.CASCADE, related_name='sales_targets',
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
