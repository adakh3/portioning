from django.db import migrations
import re

DIAL_CODES = {
    'US': '1', 'CA': '1', 'GB': '44', 'PK': '92', 'AE': '971',
    'IN': '91', 'SA': '966', 'AU': '61',
}


def normalize(raw, country):
    if not raw:
        return raw
    cleaned = re.sub(r'[\s\-().]', '', raw.strip())
    if cleaned.startswith('00'):
        cleaned = '+' + cleaned[2:]
    if cleaned.startswith('+'):
        digits = cleaned[1:]
        if digits.isdigit() and 7 <= len(digits) <= 15:
            return '+' + digits
        return raw
    if not cleaned.isdigit():
        return raw
    code = DIAL_CODES.get((country or '').upper())
    if not code:
        return raw
    if cleaned.startswith('0') and len(cleaned) >= 9:
        candidate = code + cleaned.lstrip('0')
    elif not cleaned.startswith('0') and 7 <= len(cleaned) <= 12:
        candidate = code + cleaned
    else:
        return raw
    if 8 <= len(candidate) <= 15:
        return '+' + candidate
    return raw


def normalize_existing(apps, schema_editor):
    """Backfill every stored number to E.164 using each org's country."""
    for model_name, field in [('Lead', 'contact_phone'), ('Contact', 'phone'),
                              ('OrgSettings', 'twilio_whatsapp_number')]:
        Model = apps.get_model('bookings', model_name)
        to_update = []
        for obj in Model.objects.select_related('organisation').iterator():
            raw = getattr(obj, field)
            fixed = normalize(raw, obj.organisation.country if obj.organisation_id else '')
            if fixed != raw:
                setattr(obj, field, fixed)
                to_update.append(obj)
        Model.objects.bulk_update(to_update, [field], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0064_remove_orgsettings_followup_stale_hours_and_more'),
    ]

    operations = [
        migrations.RunPython(normalize_existing, migrations.RunPython.noop),
    ]
