from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0014_eventmeal_price_per_head'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='event',
            index=models.Index(fields=['organisation', 'status'], name='event_org_status_idx'),
        ),
        migrations.AddIndex(
            model_name='event',
            index=models.Index(fields=['organisation', 'date'], name='event_org_date_idx'),
        ),
    ]
