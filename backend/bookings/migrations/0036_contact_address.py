from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0035_person_first_bookings'),
    ]

    operations = [
        migrations.AddField(
            model_name='contact',
            name='address',
            field=models.TextField(
                blank=True, default='',
                help_text='Home/billing address — used to prefill the venue address',
            ),
            preserve_default=False,
        ),
    ]
