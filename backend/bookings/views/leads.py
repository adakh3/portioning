from collections import defaultdict

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User
from users.serializers import UserSerializer
from users.mixins import get_request_org, apply_org_filter, get_org_object_or_404
from bookings.models import Lead, ProductLine, Quote
from bookings.models.choices import LeadStatusOption
from bookings.serializers import LeadSerializer, QuoteSerializer
from bookings.serializers.leads import ProductLineSerializer, LeadListSerializer
from bookings.activity import log_activity, log_field_changes, TRACKED_FIELDS
from bookings.permissions import IsManagerOrOwner, is_salesperson


class UserListView(generics.ListAPIView):
    serializer_class = UserSerializer

    def get_queryset(self):
        qs = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
        org = get_request_org(self.request)
        if org:
            qs = qs.filter(organisation=org)
        return qs


class ProductLineListView(generics.ListAPIView):
    serializer_class = ProductLineSerializer

    def get_queryset(self):
        qs = ProductLine.objects.filter(is_active=True)
        org = get_request_org(self.request)
        if org:
            qs = qs.filter(organisation=org)
        return qs


class ProductLineDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = ProductLineSerializer

    def get_queryset(self):
        return apply_org_filter(ProductLine.objects.all(), self.request)


LEAD_ORDERING_FIELDS = {
    'created_at', '-created_at',
    'event_date', '-event_date',
    'lead_date', '-lead_date',
    'contact_name', '-contact_name',
    'guest_estimate', '-guest_estimate',
    'status', '-status',
}


def _apply_lead_filters(qs, request):
    """Shared filter logic used by both list and kanban views."""
    user = request.user
    if is_salesperson(user):
        qs = qs.filter(Q(assigned_to=user) | Q(created_by=user))

    params = request.query_params

    lead_status = params.get('status')
    if lead_status:
        qs = qs.filter(status=lead_status)

    assigned_to = params.get('assigned_to')
    if assigned_to == 'unassigned':
        qs = qs.filter(assigned_to__isnull=True)
    elif assigned_to:
        qs = qs.filter(assigned_to_id=assigned_to)

    product = params.get('product')
    if product:
        qs = qs.filter(product_id=product)

    event_type = params.get('event_type')
    if event_type:
        qs = qs.filter(event_type=event_type)

    date_from = params.get('date_from')
    if date_from:
        qs = qs.filter(event_date__gte=date_from)
    date_to = params.get('date_to')
    if date_to:
        qs = qs.filter(event_date__lte=date_to)

    lead_date_from = params.get('lead_date_from')
    if lead_date_from:
        qs = qs.filter(lead_date__gte=lead_date_from)
    lead_date_to = params.get('lead_date_to')
    if lead_date_to:
        qs = qs.filter(lead_date__lte=lead_date_to)

    ordering = params.get('ordering')
    if ordering and ordering in LEAD_ORDERING_FIELDS:
        qs = qs.order_by(ordering)

    return qs


class LeadListCreateView(generics.ListCreateAPIView):
    serializer_class = LeadSerializer

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return LeadListSerializer
        return LeadSerializer

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        lead = serializer.save(created_by=user, organisation=get_request_org(self.request))
        log_activity(lead, 'created', user=user, description=f"Created lead \"{lead.contact_name}\"")

    def get_queryset(self):
        qs = Lead.objects.select_related(
            'account', 'won_quote', 'won_event', 'product', 'assigned_to',
            'lost_reason_option',
        )
        qs = apply_org_filter(qs, self.request)
        return _apply_lead_filters(qs, self.request)


