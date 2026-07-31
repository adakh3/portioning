from rest_framework import generics
from users.mixins import OrgQuerySetMixin
from .models import Dish, DishCategory
from .serializers import DishSerializer, DishCategorySerializer


class DishListView(OrgQuerySetMixin, generics.ListAPIView):
    # prefetch the tags — DishSerializer nests them, so without this the list is
    # one extra query per dish.
    queryset = (Dish.objects.filter(is_active=True)
                .select_related('category').prefetch_related('dietary_tags'))
    serializer_class = DishSerializer


class CategoryListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = DishCategory.objects.all()
    serializer_class = DishCategorySerializer
