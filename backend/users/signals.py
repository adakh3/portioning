from django.db.models.signals import post_save
from django.dispatch import receiver

from users.models import Organisation


@receiver(post_save, sender=Organisation)
def create_org_defaults(sender, instance, created, **kwargs):
    """Auto-create OrgSettings and workflow choice options for new orgs."""
    if not created:
        return

    from bookings.models.settings import OrgSettings
    OrgSettings.objects.get_or_create(organisation=instance)

    from bookings.models.choices import LeadStatusOption, LostReasonOption

    WORKFLOW_DATA = {
        LeadStatusOption: [
            ('new', 'New', 0),
            ('contacted', 'Contacted', 1),
            ('qualified', 'Qualified', 2),
            ('proposal_sent', 'Proposal Sent', 3),
            ('won', 'Won', 4),
            ('lost', 'Lost', 5),
        ],
        LostReasonOption: [
            ('too_expensive', 'Too expensive', 0),
            ('competitor', 'Went with competitor', 1),
            ('date_unavailable', 'Date unavailable', 2),
            ('no_response', 'No response', 3),
            ('budget_cut', 'Budget cut', 4),
            ('changed_plans', 'Changed plans', 5),
            ('other', 'Other', 6),
        ],
    }

    for Model, rows in WORKFLOW_DATA.items():
        for value, label, sort_order in rows:
            Model.objects.get_or_create(
                organisation=instance,
                value=value,
                defaults={'label': label, 'sort_order': sort_order},
            )
