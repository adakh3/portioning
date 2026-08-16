from django.urls import path
from . import views

urlpatterns = [
    path('menus/', views.MenuTemplateListView.as_view(), name='menu-list'),
    path('menus/manage/', views.MenuTemplateManageListCreateView.as_view(), name='menu-manage-list'),
    path('menus/manage/<int:pk>/', views.MenuTemplateManageDetailView.as_view(), name='menu-manage-detail'),
    path('menus/<int:pk>/', views.MenuTemplateDetailView.as_view(), name='menu-detail'),
    path('menus/<int:pk>/preview/', views.MenuTemplatePreviewView.as_view(), name='menu-preview'),
    path('menus/<int:pk>/price-check/', views.MenuPriceCheckView.as_view(), name='menu-price-check'),
]
