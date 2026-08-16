from rest_framework import generics

from users.mixins import OrgQuerySetMixin, get_request_org
from bookings.models import AddOnProduct
from bookings.permissions import IsAdminOrOwner
from bookings.serializers import AddOnProductSerializer, AddOnProductManageSerializer


class AddOnProductListView(OrgQuerySetMixin, generics.ListAPIView):
    """GET /api/bookings/addon-products/ — the org's add-on catalog (active
    products with their active variants). Feeds the quote/event add-on pickers."""
    serializer_class = AddOnProductSerializer
    queryset = AddOnProduct.objects.filter(is_active=True).prefetch_related('variants')


class AddOnProductManageListCreateView(OrgQuerySetMixin, generics.ListCreateAPIView):
    """Manage the add-on catalog from Settings (owner/admin). Lists ALL products
    (incl. inactive) with ALL their variants so they can be edited/reactivated."""
    serializer_class = AddOnProductManageSerializer
    permission_classes = [IsAdminOrOwner]
    queryset = AddOnProduct.objects.all().order_by('sort_order', 'name').prefetch_related('variants')

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))


class AddOnProductManageDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AddOnProductManageSerializer
    permission_classes = [IsAdminOrOwner]
    queryset = AddOnProduct.objects.all().prefetch_related('variants')
