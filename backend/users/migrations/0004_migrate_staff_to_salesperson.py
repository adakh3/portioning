from django.db import migrations


def rename_staff_to_salesperson(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='staff').update(role='salesperson')


def rename_salesperson_to_staff(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='salesperson').update(role='staff')


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0003_rename_staff_to_salesperson'),
    ]

    operations = [
        migrations.RunPython(rename_staff_to_salesperson, rename_salesperson_to_staff),
    ]
