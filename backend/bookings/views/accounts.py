from rest_framework import generics

from bookings.models import Account, Contact
from bookings.serializers import AccountSerializer, ContactSerializer


class AccountListCreateView(generics.ListCreateAPIView):
    queryset = Account.objects.prefetch_related('contacts').all()
    serializer_class = AccountSerializer


class AccountDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Account.objects.prefetch_related('contacts').all()
    serializer_class = AccountSerializer


class ContactListCreateView(generics.ListCreateAPIView):
    serializer_class = ContactSerializer

    def get_queryset(self):
        return Contact.objects.filter(
            account_id=self.kwargs['account_pk']
        ).select_related('account')

    def perform_create(self, serializer):
        serializer.save(account_id=self.kwargs['account_pk'])


class ContactDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ContactSerializer

    def get_queryset(self):
        return Contact.objects.filter(
            account_id=self.kwargs['account_pk']
        ).select_related('account')
