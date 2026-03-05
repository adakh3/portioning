from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User
from users.serializers import UserSerializer
from bookings.models import Lead, ProductLine, Quote
from bookings.models.choices import LeadStatusOption
from bookings.serializers import LeadSerializer, QuoteSerializer
from bookings.serializers.leads import ProductLineSerializer


class UserListView(generics.ListAPIView):
    queryset = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    serializer_class = UserSerializer


class ProductLineListView(generics.ListAPIView):
    queryset = ProductLine.objects.filter(is_active=True)
    serializer_class = ProductLineSerializer


LEAD_ORDERING_FIELDS = {
    'created_at', '-created_at',
    'event_date', '-event_date',
    'lead_date', '-lead_date',
    'contact_name', '-contact_name',
    'guest_estimate', '-guest_estimate',
    'status', '-status',
}


class LeadListCreateView(generics.ListCreateAPIView):
    serializer_class = LeadSerializer

    def get_queryset(self):
        qs = Lead.objects.select_related(
            'account', 'converted_to_quote', 'budget_range', 'product', 'assigned_to',
        ).prefetch_related('quotes').all()
        params = self.request.query_params

        # Status filter
        lead_status = params.get('status')
        if lead_status:
            qs = qs.filter(status=lead_status)

        # Assigned user filter
        assigned_to = params.get('assigned_to')
        if assigned_to:
            qs = qs.filter(assigned_to_id=assigned_to)

        # Product filter
        product = params.get('product')
        if product:
            qs = qs.filter(product_id=product)

        # Event type filter
        event_type = params.get('event_type')
        if event_type:
            qs = qs.filter(event_type=event_type)

        # Event date range
        date_from = params.get('date_from')
        if date_from:
            qs = qs.filter(event_date__gte=date_from)
        date_to = params.get('date_to')
        if date_to:
            qs = qs.filter(event_date__lte=date_to)

        # Lead date range
        lead_date_from = params.get('lead_date_from')
        if lead_date_from:
            qs = qs.filter(lead_date__gte=lead_date_from)
        lead_date_to = params.get('lead_date_to')
        if lead_date_to:
            qs = qs.filter(lead_date__lte=lead_date_to)

        # Ordering
        ordering = params.get('ordering')
        if ordering and ordering in LEAD_ORDERING_FIELDS:
            qs = qs.order_by(ordering)

        return qs


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

        leads = Lead.objects.filter(id__in=ids)
        count = leads.count()

        if count == 0:
            return Response({'error': 'No leads found'}, status=status.HTTP_404_NOT_FOUND)

        if action == 'delete':
            deleted_count = count
            leads.delete()
            return Response({'updated': deleted_count})

        if action == 'assign':
            if value is None:
                leads.update(assigned_to=None)
            else:
                leads.update(assigned_to_id=value)

        elif action == 'status':
            valid_statuses = set(LeadStatusOption.objects.values_list('value', flat=True))
            if value not in valid_statuses:
                return Response({'error': f'Invalid status: {value}'}, status=status.HTTP_400_BAD_REQUEST)
            leads.update(status=value)

        elif action == 'product':
            if value is None:
                leads.update(product=None)
            else:
                leads.update(product_id=value)

        return Response({'updated': count})


class LeadDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Lead.objects.select_related(
        'account', 'converted_to_quote', 'budget_range', 'product', 'assigned_to',
    ).prefetch_related('quotes').all()
    serializer_class = LeadSerializer


class LeadTransitionView(APIView):
    """POST /api/bookings/leads/<pk>/transition/ {status: "contacted"}"""

    def post(self, request, pk):
        lead = Lead.objects.get(pk=pk)
        new_status = request.data.get('status')
        if not new_status:
            return Response({'error': 'status is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            lead.transition_to(new_status)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(LeadSerializer(lead).data)


class LeadConvertView(APIView):
    """POST /api/bookings/leads/<pk>/convert/ — Create Quote from Lead."""

    def post(self, request, pk):
        lead = Lead.objects.select_related('account').get(pk=pk)

        if lead.converted_to_quote:
            return Response(
                {'error': 'Lead already converted', 'quote_id': lead.converted_to_quote_id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create account from lead if none exists
        account = lead.account
        if not account:
            from bookings.models import Account
            account = Account.objects.create(name=lead.contact_name)
            lead.account = account

        quote = Quote.objects.create(
            lead=lead,
            account=account,
            event_date=lead.event_date or lead.created_at.date(),
            guest_count=lead.guest_estimate or 1,
            event_type=lead.event_type,
            service_style=lead.service_style,
        )

        lead.converted_to_quote = quote
        lead.transition_to('converted')

        return Response(QuoteSerializer(quote).data, status=status.HTTP_201_CREATED)
