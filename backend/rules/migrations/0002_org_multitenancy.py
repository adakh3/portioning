from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_org_enrich'),
        ('rules', '0001_initial'),
    ]

    operations = [
        # GlobalConfig: add nullable org FK
        migrations.AddField(
            model_name='globalconfig',
            name='organisation',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='portioning_config',
                to='users.organisation',
            ),
        ),
        # GlobalConstraint: add nullable org FK
        migrations.AddField(
            model_name='globalconstraint',
            name='organisation',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='portioning_constraint',
                to='users.organisation',
            ),
        ),
        # BudgetProfile: add nullable org FK
        migrations.AddField(
            model_name='budgetprofile',
            name='organisation',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='budget_profiles',
                to='users.organisation',
            ),
        ),
        # GuestProfile: add nullable org FK
        migrations.AddField(
            model_name='guestprofile',
            name='organisation',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='guest_profiles',
                to='users.organisation',
            ),
        ),
        # CombinationRule: add nullable org FK
        migrations.AddField(
            model_name='combinationrule',
            name='organisation',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='combination_rules',
                to='users.organisation',
            ),
        ),
    ]
