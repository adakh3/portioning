from rest_framework import generics
from rest_framework.exceptions import ValidationError

from bookings.models import Invoice, Payment
from bookings.serializers import InvoiceSerializer, PaymentSerializer
from events.models import Event
from users.mixins import get_request_org, is_superuser_without_org


def _apply_event_org_filter(qs, request):
    """Filter a queryset that reaches org through event__organisation."""
    if is_superuser_without_org(request):
        return qs
    org = get_request_org(request)
    if org is not None:
        return qs.filter(event__organisation=org)
    return qs.none()


class InvoiceListCreateView(generics.ListCreateAPIView):
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        qs = Invoice.objects.prefetch_related('payments').select_related('event').all()
        qs = _apply_event_org_filter(qs, self.request)
        event_id = self.request.query_params.get('event')
        if event_id:
            qs = qs.filter(event_id=event_id)
        invoice_status = self.request.query_params.get('status')
        if invoice_status:
            qs = qs.filter(status=invoice_status)
        return qs

    def perform_create(self, serializer):
        event = serializer.validated_data.get('event')
        org = get_request_org(self.request)
        if event and org and event.organisation_id != org.id:
            raise ValidationError({'event': 'Event does not belong to your organisation.'})


class InvoiceDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        return _apply_event_org_filter(
            Invoice.objects.prefetch_related('payments').select_related('event').all(),
            self.request,
        )


class PaymentListCreateView(generics.ListCreateAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        qs = Payment.objects.filter(
            invoice_id=self.kwargs['invoice_pk']
        ).select_related('invoice')
        if not is_superuser_without_org(self.request):
            org = get_request_org(self.request)
            if org is not None:
                qs = qs.filter(invoice__event__organisation=org)
        return qs

    def perform_create(self, serializer):
        invoice_pk = self.kwargs['invoice_pk']
        org = get_request_org(self.request)
        if org:
            if not Invoice.objects.filter(pk=invoice_pk, event__organisation=org).exists():
                raise ValidationError({'invoice': 'Invoice does not belong to your organisation.'})
        serializer.save(invoice_id=invoice_pk)


class PaymentDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        qs = Payment.objects.filter(
            invoice_id=self.kwargs['invoice_pk']
        ).select_related('invoice')
        if not is_superuser_without_org(self.request):
            org = get_request_org(self.request)
            if org is not None:
                qs = qs.filter(invoice__event__organisation=org)
        return qs
