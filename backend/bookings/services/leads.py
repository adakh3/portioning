"""Shared lead-creation helpers.

Extracted so ingestion paths that don't go through the DRF serializer (Meta
lead-ads, REL-507) apply the same default-stage rule as the API's
``LeadListCreateView.perform_create`` instead of duplicating it.
"""

from bookings.models import LeadStatusOption


def default_status_for(org):
    """The org's configured default lead stage value, or None if unset."""
    if org is None:
        return None
    return (
        LeadStatusOption.objects.filter(organisation=org, is_default=True)
        .values_list('value', flat=True)
        .first()
    )


def terminal_statuses_for(org):
    """Status values that count as closed (won or lost) for this org."""
    from django.db.models import Q
    return set(
        LeadStatusOption.objects.filter(organisation=org)
        .filter(Q(is_won=True) | Q(is_lost=True))
        .values_list('value', flat=True)
    )
