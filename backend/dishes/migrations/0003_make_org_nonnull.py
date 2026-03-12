import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('dishes', '0002_org_multitenancy'),
        ('bookings', '0017_populate_default_org'),
        ('users', '0005_org_enrich'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dish',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dishes', to='users.organisation'),
        ),
        migrations.AlterField(
            model_name='dishcategory',
            name='organisation',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dish_categories', to='users.organisation'),
        ),
    ]
