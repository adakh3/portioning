from rest_framework import generics

from bookings.models import Invoice, Payment
from bookings.serializers import InvoiceSerializer, PaymentSerializer


class InvoiceListCreateView(generics.ListCreateAPIView):
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        qs = Invoice.objects.prefetch_related('payments').select_related('event').all()
        event_id = self.request.query_params.get('event')
        if event_id:
            qs = qs.filter(event_id=event_id)
        invoice_status = self.request.query_params.get('status')
        if invoice_status:
            qs = qs.filter(status=invoice_status)
        return qs


class InvoiceDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Invoice.objects.prefetch_related('payments').select_related('event').all()
    serializer_class = InvoiceSerializer


class PaymentListCreateView(generics.ListCreateAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        return Payment.objects.filter(
            invoice_id=self.kwargs['invoice_pk']
        ).select_related('invoice')

    def perform_create(self, serializer):
        serializer.save(invoice_id=self.kwargs['invoice_pk'])


class PaymentDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        return Payment.objects.filter(
            invoice_id=self.kwargs['invoice_pk']
        ).select_related('invoice')