class LeadBulkUpdateView(APIView):
    """POST /api/bookings/leads/bulk/ — Bulk update leads."""

    def post(self, request):
        ids = request.data.get('ids', [])
        action = request.data.get('action')
        value = request.data.get('value')

        if not ids or not isinstance(ids, list):
            return Response({'error': 'ids must be a non-empty list'}, status=status.HTTP_400_BAD_REQUEST)
        if action not in ('assign', 'status', 'product', 'delete'):
            return Response({'error': 'action must be one of: assign, status, product, delete'}, status=status.HTTP_400_BAD_REQUEST)

        leads = apply_org_filter(Lead.objects.filter(id__in=ids), request)
        count = leads.count()

        if count == 0:
            return Response({'error': 'No leads found'}, status=status.HTTP_404_NOT_FOUND)

        user = request.user if request.user.is_authenticated else None

        if action == 'delete':
            deleted_count = count
            leads.delete()
            return Response({'updated': deleted_count})

        # Capture old values for logging
        lead_list = list(leads.values('id', 'assigned_to_id', 'status', 'product_id'))

        if action == 'assign':
            if value is None:
                leads.update(assigned_to=None)
            else:
                leads.update(assigned_to_id=value)
            field, desc = 'assigned_to', 'Bulk updated assignment'

        elif action == 'status':
            org = get_request_org(request)
            status_qs = LeadStatusOption.objects.all()
            if org:
                status_qs = status_qs.filter(organisation=org)
            valid_statuses = set(status_qs.values_list('value', flat=True))
            if value not in valid_statuses:
                return Response({'error': f'Invalid status: {value}'}, status=status.HTTP_400_BAD_REQUEST)
            leads.update(status=value)
            field, desc = 'status', f'Bulk changed status to "{value}"'

        elif action == 'product':
            if value is None:
                leads.update(product=None)
            else:
                leads.update(product_id=value)
            field, desc = 'product', 'Bulk updated product'

        # Bulk log
        from django.contrib.contenttypes.models import ContentType
        from bookings.models.activity import ActivityLog
        ct = ContentType.objects.get_for_model(Lead)
        field_map = {'assign': 'assigned_to_id', 'status': 'status', 'product': 'product_id'}
        raw_field = field_map.get(action, action)
        logs = []
        for ld in lead_list:
            old_val = ld.get(raw_field, '')
            logs.append(ActivityLog(
                content_type=ct,
                object_id=ld['id'],
                action='status_change' if action == 'status' else 'updated',
                field_name=field,
                old_value=str(old_val) if old_val is not None else '',
                new_value=str(value) if value is not None else '',
                description=desc,
                user=user,
            ))
        if logs:
            ActivityLog.objects.bulk_create(logs)

        return Response({'updated': count})


def _snapshot_lead(lead):
    """Capture current field values for change tracking."""
    data = {}
    for field in TRACKED_FIELDS:
        val = getattr(lead, field, None)
        # FK fields: store the ID
        if field in ('assigned_to', 'product'):
            val = getattr(lead, f'{field}_id', None)
        data[field] = val
    return data


class LeadDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LeadSerializer

    def get_queryset(self):
        qs = Lead.objects.select_related(
            'account', 'won_quote', 'won_event', 'product', 'assigned_to',
            'lost_reason_option',
        ).prefetch_related('quotes')
        return apply_org_filter(qs, self.request)

    def perform_update(self, serializer):
        lead = self.get_object()
        old_data = _snapshot_lead(lead)
        updated = serializer.save()
        new_data = _snapshot_lead(updated)
        user = self.request.user if self.request.user.is_authenticated else None
        log_field_changes(updated, old_data, new_data, user=user)


