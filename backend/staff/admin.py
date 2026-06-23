from django.contrib import admin

from users.admin_mixins import OrgVisibleAdminMixin
from .models import LaborRole, StaffMember, Shift, AllocationRule


@admin.register(LaborRole)
class LaborRoleAdmin(OrgVisibleAdminMixin, admin.ModelAdmin):
    list_display = ['name', 'default_hourly_rate', 'color', 'sort_order', 'is_active']
    list_filter = ['is_active']
    list_editable = ['sort_order']


@admin.register(StaffMember)
class StaffMemberAdmin(OrgVisibleAdminMixin, admin.ModelAdmin):
    list_display = ['name', 'email', 'phone', 'is_active']
    list_filter = ['is_active', 'roles']
    search_fields = ['name', 'email']
    filter_horizontal = ['roles']


@admin.register(Shift)
class ShiftAdmin(OrgVisibleAdminMixin, admin.ModelAdmin):
    org_field = 'event__organisation'
    list_display = ['event', 'role', 'staff_member', 'start_time', 'end_time', 'status']
    list_filter = ['status', 'role']
    search_fields = ['event__name', 'staff_member__name']


@admin.register(AllocationRule)
class AllocationRuleAdmin(OrgVisibleAdminMixin, admin.ModelAdmin):
    org_field = 'role__organisation'
    list_display = ['role', 'event_type', 'guests_per_staff', 'minimum_staff', 'is_active']
    list_filter = ['is_active', 'role']
