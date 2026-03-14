from rest_framework import generics

from bookings.models import Customer
from bookings.serializers import CustomerSerializer
from users.mixins import OrgQuerySetMixin, OrgCreateMixin


class CustomerListCreateView(OrgQuerySetMixin, OrgCreateMixin, generics.ListCreateAPIView):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer


class CustomerDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
