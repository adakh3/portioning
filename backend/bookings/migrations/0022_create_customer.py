"""Phase 1: Create Customer model and add nullable customer FK to Lead, Quote."""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0021_orgsettings_quotation_terms_and_more'),
        ('users', '0005_org_enrich'),
    ]

    operations = [
        migrations.CreateModel(
            name='Customer',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('customer_type', models.CharField(choices=[('consumer', 'Consumer'), ('business', 'Business')], default='consumer', max_length=20)),
                ('name', models.CharField(help_text='Person name (consumer) or contact person (business)', max_length=200)),
                ('company_name', models.CharField(blank=True, help_text='Only for business customers', max_length=200)),
                ('email', models.EmailField(blank=True, max_length=254)),
                ('phone', models.CharField(blank=True, max_length=50)),
                ('billing_address_line1', models.CharField(blank=True, max_length=200)),
                ('billing_address_line2', models.CharField(blank=True, max_length=200)),
                ('billing_city', models.CharField(blank=True, max_length=100)),
                ('billing_postcode', models.CharField(blank=True, max_length=20)),
                ('billing_country', models.CharField(default='UK', max_length=100)),
                ('vat_number', models.CharField(blank=True, max_length=50)),
                ('payment_terms', models.CharField(choices=[('immediate', 'Immediate'), ('net_15', 'Net 15'), ('net_30', 'Net 30')], default='immediate', max_length=20)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='customers', to='users.organisation')),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        # Add nullable customer FK to Lead and Quote (nullable for data migration)
        migrations.AddField(
            model_name='lead',
            name='customer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='leads', to='bookings.customer'),
        ),
        migrations.AddField(
            model_name='quote',
            name='customer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='quotes', to='bookings.customer'),
        ),
    ]
