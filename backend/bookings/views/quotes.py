from django.http import HttpResponse
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Quote, QuoteLineItem
from bookings.models.quotes import QuoteStatus
from bookings.serializers import QuoteSerializer, QuoteLineItemSerializer
from bookings.pdf import generate_quote_pdf


class QuoteListCreateView(generics.ListCreateAPIView):
    serializer_class = QuoteSerializer

    def get_queryset(self):
        qs = Quote.objects.select_related('account', 'venue', 'lead', 'event', 'based_on_template', 'primary_contact').prefetch_related('line_items', 'dishes').all()
        quote_status = self.request.query_params.get('status')
        if quote_status:
            qs = qs.filter(status=quote_status)
        return qs


class QuoteDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Quote.objects.select_related('account', 'venue', 'lead', 'event', 'based_on_template', 'primary_contact').prefetch_related('line_items', 'dishes').all()
    serializer_class = QuoteSerializer

    def perform_update(self, serializer):
        serializer.save()


class QuoteTransitionView(APIView):
    """POST /api/bookings/quotes/<pk>/transition/ {status: "sent"}"""

    def post(self, request, pk):
        quote = Quote.objects.select_related('account', 'lead', 'based_on_template', 'primary_contact', 'venue').prefetch_related('dishes').get(pk=pk)
        new_status = request.data.get('status')
        if not new_status:
            return Response({'error': 'status is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            quote.transition_to(new_status)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Auto-create Event when quote is accepted
        if new_status == QuoteStatus.ACCEPTED and not quote.event:
            from events.models import Event
            event_name = f"{quote.account.name} — {quote.get_event_type_display()}"
            guest_count = quote.guest_count
            event = Event.objects.create(
                name=event_name,
                date=quote.event_date,
                gents=guest_count // 2,
                ladies=guest_count - (guest_count // 2),
                account=quote.account,
                primary_contact=quote.primary_contact,
                venue=quote.venue,
                venue_address=quote.venue_address,
                event_type=quote.event_type,
                service_style=quote.service_style,
                price_per_head=quote.price_per_head,
                status='confirmed',
                based_on_template=quote.based_on_template,
            )
            # Copy menu (dishes) from quote to event
            if quote.dishes.exists():
                event.dishes.set(quote.dishes.all())
            quote.event = event
            quote.save(update_fields=['event', 'updated_at'])

        # Re-fetch with all relations for serializer
        quote = Quote.objects.select_related('account', 'venue', 'lead', 'event', 'based_on_template', 'primary_contact').prefetch_related('line_items', 'dishes').get(pk=pk)
        return Response(QuoteSerializer(quote).data)


class QuoteLineItemListCreateView(generics.ListCreateAPIView):
    serializer_class = QuoteLineItemSerializer

    def get_queryset(self):
        return QuoteLineItem.objects.filter(
            quote_id=self.kwargs['quote_pk']
        ).select_related('quote', 'menu_item', 'equipment_item', 'labor_role')

    def perform_create(self, serializer):
        quote = Quote.objects.get(pk=self.kwargs['quote_pk'])
        serializer.save(quote=quote)


class QuoteLineItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuoteLineItemSerializer

    def get_queryset(self):
        return QuoteLineItem.objects.filter(
            quote_id=self.kwargs['quote_pk']
        ).select_related('quote', 'menu_item', 'equipment_item', 'labor_role')

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        instance.delete()


class QuotePDFView(APIView):
    """GET /api/bookings/quotes/<pk>/pdf/ — Download quote as PDF"""

    def get(self, request, pk):
        quote = Quote.objects.select_related(
            'account', 'venue', 'primary_contact', 'based_on_template',
        ).prefetch_related('line_items', 'dishes').get(pk=pk)
        pdf_bytes = generate_quote_pdf(quote)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="Quote-{quote.pk}-v{quote.version}.pdf"'
        return response
