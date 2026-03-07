import math

from .models import AllocationRule


def suggest_staffing(guest_count, event_type=''):
    """Given guest count and optional event type, return recommended staff per role.

    Returns list of dicts: [{'role_id': ..., 'role_name': ..., 'recommended': ...}, ...]
    """
    rules = AllocationRule.objects.filter(is_active=True).select_related('role')
    if event_type:
        rules = rules.filter(models_Q_event_type_or_blank(event_type))
    else:
        rules = rules.filter(event_type='')

    suggestions = []
    for rule in rules:
        needed = max(rule.minimum_staff, math.ceil(guest_count / rule.guests_per_staff))
        suggestions.append({
            'role_id': rule.role_id,
            'role_name': rule.role.name,
            'recommended': needed,
            'guests_per_staff': rule.guests_per_staff,
            'minimum_staff': rule.minimum_staff,
        })
    return suggestions


def models_Q_event_type_or_blank(event_type):
    """Return Q filter for rules matching a specific event type OR blank (all events)."""
    from django.db.models import Q
    return Q(event_type=event_type) | Q(event_type='')
