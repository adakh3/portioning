from django.db import transaction
from rest_framework import serializers
from .models import (
    Event, EventConstraintOverride, EventDishComment, EventPayment,
    sync_legacy_guest_counts, write_booking_segments, guest_counts_error,
    write_booking_courses,
)
from dishes.models import Dish
from dishes.ordering import dish_ids_in_added_order
from rules.models import GuestSegment
from staff.serializers import ShiftSerializer
from equipment.serializers import EquipmentReservationSerializer
from bookings.serializers.finance import InvoiceSerializer
from bookings.serializers.quotes import BookingLineItemSerializer
from bookings.serializers.meals import BookingMealSerializer, replace_meals
from bookings.serializers.courses import read_courses, read_dish_courses
from bookings.services.subtotal_guard import reject_negative_subtotal
from bookings.serializers.timeline import (
    BookingTimelineEntrySerializer, replace_timeline_entries,
)
from bookings.models import BookingLineItem
from users.mixins import get_request_org
from users.serializer_mixins import OrgScopedModelSerializer


class EventConstraintOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventConstraintOverride
        fields = ['max_total_food_per_person_grams', 'min_portion_per_dish_grams']


class EventDishCommentSerializer(serializers.ModelSerializer):
    dish_id = serializers.PrimaryKeyRelatedField(source='dish', queryset=Dish.objects.none())
    dish_name = serializers.CharField(source='dish.name', read_only=True)

    class Meta:
        model = EventDishComment
        fields = ['dish_id', 'dish_name', 'comment', 'portion_grams']
        extra_kwargs = {'comment': {'max_length': 2000}}


class EventPaymentSerializer(OrgScopedModelSerializer):
    """A client payment recorded against an event (advance / part / full)."""
    received_by_name = serializers.SerializerMethodField()
    method_display = serializers.CharField(source='get_method_display', read_only=True)

    class Meta:
        model = EventPayment
        fields = [
            'id', 'event', 'amount', 'payment_date',
            'method', 'method_display', 'received_by', 'received_by_name',
            'reference', 'notes', 'created_at',
        ]
        read_only_fields = ['created_at']
        extra_kwargs = {
            'event': {'required': False},  # set from the URL in the view
            'notes': {'max_length': 5000},
        }

    def get_received_by_name(self, obj):
        u = obj.received_by
        return f"{u.first_name} {u.last_name}".strip() or u.email if u else None


