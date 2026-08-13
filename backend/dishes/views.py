from django.db.models.deletion import ProtectedError
from rest_framework import generics, serializers as drf_serializers
from rest_framework.permissions import IsAuthenticated

from users.mixins import OrgQuerySetMixin, get_request_org
from bookings.permissions import IsAdminOrOwner
from .models import DietaryTag, Dish, DishCategory
from .serializers import (
    DietaryTagSerializer, DishSerializer, DishCategorySerializer, DishManageSerializer,
)


class DishListView(OrgQuerySetMixin, generics.ListAPIView):
    # prefetch the tags — DishSerializer nests them, so without this the list is
    # one extra query per dish.
    queryset = (Dish.objects.filter(is_active=True)
                .select_related('category').prefetch_related('dietary_tags'))
    serializer_class = DishSerializer


class CategoryListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = DishCategory.objects.all()
    serializer_class = DishCategorySerializer


class DishManageListCreateView(OrgQuerySetMixin, generics.ListCreateAPIView):
    """Manage the dish catalog from Settings (owner/admin). Lists ALL dishes
    (incl. inactive) so they can be edited/reactivated."""
    queryset = (Dish.objects.all()
                .select_related('category').prefetch_related('dietary_tags')
                .order_by('category__display_order', 'name'))
    serializer_class = DishManageSerializer
    permission_classes = [IsAdminOrOwner]

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))


class DishManageDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = (Dish.objects.all()
                .select_related('category').prefetch_related('dietary_tags'))
    serializer_class = DishManageSerializer
    permission_classes = [IsAdminOrOwner]

    def perform_destroy(self, instance):
        # Dish.delete() PROTECTs against removing a dish that's on a booking; turn
        # that into a friendly 400 pointing the user at "deactivate instead".
        try:
            instance.delete()
        except ProtectedError as e:
            message = str(e.args[0]) if e.args else 'This dish is in use and cannot be deleted.'
            raise drf_serializers.ValidationError(message)


class DietaryTagListView(generics.ListAPIView):
    """The global dietary/allergen vocabulary (not org-scoped) — populates the
    dish editor's tag picker."""
    queryset = DietaryTag.objects.all()
    serializer_class = DietaryTagSerializer
    permission_classes = [IsAuthenticated]
