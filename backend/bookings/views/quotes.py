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
from bookings.services.quote_acceptance import accept_quote
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


def _copy_additional_meals_to_event(quote, event):
    """Copy a quote's additional meals (menus, prices, portions) onto its event."""
    from events.models import BookingMeal, BookingMealDishComment
    for meal in quote.additional_meals.all():
        copy = BookingMeal.objects.create(
            event=event, label=meal.label, guest_count=meal.guest_count,
            price_per_head=meal.price_per_head, based_on_template=meal.based_on_template,
            meal_time=meal.meal_time, notes=meal.notes,
        )
        copy.dishes.set(meal.dishes.all())
        for dc in meal.dish_comments.all():
            BookingMealDishComment.objects.create(
                meal=copy, dish=dc.dish, comment=dc.comment, portion_grams=dc.portion_grams,
            )


class QuoteListCreateView(generics.ListCreateAPIView):
    serializer_class = QuoteSerializer

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return QuoteListSerializer
        return QuoteSerializer

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        org = get_request_org(self.request)
        from bookings.models import ProductLine
        product = serializer.validated_data.get('product') or ProductLine.default_for(org)
        # Owner defaults to the linked lead's salesperson, else whoever created it —
        # so a quote always has an owner for commission attribution (see conversion).
        assigned = serializer.validated_data.get('assigned_to')
        if assigned is None:
            lead = serializer.validated_data.get('lead')
            assigned = (lead.assigned_to if lead else None) or user
        serializer.save(created_by=user, organisation=org, product=product, assigned_to=assigned)

    def get_queryset(self):
        # select_related covers every FK the (list & detail) serializer reads:
        # product_name -> product, created_by_name -> created_by, plus the rest.
        # Without product/created_by the list view did 2×N extra queries.
        qs = Quote.objects.select_related(
            'account', 'venue', 'lead', 'event', 'based_on_template',
            'primary_contact', 'product', 'created_by', 'assigned_to',
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
            qs = qs.filter(Q(assigned_to=user) | Q(lead__assigned_to=user) | Q(created_by=user))

        quote_status = self.request.query_params.get('status')
        if quote_status:
            qs = qs.filter(status=quote_status)
        return qs


class QuoteDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = QuoteSerializer

    def get_queryset(self):
        qs = Quote.objects.select_related(
            'account', 'venue', 'lead', 'event', 'based_on_template',
            'primary_contact', 'product', 'created_by', 'assigned_to',
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
        user = request.user if request.user.is_authenticated else None
        try:
            # Accepting a quote also creates the confirmed event + wins the lead;
            # that shared logic lives in accept_quote (used by the client-facing
            # e-sign flow too). Other transitions are a plain status change.
            if new_status == QuoteStatus.ACCEPTED:
                accept_quote(quote, user=user)
            else:
                quote.transition_to(new_status)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

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
        # Once the client has signed, the staff copy shows the acceptance block too.
        sig = quote.event.latest_signature if quote.event_id else None
        pdf_bytes = generate_quote_pdf(quote, signature=sig)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="Quote-{quote.pk}-v{quote.version}.pdf"'
        return response

class QuoteMarkSharedWhatsAppView(APIView):
    """POST /api/bookings/quotes/<pk>/mark-shared-whatsapp/ — the rep shared
    this quotation via a WhatsApp shortcut (own device, PDF attached by hand).
    Confirming makes the record match reality: a draft quote flips to sent,
    the share is logged on the quote AND its lead (the AI reads the lead's
    activity), and the greeting lands in the lead's message thread."""

    def post(self, request, pk):
        from django.utils import timezone as tz
        from bookings.activity import log_activity
        from bookings.models import WhatsAppMessage

        quote = get_org_object_or_404(Quote, request, pk=pk)
        user = request.user if request.user.is_authenticated else None

        if quote.status == QuoteStatus.DRAFT:
            quote.status = QuoteStatus.SENT
            quote.save(update_fields=['status', 'updated_at'])

        log_activity(
            quote, 'updated', user=user,
            field_name='whatsapp',
            description='Quotation shared via WhatsApp (from own device)',
        )
        if quote.lead_id:
            log_activity(
                quote.lead, 'updated', user=user,
                field_name='whatsapp',
                description=f'Quotation #{quote.pk} shared via WhatsApp (from own device)',
            )
            body = request.data.get('body') or f'Quotation #{quote.pk} shared.'
            WhatsAppMessage.objects.create(
                organisation=quote.organisation,
                lead=quote.lead,
                to_phone=f'whatsapp:{quote.lead.contact_phone}',
                from_phone='manual',
                body=body,
                direction='outbound',
                status='sent',
                sent_by=user,
            )
        return Response(QuoteSerializer(quote).data)
