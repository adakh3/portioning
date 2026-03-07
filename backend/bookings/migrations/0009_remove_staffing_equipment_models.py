from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0008_lead_created_by_activitylog'),
        ('staff', '0001_initial'),
        ('equipment', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(name='Shift'),
                migrations.DeleteModel(name='StaffMember'),
                migrations.DeleteModel(name='LaborRole'),
                migrations.DeleteModel(name='EquipmentReservation'),
                migrations.DeleteModel(name='EquipmentItem'),
            ],
            database_operations=[],
        ),
    ]