class LeadTransitionView(APIView):
    """POST /api/bookings/leads/<pk>/transition/ {status: "contacted"}"""

    def post(self, request, pk):
        lead = get_org_object_or_404(Lead, request, pk=pk)
        new_status = request.data.get('status')
        if not new_status:
            return Response({'error': 'status is required'}, status=status.HTTP_400_BAD_REQUEST)

        # When marking lost, require lost_reason_option
        if new_status == 'lost':
            lost_reason_option_id = request.data.get('lost_reason_option')
            if not lost_reason_option_id:
                return Response(
                    {'error': 'lost_reason_option is required when marking a lead as lost'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            from bookings.models.choices import LostReasonOption
            try:
                lost_reason = LostReasonOption.objects.get(
                    pk=lost_reason_option_id, is_active=True, organisation=lead.organisation,
                )
            except LostReasonOption.DoesNotExist:
                return Response({'error': 'Invalid lost_reason_option'}, status=status.HTTP_400_BAD_REQUEST)
            lead.lost_reason_option = lost_reason
            lost_notes = request.data.get('lost_notes', '')
            if lost_notes:
                lead.lost_notes = lost_notes

        old_status = lead.status
        try:
            lead.transition_to(new_status)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user if request.user.is_authenticated else None
        log_activity(
            lead, 'status_change', user=user,
            field_name='status', old_value=old_status, new_value=new_status,
            description=f"Changed status from \"{old_status}\" to \"{new_status}\"",
        )
        return Response(LeadSerializer(lead).data)


def _find_or_create_contact(account, name, email, phone):
    """Find existing Contact by email/phone on account, or create a new one."""
    from bookings.models.accounts import Contact
    contact = None
    if email:
        contact = Contact.objects.filter(account=account, email=email).first()
    if not contact and phone:
        contact = Contact.objects.filter(account=account, phone=phone).first()
    if not contact and name:
        contact = Contact.objects.create(
            account=account,
            name=name,
            email=email or "",
            phone=phone or "",
            is_primary=True,
        )
    return contact


class LeadCreateQuoteView(APIView):
    """POST /api/bookings/leads/<pk>/create-quote/ — Create Quote from Lead (does not change lead status)."""

    def post(self, request, pk):
        lead = get_org_object_or_404(Lead.objects.select_related('account'), request, pk=pk)

        # Create account from lead if none exists
        account = lead.account
        if not account:
            from bookings.models import Account
            account = Account.objects.create(name=lead.contact_name, account_type="individual", organisation=lead.organisation)
            lead.account = account
            lead.save(update_fields=['account'])

        contact = _find_or_create_contact(account, lead.contact_name, lead.contact_email, lead.contact_phone)

        user = request.user if request.user.is_authenticated else None

        quote = Quote.objects.create(
            lead=lead,
            account=account,
            primary_contact=contact,
            event_date=lead.event_date or lead.created_at.date(),
            guest_count=lead.guest_estimate or 1,
            event_type=lead.event_type,
            meal_type=lead.meal_type,
            service_style=lead.service_style,
            product=lead.product,
            created_by=user,
            organisation=lead.organisation,
        )
        log_activity(
            lead, 'updated', user=user,
            description=f"Created Quote #{quote.id} from lead",
        )

        return Response(QuoteSerializer(quote).data, status=status.HTTP_201_CREATED)


# Keep old name as alias for backward compat with any imports
LeadConvertView = LeadCreateQuoteView


class LeadWonView(APIView):
    """POST /api/bookings/leads/<pk>/won/ — Mark lead as Won, optionally create event."""

    def post(self, request, pk):
        lead = get_org_object_or_404(
            Lead.objects.select_related('account', 'won_quote', 'won_event'), request, pk=pk,
        )

        if lead.status == 'won':
            return Response({'error': 'Lead is already won'}, status=status.HTTP_400_BAD_REQUEST)

        quote_id = request.data.get('quote_id')
        create_event = request.data.get('create_event', False)

        quote = None
        if quote_id:
            try:
                quote = Quote.objects.get(pk=quote_id, lead=lead)
            except Quote.DoesNotExist:
                return Response({'error': 'Quote not found for this lead'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user if request.user.is_authenticated else None

        event = None
        if create_event:
            event = self._create_event(lead, quote, user=user)
            lead.won_event = event

        if quote:
            lead.won_quote = quote

        old_status = lead.status
        lead.transition_to('won')

        desc = "Marked lead as Won"
        if event:
            desc += f" and created Event #{event.id}"
        log_activity(
            lead, 'status_change', user=user,
            field_name='status', old_value=old_status, new_value='won',
            description=desc,
        )

        return Response(LeadSerializer(lead).data)

    def _create_event(self, lead, quote=None, user=None):
        from events.models import Event
        account = lead.account

        event_name = f"{lead.contact_name}"
        if account:
            event_name = f"{account.name}"

        guest_count = lead.guest_estimate or 1
        price_per_head = None
        event_status = 'tentative'
        based_on_template = None
        booking_date = timezone.now().date()

        if quote:
            guest_count = quote.guest_count
            price_per_head = quote.price_per_head
            event_status = 'confirmed'
            based_on_template = quote.based_on_template
            if quote.accepted_at:
                booking_date = quote.accepted_at.date()

        # Resolve primary contact from quote or lead strings
        primary_contact = None
        if quote and quote.primary_contact:
            primary_contact = quote.primary_contact
        elif account:
            primary_contact = _find_or_create_contact(account, lead.contact_name, lead.contact_email, lead.contact_phone)

        event = Event.objects.create(
            name=event_name,
            date=lead.event_date or lead.created_at.date(),
            gents=guest_count // 2,
            ladies=guest_count - (guest_count // 2),
            account=account,
            primary_contact=primary_contact,
            event_type=lead.event_type,
            meal_type=lead.meal_type,
            service_style=lead.service_style,
            product=lead.product,
            booking_date=booking_date,
            price_per_head=price_per_head,
            status=event_status,
            based_on_template=based_on_template,
            created_by=user,
            organisation=lead.organisation,
        )

        # Copy dishes from quote and auto-calculate portions
        if quote and quote.dishes.exists():
            event.dishes.set(quote.dishes.all())
            from calculator.engine.calculator import calculate_portions
            from events.models import EventDishComment
            result = calculate_portions(
                dish_ids=list(event.dishes.values_list('id', flat=True)),
                guests={'gents': event.gents, 'ladies': event.ladies},
                org=lead.organisation,
            )
            for p in result['portions']:
                EventDishComment.objects.create(
                    event=event,
                    dish_id=p['dish_id'],
                    portion_grams=p['grams_per_person'],
                )

        return event


class LeadCreateEventView(APIView):
    """POST /api/bookings/leads/<pk>/create-event/ — Create event from a won lead."""

    def post(self, request, pk):
        lead = get_org_object_or_404(
            Lead.objects.select_related('account', 'won_event'), request, pk=pk,
        )

        if lead.status != 'won':
            return Response({'error': 'Lead must be won to create an event'}, status=status.HTTP_400_BAD_REQUEST)

        if lead.won_event:
            return Response(
                {'error': 'Event already exists for this lead', 'event_id': lead.won_event_id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        quote_id = request.data.get('quote_id')
        quote = None
        if quote_id:
            try:
                quote = Quote.objects.get(pk=quote_id, lead=lead)
            except Quote.DoesNotExist:
                return Response({'error': 'Quote not found for this lead'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user if request.user.is_authenticated else None
        event = LeadWonView._create_event(None, lead, quote, user=user)
        lead.won_event = event
        lead.save(update_fields=['won_event'])
        log_activity(
            lead, 'updated', user=user,
            description=f"Created Event #{event.id} from won lead",
        )

        from events.serializers import EventSerializer
        return Response(EventSerializer(event).data, status=status.HTTP_201_CREATED)


class LeadActivityView(generics.ListAPIView):
    """GET /api/bookings/leads/<pk>/activity/ — Activity log for a lead."""
    from bookings.serializers.activity import ActivityLogSerializer
    serializer_class = ActivityLogSerializer

    def get_queryset(self):
        from django.contrib.contenttypes.models import ContentType
        from bookings.models.activity import ActivityLog
        # Validate that the lead belongs to the user's org
        get_org_object_or_404(Lead, self.request, pk=self.kwargs['pk'])
        ct = ContentType.objects.get_for_model(Lead)
        return ActivityLog.objects.filter(
            content_type=ct, object_id=self.kwargs['pk']
        ).select_related('user')


class LeadAutoAssignView(APIView):
    """POST /api/bookings/leads/auto-assign/ — Round-robin auto-assign unassigned leads."""
    permission_classes = [IsManagerOrOwner]

    def post(self, request):
        from bookings.services.round_robin import run_round_robin
        result = run_round_robin(request.user, org=get_request_org(request))
        return Response(result)


KANBAN_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost']


class LeadKanbanView(APIView):
    """GET /api/bookings/leads/kanban/ — All columns in a single response."""

    def get(self, request):
        page_size = int(request.query_params.get('page_size', 20))

        qs = Lead.objects.select_related(
            'account', 'won_quote', 'won_event', 'product', 'assigned_to',
            'lost_reason_option',
        )
        qs = apply_org_filter(qs, request)
        qs = _apply_lead_filters(qs, request)

        # Group leads by status in Python
        buckets = defaultdict(list)
        counts = defaultdict(int)
        for lead in qs.iterator():
            s = lead.status
            counts[s] += 1
            if len(buckets[s]) < page_size:
                buckets[s].append(lead)

        # Serialize and build response
        columns = {}
        for status_val in KANBAN_STATUSES:
            leads = buckets.get(status_val, [])
            columns[status_val] = {
                'count': counts.get(status_val, 0),
                'results': LeadListSerializer(leads, many=True).data,
            }

        return Response({'columns': columns})
