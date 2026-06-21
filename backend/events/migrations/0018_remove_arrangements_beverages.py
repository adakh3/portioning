"""Drop EventArrangement / EventBeverage — their data was copied into the unified
BookingLineItem in bookings/0039 (depended on below, so the copy runs first)."""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0017_event_is_b2b_person_first'),
        ('bookings', '0039_booking_line_item'),
    ]

    operations = [
        migrations.DeleteModel(name='EventArrangement'),
        migrations.DeleteModel(name='EventBeverage'),
    ]
