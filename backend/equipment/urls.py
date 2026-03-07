from django.urls import path

from .views import (
    EquipmentItemListCreateView, EquipmentItemDetailView,
    EquipmentReservationListCreateView, EquipmentReservationDetailView,
)

urlpatterns = [
    path('equipment/items/', EquipmentItemListCreateView.as_view(), name='equipment-list'),
    path('equipment/items/<int:pk>/', EquipmentItemDetailView.as_view(), name='equipment-detail'),
    path('equipment/reservations/', EquipmentReservationListCreateView.as_view(), name='equipment-reservation-list'),
    path('equipment/reservations/<int:pk>/', EquipmentReservationDetailView.as_view(), name='equipment-reservation-detail'),
]
