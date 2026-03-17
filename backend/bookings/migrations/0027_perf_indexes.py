from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0026_extend_date_format_max_length'),
    ]

    operations = [
        # Lead indexes
        migrations.AddIndex(
            model_name='lead',
            index=models.Index(fields=['organisation', 'status'], name='lead_org_status_idx'),
        ),
        migrations.AddIndex(
            model_name='lead',
            index=models.Index(fields=['organisation', 'assigned_to', 'status'], name='lead_org_assigned_status_idx'),
        ),
        migrations.AddIndex(
            model_name='lead',
            index=models.Index(fields=['organisation', 'event_date'], name='lead_org_event_date_idx'),
        ),
        migrations.AddIndex(
            model_name='lead',
            index=models.Index(fields=['organisation', '-created_at'], name='lead_org_created_idx'),
        ),
        # Quote indexes
        migrations.AddIndex(
            model_name='quote',
            index=models.Index(fields=['organisation', 'status'], name='quote_org_status_idx'),
        ),
        migrations.AddIndex(
            model_name='quote',
            index=models.Index(fields=['organisation', 'event_date'], name='quote_org_event_date_idx'),
        ),
        # Account indexes
        migrations.AddIndex(
            model_name='account',
            index=models.Index(fields=['organisation', 'account_type'], name='account_org_type_idx'),
        ),
    ]
