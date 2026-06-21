from rest_framework import generics

from users.mixins import OrgQuerySetMixin
from bookings.models import AddOnProduct
from bookings.serializers import AddOnProductSerializer


class AddOnProductListView(OrgQuerySetMixin, generics.ListAPIView):
    """GET /api/bookings/addon-products/ — the org's add-on catalog (active
    products with their active variants). Managed in Django admin for now."""
    serializer_class = AddOnProductSerializer
    queryset = AddOnProduct.objects.filter(is_active=True).prefetch_related('variants')
