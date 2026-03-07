import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('staff', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='laborrole',
            name='color',
            field=models.CharField(blank=True, max_length=7),
        ),
        migrations.AddField(
            model_name='laborrole',
            name='sort_order',
            field=models.IntegerField(default=0),
        ),
        migrations.AlterModelOptions(
            name='laborrole',
            options={'ordering': ['sort_order', 'name']},
        ),
        migrations.CreateModel(
            name='AllocationRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(blank=True, help_text='Blank = applies to all event types', max_length=50)),
                ('guests_per_staff', models.IntegerField(help_text='e.g. 30 means 1 staff per 30 guests')),
                ('minimum_staff', models.IntegerField(default=1)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('role', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='allocation_rules', to='staff.laborrole')),
            ],
            options={
                'ordering': ['role__name', 'event_type'],
            },
        ),
    ]
