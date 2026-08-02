from django.db import transaction
from rest_framework import serializers
from .models import (
    Event, EventConstraintOverride, EventDishComment, EventPayment,
    sync_legacy_guest_counts, write_booking_segments, guest_counts_error,
    write_booking_courses, write_menu_choices, read_menu_choices,
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
from bookings.services.subtotal_guard import (
    reject_unstorable_inputs, validate_booking_totals,
)
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
    # Which dishes are offered as a menu choice + their final tallies,
    # `{dish_id: count or None}` (REL-419). Counts are written by the finals panel
    # (EventFinalsView), which is the only place the sum is validated.
    menu_choices = serializers.SerializerMethodField()
    # The menu as the CLIENT sees it: course-grouped, with offered dishes collapsed
    # into one "Choice of: A / B / C" line (REL-419 AC13). Rendered by the same
    # `booking_menu_courses` the PDFs and the sign page use, so the in-app page can't
    # drift from the contract. None when the booking defines no courses.
    menu_lines = serializers.SerializerMethodField()
    # Derived finals state — a model property, never a stored column (AC10). Declared
    # as ReadOnlyField (not a method field) so the list serializer inherits it.
    finals_status = serializers.ReadOnlyField()

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
            # The nested dish_comments rows carry their own dish FK. The central
            # org-scoping mixin only reaches a serializer's own fields, so this one
            # was left on its declared `Dish.objects.none()` — which rejected EVERY
            # dish_id and made the kitchen page's portion save fail with "Invalid
            # pk". Scope it to the request's org like the others.
            self.fields['dish_comments'].child.fields['dish_id'].queryset = dish_qs
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
        # Reject a booking too large to store before anything is written — a
        # per-guest line item recalculates the parent on save, so an overflow
        # there crashed mid-write rather than reaching the post-save guard.
        reject_unstorable_inputs(
            guest_count,
            attrs.get('price_per_head', getattr(self.instance, 'price_per_head', None)),
            self.initial_data.get('line_items') if hasattr(self, 'initial_data') else None,
        )
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
                  'courses', 'dish_courses', 'menu_choices', 'menu_lines', 'finals_status',
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
        # The finals numbers are writable ONLY through the finals endpoint (REL-419):
        # that is the one place the per-entrée tallies are checked against the
        # guarantee, so letting an ordinary PATCH set final_count would both bypass
        # the check and let a stale event form blank a guarantee someone just
        # recorded. `EventFinalsSerializer` writes them on the model directly.
        read_only_fields = ['created_at', 'subtotal', 'tax_amount', 'total',
                            'service_charge', 'gratuity', 'created_by',
                            'guaranteed_count', 'final_count', 'final_count_due']
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

    def get_menu_choices(self, obj):
        return read_menu_choices(obj)

    def get_menu_lines(self, obj):
        from bookings.services.presentation import booking_menu_courses
        return booking_menu_courses(obj)

    def _write_dish_lines(self, booking):
        # `courses` is the authoritative list; require it before touching courses so a
        # lone `dish_courses` (or its absence) can't wipe existing courses. Absent
        # `courses` key → leave courses untouched. Entrée-choice flags (REL-419) obey
        # the same rule on the same rows — only an explicit `menu_choices` key
        # rewrites them, so an ordinary event save can't clear the offerings.
        if 'courses' in self.initial_data:
            write_booking_courses(
                booking, self.initial_data.get('courses'), self.initial_data.get('dish_courses'),
            )
        # An explicit `null` means "nothing to say", not "clear them" — a client that
        # serialises absent optional fields as null must not wipe the offerings.
        if self.initial_data.get('menu_choices') is not None:
            try:
                write_menu_choices(booking, self.initial_data['menu_choices'])
            except ValueError as exc:
                raise serializers.ValidationError({'menu_choices': str(exc)})

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
        self._write_dish_lines(event)  # after dishes/dish_comments so course rows attach
        self._save_line_items(event, line_items_data)
        replace_meals('event', event, meals_data)
        if timeline_data is not None:
            replace_timeline_entries('event', event, timeline_data)
        event.recalculate_totals()  # food + meals + line items + tax (shared engine)
        validate_booking_totals(event)
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
            # The rows also carry the entrée-choice flag + final tally (REL-419), which
            # the comments/portions payload knows nothing about. Carry them across the
            # replace BY DISH — including for dishes the payload leaves out, because
            # the kitchen page only sends rows that have a portion. Without the
            # re-create below, saving portions there would delete an offered entrée
            # and the guest tally already recorded against it.
            carried = {
                r.dish_id: (r.is_choice, r.choice_count)
                for r in instance.dish_comments.all() if r.is_choice
            }
            instance.dish_comments.all().delete()
            written = set()
            for dc in dish_comments_data:
                row = EventDishComment.objects.create(event=instance, **dc)
                written.add(row.dish_id)
                if row.dish_id in carried:
                    row.is_choice, row.choice_count = carried[row.dish_id]
                    row.save(update_fields=['is_choice', 'choice_count'])
            for dish_id, (flag, count) in carried.items():
                if dish_id not in written:
                    EventDishComment.objects.create(
                        event=instance, dish_id=dish_id,
                        is_choice=flag, choice_count=count,
                    )
        self._write_dish_lines(instance)  # after dish_comments so course rows attach
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
        validate_booking_totals(instance)
        return instance

    @staticmethod
    def _save_line_items(event, items_data):
        """Replace the event's add-on line items. Each BookingLineItem.save()
        recomputes its line_total."""
        event.line_items.all().delete()
        for item in items_data:
            fields = {k: v for k, v in item.items() if k not in ('id', 'quote', 'event')}
            BookingLineItem.objects.create(event=event, **fields)


class EventFinalsSerializer(serializers.Serializer):
    """The "Record final numbers" panel's single save (REL-419 AC6).

    The finals guarantee, its due date, and the per-dish tallies land together in one
    write, and this is the ONLY place the tallies are checked against the guarantee
    (AC7). Quote-time and ordinary event saves never see this serializer, which is
    what makes "no sum validation at proposal" structural rather than a flag someone
    can forget to pass (AC8).

    The check runs PER COURSE: every guest picks one dish from each course that offers
    a choice, so a choice of main and a choice of dessert must each add up to the
    guarantee on their own.
    """
    final_count = serializers.IntegerField(min_value=0)
    final_count_due = serializers.DateField(required=False, allow_null=True)
    guaranteed_count = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    # {dish_id: tally}. Only dishes flagged as a menu choice are counted.
    choice_counts = serializers.DictField(
        child=serializers.IntegerField(min_value=0), required=False,
    )

    def __init__(self, *args, event=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.event = event

    def validate(self, attrs):
        from events.models import FINALS_STATUSES
        if self.event.status not in FINALS_STATUSES:
            raise serializers.ValidationError(
                'Final numbers can only be recorded once the booking is confirmed.'
            )
        offered = {
            r.dish_id: r.dish.name
            for r in self.event.dish_comments.select_related('dish').all()
            if r.is_choice
        }
        if not offered:
            return attrs
        try:
            counts = {int(k): v for k, v in (attrs.get('choice_counts') or {}).items()}
        except (TypeError, ValueError):
            raise serializers.ValidationError({
                'choice_counts': 'Each key must be a dish id.',
            })
        unknown = set(counts) - set(offered)
        if unknown:
            raise serializers.ValidationError({
                'choice_counts': 'A tally was given for a dish that is not offered as '
                                 'a choice on this event.',
            })
        # One sum per course. Missing tallies count as zero, so a half-filled panel —
        # or a whole course left blank — fails here rather than saving a breakdown
        # that silently doesn't add up. Untick a course's dishes if its numbers are
        # never collected; the tick is the commitment to collect them.
        from events.models import choice_groups
        guarantee = attrs['final_count']
        for group in choice_groups(self.event):
            total = sum(counts.get(dish_id, 0) for dish_id in group['dish_ids'])
            if total != guarantee:
                label = f"{group['course_name']} choices" if group['course_name'] else 'Menu choices'
                raise serializers.ValidationError({
                    'choice_counts': f'{label} must add up to the final guarantee '
                                     f'({guarantee}) — they currently total {total}.',
                })
        attrs['choice_counts'] = counts
        return attrs

    def save(self):
        event = self.event
        data = self.validated_data
        event.final_count = data['final_count']
        fields = ['final_count']
        if 'final_count_due' in data:
            event.final_count_due = data['final_count_due']
            fields.append('final_count_due')
        if 'guaranteed_count' in data:
            event.guaranteed_count = data['guaranteed_count']
            fields.append('guaranteed_count')
        event.save(update_fields=fields)
        # Tallies are kitchen numbers: they land on the existing menu-choice rows
        # and never touch pricing, so no recalculate_totals here (AC9).
        for dish_id, count in (data.get('choice_counts') or {}).items():
            EventDishComment.objects.filter(
                event=event, dish_id=dish_id, is_choice=True,
            ).update(choice_count=count)
        return event


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
    # menu choices + rendered menu lines read the per-dish rows — detail-view only.
    # `finals_status` stays: it is derived from columns already on the row, so the
    # list pill costs no query.
    'menu_choices', 'menu_lines',
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
