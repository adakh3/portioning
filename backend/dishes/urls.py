from django.urls import path
from . import views

urlpatterns = [
    path('dishes/', views.DishListView.as_view(), name='dish-list'),
    path('categories/', views.CategoryListView.as_view(), name='category-list'),
]
