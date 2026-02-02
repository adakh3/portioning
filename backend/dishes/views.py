from rest_framework import generics
from .models import Dish, DishCategory
from .serializers import DishSerializer, DishCategorySerializer


class DishListView(generics.ListAPIView):
    queryset = Dish.objects.filter(is_active=True).select_related('category')
    serializer_class = DishSerializer


class CategoryListView(generics.ListAPIView):
    queryset = DishCategory.objects.all()
    serializer_class = DishCategorySerializer
