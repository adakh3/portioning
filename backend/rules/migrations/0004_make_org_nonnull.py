from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_org_enrich'),
        ('rules', '0003_populate_org'),
    ]

    operations = [
        # GlobalConfig: FK → OneToOneField (non-null, unique)
        migrations.AlterField(
            model_name='globalconfig',
            name='organisation',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='portioning_config',
                to='users.organisation',
            ),
        ),
        # GlobalConstraint: FK → OneToOneField (non-null, unique)
        migrations.AlterField(
            model_name='globalconstraint',
            name='organisation',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='portioning_constraint',
                to='users.organisation',
            ),
        ),
        # BudgetProfile: make org non-null
        migrations.AlterField(
            model_name='budgetprofile',
            name='organisation',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='budget_profiles',
                to='users.organisation',
            ),
        ),
        # GuestProfile: make org non-null + unique_together
        migrations.AlterField(
            model_name='guestprofile',
            name='organisation',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='guest_profiles',
                to='users.organisation',
            ),
        ),
        # Remove unique on GuestProfile.name (now unique_together with org)
        migrations.AlterField(
            model_name='guestprofile',
            name='name',
            field=models.CharField(max_length=50),
        ),
        migrations.AlterUniqueTogether(
            name='guestprofile',
            unique_together={('organisation', 'name')},
        ),
        # CombinationRule: make org non-null
        migrations.AlterField(
            model_name='combinationrule',
            name='organisation',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='combination_rules',
                to='users.organisation',
            ),
        ),
    ]
