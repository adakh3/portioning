from django.contrib import admin

from .models import EquipmentItem, EquipmentReservation


@admin.register(EquipmentItem)
class EquipmentItemAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'stock_quantity', 'rental_price', 'is_active']
    list_filter = ['category', 'is_active']
    search_fields = ['name']


@admin.register(EquipmentReservation)
class EquipmentReservationAdmin(admin.ModelAdmin):
    list_display = ['event', 'equipment', 'quantity_out', 'quantity_returned', 'return_condition']
    list_filter = ['return_condition']
    search_fields = ['event__name', 'equipment__name']
