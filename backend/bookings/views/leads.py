from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Lead, Quote
from bookings.models.leads import LeadStatus
from bookings.serializers import LeadSerializer, QuoteSerializer


class LeadListCreateView(generics.ListCreateAPIView):
    serializer_class = LeadSerializer

    def get_queryset(self):
        qs = Lead.objects.select_related('account', 'converted_to_quote', 'budget_range').prefetch_related('quotes').all()
        # Filter by status
        lead_status = self.request.query_params.get('status')
        if lead_status:
            qs = qs.filter(status=lead_status)
        return qs


class LeadDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Lead.objects.select_related('account', 'converted_to_quote', 'budget_range').prefetch_related('quotes').all()
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

        if lead.status != LeadStatus.QUALIFIED:
            return Response(
                {'error': 'Lead must be qualified before converting'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
        lead.transition_to(LeadStatus.CONVERTED)

        return Response(QuoteSerializer(quote).data, status=status.HTTP_201_CREATED)