class EventSerializer(OrgScopedModelSerializer):
    # The model field is `event_date` (shared booking name); the API keeps exposing
    # it as `date` for now — the frontend is realigned in the editor-unification step.
    date = serializers.DateField(source='event_date')
    constraint_override = EventConstraintOverrideSerializer(required=False)
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(), write_only=True, required=False
    )
    dish_comments = EventDishCommentSerializer(many=True, required=False)
    line_items = BookingLineItemSerializer(many=True, required=False)
    additional_meals = BookingMealSerializer(many=True, required=False)
    # Event-day run-of-show. Optional: with none, the four legacy time fields
    # still render exactly as they always have.
    timeline_entries = BookingTimelineEntrySerializer(many=True, required=False)

    # Read-only computed fields
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    contact_name = serializers.CharField(source='primary_contact.name', read_only=True, default=None)
    venue_name = serializers.CharField(source='venue.name', read_only=True, default=None)
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_quote_id = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    # Per-segment guest breakdown (additive, read-only for now; the frontend
    # still writes gents/ladies, which dual-write mirrors into these rows).
    guest_counts = serializers.SerializerMethodField()
    # Courses (Starter/Entrée/Dessert + service style) and each dish's course
    # (by index into `courses`); written from the raw payload in create/update.
    courses = serializers.SerializerMethodField()
    dish_courses = serializers.SerializerMethodField()

    # Contact phone (enables the WhatsApp send shortcut on the detail page)
    contact_phone = serializers.CharField(source='primary_contact.phone', read_only=True, default=None)

    # E-signature status (for the staff-side "send for signature" flow)
    public_token = serializers.CharField(read_only=True)
    signature = serializers.SerializerMethodField()

    # Nested read-only relations
    shifts = ShiftSerializer(many=True, read_only=True)
    equipment_reservations = EquipmentReservationSerializer(many=True, read_only=True)
    invoices = InvoiceSerializer(many=True, read_only=True)
    # Client payment tracking (advances / part / full)
    payments = EventPaymentSerializer(many=True, read_only=True)
    amount_paid = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_status = serializers.CharField(read_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request:
            org = get_request_org(request)
            if org:
                dish_qs = Dish.objects.filter(organisation=org)
            else:
                dish_qs = Dish.objects.all()
            self.fields['dish_ids'].child_relation.queryset = dish_qs
            meal_fields = self.fields['additional_meals'].child.fields
            meal_fields['dish_ids'].child_relation.queryset = dish_qs
            meal_fields['audience_segment'].queryset = (
                org.guest_segments.all() if org else GuestSegment.objects.none()
            )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        is_b2b = attrs.get('is_b2b', getattr(self.instance, 'is_b2b', False))
        account = attrs.get('account', getattr(self.instance, 'account', None))
        if is_b2b and not account:
            raise serializers.ValidationError(
                {'account': 'A business is required for a B2B event.'}
            )
        # guest_count is the number; the gents/ladies split is optional but,
        # when given, must add up to it. Older API clients that send only a
        # split get guest_count derived from it (create only).
        gents = attrs.get('gents', getattr(self.instance, 'gents', 0)) or 0
        ladies = attrs.get('ladies', getattr(self.instance, 'ladies', 0)) or 0
        if self.instance is None and 'guest_count' not in attrs:
            attrs['guest_count'] = gents + ladies
        guest_count = attrs.get('guest_count', getattr(self.instance, 'guest_count', 0))
        if (gents or ladies) and gents + ladies != guest_count:
            raise serializers.ValidationError(
                {'gents': 'Gents + ladies must add up to the guest count '
                          '(or leave the split empty).'}
            )
        # N-segment breakdown: explicit in-count segments must not exceed the count.
        raw_counts = self.initial_data.get('guest_counts') if hasattr(self, 'initial_data') else None
        if raw_counts is not None:
            org = attrs.get('organisation') or getattr(self.instance, 'organisation', None)
            if org is None:
                org = get_request_org(self.context.get('request'))
            if org is not None:
                err = guest_counts_error(org, guest_count, raw_counts)
                if err:
                    raise serializers.ValidationError({'guest_counts': err})
        return attrs

    def get_assigned_to_name(self, obj):
        u = obj.assigned_to
        return f"{u.first_name} {u.last_name}".strip() if u else None

    def get_created_by_name(self, obj):
        u = obj.created_by
        return f"{u.first_name} {u.last_name}".strip() if u else None

    def get_signature(self, obj):
        sig = obj.latest_signature
        if not sig:
            return None
        return {'signer_name': sig.signer_name, 'signed_at': sig.signed_at.isoformat()}

    def get_guest_counts(self, obj):
        return [
            {'segment': r.segment.name, 'count': r.count,
             'counts_toward_total': r.segment.counts_toward_total,
             'price_per_head': str(r.price_per_head) if r.price_per_head is not None else None}
            for r in obj.guest_counts.select_related('segment').all()
        ]

    class Meta:
        model = Event
        fields = ['id', 'name', 'date', 'guest_count', 'gents', 'ladies',
                  'guest_counts',
                  'big_eaters', 'big_eaters_percentage',
                  'dishes', 'dish_ids', 'based_on_template', 'notes',
                  'courses', 'dish_courses',
                  'kitchen_instructions', 'banquet_instructions', 'setup_instructions',
                  'constraint_override', 'dish_comments', 'line_items', 'created_at',
                  # Booking fields
                  'primary_contact', 'contact_name', 'contact_phone',
                  'is_b2b', 'account', 'account_name',
                  'venue', 'venue_name', 'venue_address',
                  'venue_city', 'venue_state', 'venue_zip',
                  'product', 'product_name',
                  'assigned_to', 'assigned_to_name',
                  'created_by', 'created_by_name',
                  'event_type', 'meal_type', 'service_style', 'booking_date', 'price_per_head',
                  'status', 'status_display', 'is_taxable', 'tax_rate',
                  'subtotal', 'tax_amount', 'total',
                  'service_charge_pct', 'service_charge_taxable', 'service_charge',
                  'gratuity_pct', 'gratuity',
                  # Timeline
                  'setup_time', 'guest_arrival_time', 'meal_time', 'end_time',
                  # Guest counts
                  'guaranteed_count', 'final_count', 'final_count_due',
                  # Nested
                  'additional_meals', 'timeline_entries',
                  'public_token', 'signature',
                  'source_quote_id', 'shifts', 'equipment_reservations', 'invoices',
                  # Client payments
                  'payments', 'amount_paid', 'balance_due', 'payment_status']
        # created_by is stamped server-side on create; never client-writable.
        read_only_fields = ['created_at', 'subtotal', 'tax_amount', 'total',
                            'service_charge', 'gratuity', 'created_by']
        extra_kwargs = {
            'notes': {'max_length': 5000},
            'kitchen_instructions': {'max_length': 5000},
            'banquet_instructions': {'max_length': 5000},
            'setup_instructions': {'max_length': 5000},
            'venue_address': {'max_length': 1000},
        }

    def get_source_quote_id(self, obj):
        quote = getattr(obj, 'source_quote', None)
        return quote.id if quote else None

    def to_representation(self, instance):
        # Present dishes in the order they were added, not Dish's alphabetical default.
        data = super().to_representation(instance)
        if 'dishes' in data:
            data['dishes'] = dish_ids_in_added_order(instance)
        return data

    def get_courses(self, obj):
        return read_courses(obj)

    def get_dish_courses(self, obj):
        return read_dish_courses(obj)

    def _write_courses(self, booking):
        # `courses` is the authoritative list; require it before touching courses so a
        # lone `dish_courses` (or its absence) can't wipe existing courses. Absent
        # `courses` key → leave courses untouched.
        if 'courses' in self.initial_data:
            write_booking_courses(
                booking, self.initial_data.get('courses'), self.initial_data.get('dish_courses'),
            )

    # Atomic so a rejected save (see reject_negative_subtotal) rolls the whole
    # write back instead of leaving a half-written booking behind.
    @transaction.atomic
    def create(self, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', [])
        dish_comments_data = validated_data.pop('dish_comments', [])
        line_items_data = validated_data.pop('line_items', [])
        meals_data = validated_data.pop('additional_meals', [])
        timeline_data = validated_data.pop('timeline_entries', None)
        # Snapshot the org's pricing defaults (tax rate + service charge / gratuity)
        # onto the event when the payload omits them, so a taxable event taxes
        # consistently with quotes / the rest of the app.
        if validated_data.get('organisation'):
            from bookings.models import OrgSettings
            s = OrgSettings.for_org(validated_data['organisation'])
            validated_data.setdefault('tax_rate', s.default_tax_rate)
            validated_data.setdefault('service_charge_pct', s.service_charge_default_pct)
            validated_data.setdefault('service_charge_taxable', s.service_charge_taxable_default)
            validated_data.setdefault('gratuity_pct', s.gratuity_default_pct)
        event = Event.objects.create(**validated_data)
        raw_counts = self.initial_data.get('guest_counts') if hasattr(self, 'initial_data') else None
        if raw_counts is not None:
            write_booking_segments(event, raw_counts)
        else:
            sync_legacy_guest_counts(
                event, event.organisation, event.gents, event.ladies, event.guest_count,
            )
        if dishes:
            event.dishes.set(dishes)
        if override_data:
            EventConstraintOverride.objects.create(event=event, **override_data)
        for dc in dish_comments_data:
            EventDishComment.objects.create(event=event, **dc)
        self._write_courses(event)  # after dishes/dish_comments so course rows attach
        self._save_line_items(event, line_items_data)
        replace_meals('event', event, meals_data)
        if timeline_data is not None:
            replace_timeline_entries('event', event, timeline_data)
        event.recalculate_totals()  # food + meals + line items + tax (shared engine)
        reject_negative_subtotal(event)
        return event

    # Atomic so a rejected save (see reject_negative_subtotal) rolls the whole
    # write back instead of leaving a half-written booking behind.
    @transaction.atomic
    def update(self, instance, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', None)
        dish_comments_data = validated_data.pop('dish_comments', None)
        line_items_data = validated_data.pop('line_items', None)
        meals_data = validated_data.pop('additional_meals', None)
        timeline_data = validated_data.pop('timeline_entries', None)

        old_status = instance.status
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        raw_counts = self.initial_data.get('guest_counts') if hasattr(self, 'initial_data') else None
        if raw_counts is not None:
            write_booking_segments(instance, raw_counts)
        else:
            sync_legacy_guest_counts(
                instance, instance.organisation, instance.gents, instance.ladies,
                instance.guest_count,
            )
        if dishes is not None:
            instance.dishes.set(dishes)
        if override_data is not None:
            EventConstraintOverride.objects.update_or_create(
                event=instance, defaults=override_data
            )
        if dish_comments_data is not None:
            # Replace all dish comments (keep course assignments below re-applying).
            instance.dish_comments.all().delete()
            for dc in dish_comments_data:
                EventDishComment.objects.create(event=instance, **dc)
        self._write_courses(instance)  # after dish_comments so course rows attach
        if line_items_data is not None:
            self._save_line_items(instance, line_items_data)

        if meals_data is not None:
            replace_meals('event', instance, meals_data)

        if timeline_data is not None:
            replace_timeline_entries('event', instance, timeline_data)

        # Auto-calculate portions when status changes to confirmed and the event has
        # dishes but no PORTIONED dish_comments yet. Course assignments (REL-417) also
        # live on EventDishComment, so guard on portion_grams — not row existence — and
        # upsert so a course-only row gains its portion instead of colliding.
        new_status = instance.status
        if (new_status == 'confirmed' and old_status != 'confirmed'
                and instance.dishes.exists()
                and not instance.dish_comments.filter(portion_grams__isnull=False).exists()
                and dish_comments_data is None):
            from calculator.engine.calculator import calculate_portions
            result = calculate_portions(
                dish_ids=list(instance.dishes.values_list('id', flat=True)),
                guests=instance.portioning_guests(),
                org=instance.organisation,
            )
            for p in result['portions']:
                EventDishComment.objects.update_or_create(
                    event=instance, dish_id=p['dish_id'],
                    defaults={'portion_grams': p['grams_per_person']},
                )

        instance.recalculate_totals()  # food + meals + line items + tax (shared engine)
        reject_negative_subtotal(instance)
        return instance

    @staticmethod
    def _save_line_items(event, items_data):
        """Replace the event's add-on line items. Each BookingLineItem.save()
        recomputes its line_total."""
        event.line_items.all().delete()
        for item in items_data:
            fields = {k: v for k, v in item.items() if k not in ('id', 'quote', 'event')}
            BookingLineItem.objects.create(event=event, **fields)


EVENT_LIST_EXCLUDE = {
    'shifts', 'equipment_reservations', 'invoices',
    'dish_comments', 'constraint_override',
    'dish_ids', 'line_items', 'additional_meals', 'timeline_entries',
    # payment detail + balance read event.payments per row — detail-view only
    'payments', 'amount_paid', 'balance_due', 'payment_status',
    # signature is a per-row query + a method the list serializer doesn't define
    'signature', 'public_token', 'contact_phone',
    # per-segment guest breakdown is a per-row query — detail-view only
    'guest_counts',
    # courses + dish→course map are per-row queries — detail-view only
    'courses', 'dish_courses',
}


class EventListSerializer(serializers.ModelSerializer):
    """Lighter serializer for event list views."""
    date = serializers.DateField(source='event_date')
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    contact_name = serializers.CharField(source='primary_contact.name', read_only=True, default=None)
    venue_name = serializers.CharField(source='venue.name', read_only=True, default=None)
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_quote_id = serializers.SerializerMethodField()
    # Method fields aren't inherited from EventSerializer — redeclare for the list.
    # Backed by select_related on the view, so these stay one query.
    assigned_to_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [f for f in EventSerializer.Meta.fields if f not in EVENT_LIST_EXCLUDE]
        read_only_fields = ['created_at']

    def get_assigned_to_name(self, obj):
        u = obj.assigned_to
        return f"{u.first_name} {u.last_name}".strip() if u else None

    def get_created_by_name(self, obj):
        u = obj.created_by
        return f"{u.first_name} {u.last_name}".strip() if u else None

    def get_source_quote_id(self, obj):
        quote = getattr(obj, 'source_quote', None)
        return quote.id if quote else None
