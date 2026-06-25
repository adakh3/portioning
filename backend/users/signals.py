from django.core.exceptions import ValidationError
from django.db.models.signals import m2m_changed, post_save
from django.dispatch import receiver

from users.models import Organisation
from users.model_mixins import model_is_org_scoped


@receiver(post_save, sender=Organisation)
def create_org_defaults(sender, instance, created, **kwargs):
    """Auto-create OrgSettings and workflow choice options for new orgs."""
    if not created:
        return

    from bookings.models.settings import OrgSettings
    OrgSettings.objects.get_or_create(organisation=instance)

    from bookings.models import CommissionPlan
    CommissionPlan.objects.get_or_create(
        organisation=instance, is_default=True, defaults={'name': 'Default'},
    )

    from bookings.models.choices import LeadStatusOption, LostReasonOption

    # Lead statuses carry colour + semantic flags (default/won/lost stage).
    LEAD_STATUS_DEFAULTS = [
        # value, label, sort_order, color, is_default, is_won, is_lost
        ('new', 'New', 0, 'blue', True, False, False),
        ('contacted', 'Contacted', 1, 'amber', False, False, False),
        ('qualified', 'Qualified', 2, 'cyan', False, False, False),
        ('proposal_sent', 'Proposal Sent', 3, 'violet', False, False, False),
        ('won', 'Won', 4, 'green', False, True, False),
        ('lost', 'Lost', 5, 'gray', False, False, True),
    ]
    for value, label, sort_order, color, is_default, is_won, is_lost in LEAD_STATUS_DEFAULTS:
        LeadStatusOption.objects.get_or_create(
            organisation=instance,
            value=value,
            defaults={
                'label': label, 'sort_order': sort_order, 'color': color,
                'is_default': is_default, 'is_won': is_won, 'is_lost': is_lost,
            },
        )

    LOST_REASON_DEFAULTS = [
        ('too_expensive', 'Too expensive', 0),
        ('competitor', 'Went with competitor', 1),
        ('date_unavailable', 'Date unavailable', 2),
        ('no_response', 'No response', 3),
        ('budget_cut', 'Budget cut', 4),
        ('changed_plans', 'Changed plans', 5),
        ('other', 'Other', 6),
    ]
    for value, label, sort_order in LOST_REASON_DEFAULTS:
        LostReasonOption.objects.get_or_create(
            organisation=instance,
            value=value,
            defaults={'label': label, 'sort_order': sort_order},
        )


@receiver(m2m_changed)
def block_cross_org_m2m(sender, instance, action, reverse, model, pk_set, **kwargs):
    """Block linking an org-scoped object to a row in another organisation.

    The model layer (``OrgScopedModel.save``) cannot see M2M additions — they
    happen after save, through a join table. This receiver is the data-layer
    backstop for those: on ``pre_add``, every row being linked must share the
    owning object's organisation. Fires for both the forward and reverse side,
    whichever holds the ``organisation`` column. Defense-in-depth partner to the
    serializer layer, which scopes writable M2M querysets at the API boundary.
    """
    if action != 'pre_add' or not pk_set:
        return
    org_id = getattr(instance, 'organisation_id', None)
    if org_id is None or not model_is_org_scoped(model):
        return
    if (
        model._base_manager.filter(pk__in=pk_set)
        .exclude(organisation_id=org_id)
        .exists()
    ):
        raise ValidationError(
            f'Cannot link {model.__name__} from a different organisation.'
        )
