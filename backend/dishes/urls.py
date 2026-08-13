from django.urls import path
from . import views

urlpatterns = [
    path('dishes/', views.DishListView.as_view(), name='dish-list'),
    path('dishes/manage/', views.DishManageListCreateView.as_view(), name='dish-manage-list'),
    path('dishes/manage/<int:pk>/', views.DishManageDetailView.as_view(), name='dish-manage-detail'),
    path('categories/', views.CategoryListView.as_view(), name='category-list'),
    path('dietary-tags/', views.DietaryTagListView.as_view(), name='dietary-tag-list'),
]
