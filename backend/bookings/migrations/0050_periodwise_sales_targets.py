from decimal import Decimal
from datetime import date

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import users.model_mixins


PERIOD_LENGTHS = {'monthly': 12, 'quarterly': 4, 'yearly': 1}


def split_targets(apps, schema_editor):
    """Split the old single-amount SalesTarget into (a) a per-rep plan assignment
    and (b) per-period target cells for the current financial year. Existing flat
    amounts are recreated as one cell per period (preserving 'recurring' meaning)."""
    SalesTarget = apps.get_model('bookings', 'SalesTarget')
    RepCommissionPlan = apps.get_model('bookings', 'RepCommissionPlan')
    OrgSettings = apps.get_model('bookings', 'OrgSettings')

    old = list(SalesTarget.objects.values('organisation_id', 'user_id', 'plan_id', 'amount'))
    SalesTarget.objects.all().delete()
    today = date.today()
    for row in old:
        if row['plan_id']:
            RepCommissionPlan.objects.update_or_create(
                organisation_id=row['organisation_id'], user_id=row['user_id'],
                defaults={'plan_id': row['plan_id']},
            )
        amount = row['amount'] or Decimal('0')
        if amount > 0:
            s = OrgSettings.objects.filter(organisation_id=row['organisation_id']).first()
            pt = getattr(s, 'target_period', None) or 'monthly'
            fsm = getattr(s, 'fiscal_year_start_month', None) or 1
            fy = today.year if today.month >= fsm else today.year - 1
            for i in range(PERIOD_LENGTHS.get(pt, 1)):
                SalesTarget.objects.create(
                    organisation_id=row['organisation_id'], user_id=row['user_id'],
                    period_type=pt, fiscal_year=fy, period_index=i, amount=amount,
                )


class Migration(migrations.Migration):

    # Non-atomic: the RunPython (delete + recreate SalesTarget rows) must COMMIT
    # before the following RemoveField/AddConstraint ALTER TABLEs, otherwise
    # Postgres rejects them with "cannot ALTER TABLE ... has pending trigger
    # events". SQLite doesn't enforce this, so the bug only shows on prod.
    atomic = False

    dependencies = [
        ('bookings', '0049_orgsettings_fiscal_year_start_month'),
    ]

    operations = [
        migrations.CreateModel(
            name='RepCommissionPlan',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rep_commission_plans', to='users.organisation')),
                ('plan', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='rep_assignments', to='bookings.commissionplan')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rep_commission_plan', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('organisation', 'user'), name='uniq_org_user_rep_plan')],
            },
            bases=(users.model_mixins.OrgScopedModel, models.Model),
        ),
        migrations.AddField(
            model_name='salestarget',
            name='period_type',
            field=models.CharField(choices=[('monthly', 'Monthly'), ('quarterly', 'Quarterly'), ('yearly', 'Yearly')], default='monthly', max_length=20),
        ),
        migrations.AddField(
            model_name='salestarget',
            name='fiscal_year',
            field=models.PositiveIntegerField(default=0, help_text='Calendar year the financial year starts in.'),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='salestarget',
            name='period_index',
            field=models.PositiveSmallIntegerField(default=0, help_text='0-based period within the financial year (0 = first).'),
        ),
        migrations.RemoveConstraint(
            model_name='salestarget',
            name='uniq_org_user_sales_target',
        ),
        migrations.RunPython(split_targets, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='salestarget',
            name='plan',
        ),
        migrations.AddConstraint(
            model_name='salestarget',
            constraint=models.UniqueConstraint(fields=('organisation', 'user', 'period_type', 'fiscal_year', 'period_index'), name='uniq_org_user_target_cell'),
        ),
    ]
