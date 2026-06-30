from django.db.models import Q
from django.http import HttpResponse
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Quote, BookingLineItem
from bookings.models.quotes import QuoteStatus
from bookings.serializers import QuoteSerializer, QuoteLineItemSerializer
from bookings.serializers.quotes import QuoteListSerializer
from bookings.pdf import generate_quote_pdf
from bookings.permissions import is_salesperson
from users.mixins import get_request_org, apply_org_filter, get_org_object_or_404


def _copy_line_items_to_event(quote, event):
    """Copy a quote's add-on line items onto its event (kept on conversion)."""
    for li in quote.line_items.all():
        BookingLineItem.objects.create(
            event=event, variant=li.variant, category=li.category,
            description=li.description, quantity=li.quantity, unit=li.unit,
            unit_price=li.unit_price, is_taxable=li.is_taxable, sort_order=li.sort_order,
            menu_item=li.menu_item, equipment_item=li.equipment_item, labor_role=li.labor_role,
        )


class QuoteListCreateView(generics.ListCreateAPIView):
    serializer_class = QuoteSerializer

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return QuoteListSerializer
        return QuoteSerializer

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user, organisation=get_request_org(self.request))

    def get_queryset(self):
        # select_related covers every FK the (list & detail) serializer reads:
        # product_name -> product, created_by_name -> created_by, plus the rest.
        # Without product/created_by the list view did 2×N extra queries.
        qs = Quote.objects.select_related(
            'account', 'venue', 'lead', 'event', 'based_on_template',
            'primary_contact', 'product', 'created_by',
        # food_total sums additional_meals, so the list serializer needs them
        # prefetched (one query, not per-row) to avoid an N+1.
        ).prefetch_related('additional_meals')
        # Only prefetch heavy relations for detail views
        if self.request.method != 'GET' or self.kwargs.get('pk'):
            qs = qs.prefetch_related('line_items', 'dishes')
        qs = apply_org_filter(qs, self.request)

        # Salesperson sees only quotes they created or linked to their leads
        user = self.request.user
        if is_salesperson(user):
            qs = qs.filter(Q(lead__assigned_to=user) | Q(created_by=user))

        quote_status = self.request.query_params.get('status')
        if quote_status:
            qs = qs.filter(status=quote_status)
        return qs


class QuoteDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuoteSerializer

    def get_queryset(self):
        qs = Quote.objects.select_related(
            'account', 'venue', 'lead', 'event', 'based_on_template',
            'primary_contact', 'product', 'created_by',
        ).prefetch_related('line_items', 'dishes')
        return apply_org_filter(qs, self.request)

    def perform_update(self, serializer):
        serializer.save()


class QuoteTransitionView(APIView):
    """POST /api/bookings/quotes/<pk>/transition/ {status: "sent"}"""

    def post(self, request, pk):
        quote = get_org_object_or_404(
            Quote.objects.select_related('account', 'lead', 'based_on_template', 'primary_contact', 'venue').prefetch_related('dishes'),
            request, pk=pk,
        )
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
            user = request.user if request.user.is_authenticated else None
            who = quote.account.name if quote.account_id else (
                quote.primary_contact.name if quote.primary_contact_id else 'Event')
            event_name = f"{who} — {quote.event_type}"
            guest_count = quote.guest_count
            event = Event.objects.create(
                name=event_name,
                date=quote.event_date,
                gents=guest_count // 2,
                ladies=guest_count - (guest_count // 2),
                account=quote.account,
                is_b2b=quote.is_b2b,
                primary_contact=quote.primary_contact,
                venue=quote.venue,
                venue_address=quote.venue_address,
                event_type=quote.event_type,
                meal_type=quote.meal_type,
                service_style=quote.service_style,
                booking_date=quote.accepted_at.date() if quote.accepted_at else None,
                price_per_head=quote.price_per_head,
                tax_rate=quote.tax_rate or 0,
                is_taxable=bool(quote.tax_rate and quote.tax_rate > 0),
                status='confirmed',
                based_on_template=quote.based_on_template,
                created_by=user,
                organisation=quote.organisation,
            )
            # Copy menu (dishes) from quote to event
            if quote.dishes.exists():
                event.dishes.set(quote.dishes.all())

                # Auto-calculate portions for kitchen
                from calculator.engine.calculator import calculate_portions
                from events.models import EventDishComment
                result = calculate_portions(
                    dish_ids=list(event.dishes.values_list('id', flat=True)),
                    guests={'gents': event.gents, 'ladies': event.ladies},
                    org=quote.organisation,
                )
                for p in result['portions']:
                    EventDishComment.objects.create(
                        event=event,
                        dish_id=p['dish_id'],
                        portion_grams=p['grams_per_person'],
                    )

            # Carry the add-on line items across to the event (previously dropped).
            _copy_line_items_to_event(quote, event)

            # Recompute via the shared engine so the event total matches the
            # quote even when there are no add-on items (food-only quotes).
            event.recalculate_totals()

            quote.event = event
            quote.save(update_fields=['event', 'updated_at'])

            # Auto-win the lead if it exists and isn't already won
            if quote.lead and quote.lead.status != 'won':
                from bookings.activity import log_activity
                old_status = quote.lead.status
                quote.lead.won_event = event
                quote.lead.won_quote = quote
                quote.lead.transition_to('won')
                log_activity(
                    quote.lead, 'status_change',
                    field_name='status', old_value=old_status, new_value='won',
                    description=f"Auto-marked as Won via quote acceptance (Quote #{quote.id})",
                )

        # Re-fetch with all relations for serializer
        quote = get_org_object_or_404(
            Quote.objects.select_related('account', 'venue', 'lead', 'event', 'based_on_template', 'primary_contact').prefetch_related('line_items', 'dishes'),
            request, pk=pk,
        )
        return Response(QuoteSerializer(quote).data)


class QuoteLineItemListCreateView(generics.ListCreateAPIView):
    serializer_class = QuoteLineItemSerializer

    def _get_org_filtered_qs(self):
        qs = BookingLineItem.objects.filter(
            quote_id=self.kwargs['quote_pk']
        ).select_related('quote', 'menu_item', 'equipment_item', 'labor_role')
        org = get_request_org(self.request)
        if org is not None:
            qs = qs.filter(quote__organisation=org)
        return qs

    def get_queryset(self):
        return self._get_org_filtered_qs()

    def perform_create(self, serializer):
        quote = get_org_object_or_404(Quote, self.request, pk=self.kwargs['quote_pk'])
        serializer.save(quote=quote)


class QuoteLineItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuoteLineItemSerializer

    def get_queryset(self):
        qs = BookingLineItem.objects.filter(
            quote_id=self.kwargs['quote_pk']
        ).select_related('quote', 'menu_item', 'equipment_item', 'labor_role')
        org = get_request_org(self.request)
        if org is not None:
            qs = qs.filter(quote__organisation=org)
        return qs

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        instance.delete()


class QuotePDFView(APIView):
    """GET /api/bookings/quotes/<pk>/pdf/ — Download quote as PDF"""

    def get(self, request, pk):
        quote = get_org_object_or_404(
            Quote.objects.select_related(
                'account', 'venue', 'primary_contact', 'based_on_template',
                'created_by', 'created_by__organisation',
                'lead', 'lead__assigned_to', 'lead__assigned_to__organisation',
            ).prefetch_related('line_items', 'dishes'),
            request, pk=pk,
        )
        pdf_bytes = generate_quote_pdf(quote)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="Quote-{quote.pk}-v{quote.version}.pdf"'
        return response
