from rest_framework import generics
from users.mixins import OrgQuerySetMixin
from .models import Dish, DishCategory
from .serializers import DishSerializer, DishCategorySerializer


class DishListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = Dish.objects.filter(is_active=True).select_related('category')
    serializer_class = DishSerializer


class CategoryListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = DishCategory.objects.all()
    serializer_class = DishCategorySerializer
