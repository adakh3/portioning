from django.contrib.contenttypes.models import ContentType

from bookings.models.activity import ActivityLog


def log_activity(instance, action, user=None, field_name='', old_value='', new_value='', description=''):
    """Log a single activity entry for any model instance."""
    ct = ContentType.objects.get_for_model(instance)
    ActivityLog.objects.create(
        content_type=ct,
        object_id=instance.pk,
        action=action,
        field_name=field_name,
        old_value=str(old_value) if old_value is not None else '',
        new_value=str(new_value) if new_value is not None else '',
        description=description,
        user=user,
    )


TRACKED_FIELDS = [
    'customer', 'source',
    'event_date', 'guest_estimate', 'budget', 'event_type',
    'service_style', 'assigned_to', 'product', 'notes', 'lost_notes',
]

FIELD_LABELS = {
    'customer': 'Customer',
    'source': 'Source',
    'event_date': 'Event Date',
    'guest_estimate': 'Guest Estimate',
    'budget': 'Budget',
    'event_type': 'Event Type',
    'service_style': 'Service Style',
    'assigned_to': 'Assigned To',
    'product': 'Product',
    'notes': 'Notes',
    'lost_notes': 'Lost Notes',
}


def _display_value(field_name, value, instance=None):
    """Convert raw field value to human-readable display."""
    if value is None or value == '' or value == 'None':
        return ''
    if field_name == 'assigned_to':
        from users.models import User
        try:
            u = User.objects.get(pk=int(value))
            return f"{u.first_name} {u.last_name}".strip() or u.email
        except (User.DoesNotExist, ValueError, TypeError):
            return str(value)
    if field_name == 'product':
        from bookings.models.leads import ProductLine
        try:
            return ProductLine.objects.get(pk=int(value)).name
        except (ProductLine.DoesNotExist, ValueError, TypeError):
            return str(value)
    if field_name == 'customer':
        from bookings.models.accounts import Customer
        try:
            return str(Customer.objects.get(pk=int(value)))
        except (Customer.DoesNotExist, ValueError, TypeError):
            return str(value)
    return str(value)


def log_field_changes(instance, old_data, new_data, user=None):
    """Compare old vs new dicts and log each changed tracked field."""
    logs = []
    ct = ContentType.objects.get_for_model(instance)
    for field in TRACKED_FIELDS:
        old_val = old_data.get(field)
        new_val = new_data.get(field)
        # Normalize for comparison
        old_str = str(old_val) if old_val is not None else ''
        new_str = str(new_val) if new_val is not None else ''
        if old_str != new_str:
            label = FIELD_LABELS.get(field, field)
            old_display = _display_value(field, old_val)
            new_display = _display_value(field, new_val)
            if old_display and new_display:
                desc = f"Changed {label} from \"{old_display}\" to \"{new_display}\""
            elif new_display:
                desc = f"Set {label} to \"{new_display}\""
            else:
                desc = f"Cleared {label}"
            logs.append(ActivityLog(
                content_type=ct,
                object_id=instance.pk,
                action='updated',
                field_name=field,
                old_value=old_str,
                new_value=new_str,
                description=desc,
                user=user,
            ))
    if logs:
        ActivityLog.objects.bulk_create(logs)
    return logs
