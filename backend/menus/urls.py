from django.urls import path
from . import views

urlpatterns = [
    path('menus/', views.MenuTemplateListView.as_view(), name='menu-list'),
    path('menus/<int:pk>/', views.MenuTemplateDetailView.as_view(), name='menu-detail'),
    path('menus/<int:pk>/preview/', views.MenuTemplatePreviewView.as_view(), name='menu-preview'),
]
