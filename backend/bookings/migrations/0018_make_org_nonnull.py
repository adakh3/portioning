"""Make organisation FK non-nullable on all tenant-scoped models."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('bookings', '0017_populate_default_org'),
        ('users', '0005_org_enrich'),
    ]

    operations = [
        migrations.AlterField(
            model_name='account',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='accounts', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='venue',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='venues', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='lead',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='leads', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='quote',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='quotes', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='eventtypeoption',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='event_type_options', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='sourceoption',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='source_options', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='servicestyleoption',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='service_style_options', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='leadstatusoption',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lead_status_options', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='lostreasonoption',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lost_reason_options', to='users.organisation'),
        ),
    ]
