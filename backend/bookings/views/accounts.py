from rest_framework import generics

from bookings.models import Account, Contact
from bookings.serializers import AccountSerializer, ContactSerializer
from users.mixins import OrgQuerySetMixin, OrgCreateMixin, apply_org_filter


class AccountListCreateView(OrgQuerySetMixin, OrgCreateMixin, generics.ListCreateAPIView):
    queryset = Account.objects.prefetch_related('contacts').all()
    serializer_class = AccountSerializer


class AccountDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Account.objects.prefetch_related('contacts').all()
    serializer_class = AccountSerializer


class ContactListCreateView(generics.ListCreateAPIView):
    serializer_class = ContactSerializer

    def get_queryset(self):
        qs = Contact.objects.filter(
            account_id=self.kwargs['account_pk']
        ).select_related('account')
        return apply_org_filter(Account.objects.all(), self.request).filter(
            pk=self.kwargs['account_pk']
        ).exists() and qs or qs.none()

    def perform_create(self, serializer):
        from users.mixins import get_org_object_or_404
        # Validate account belongs to user's org
        get_org_object_or_404(Account, self.request, pk=self.kwargs['account_pk'])
        serializer.save(account_id=self.kwargs['account_pk'])


class ContactDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ContactSerializer

    def get_queryset(self):
        qs = Contact.objects.filter(
            account_id=self.kwargs['account_pk']
        ).select_related('account')
        return apply_org_filter(Account.objects.all(), self.request).filter(
            pk=self.kwargs['account_pk']
        ).exists() and qs or qs.none()
