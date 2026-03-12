from rest_framework import generics

from bookings.models import Venue
from bookings.serializers import VenueSerializer
from users.mixins import OrgQuerySetMixin, OrgCreateMixin


class VenueListCreateView(OrgQuerySetMixin, OrgCreateMixin, generics.ListCreateAPIView):
    queryset = Venue.objects.all()
    serializer_class = VenueSerializer


class VenueDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Venue.objects.all()
    serializer_class = VenueSerializer
