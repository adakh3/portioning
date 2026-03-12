import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('menus', '0002_org_multitenancy'),
        ('bookings', '0017_populate_default_org'),
        ('users', '0005_org_enrich'),
    ]

    operations = [
        migrations.AlterField(
            model_name='menutemplate',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='menu_templates', to='users.organisation'),
        ),
    ]
