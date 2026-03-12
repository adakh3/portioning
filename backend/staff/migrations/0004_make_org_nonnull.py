import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('staff', '0003_org_multitenancy'),
        ('bookings', '0017_populate_default_org'),
        ('users', '0005_org_enrich'),
    ]

    operations = [
        migrations.AlterField(
            model_name='laborrole',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='labor_roles', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='staffmember',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='staff_members', to='users.organisation'),
        ),
    ]
