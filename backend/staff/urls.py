from django.urls import path

from .views import (
    LaborRoleListCreateView, LaborRoleDetailView,
    StaffMemberListCreateView, StaffMemberDetailView,
    ShiftListCreateView, ShiftDetailView,
    AllocationRuleListCreateView, AllocationRuleDetailView,
    StaffReportView,
)

urlpatterns = [
    path('staff/labor-roles/', LaborRoleListCreateView.as_view(), name='labor-role-list'),
    path('staff/labor-roles/<int:pk>/', LaborRoleDetailView.as_view(), name='labor-role-detail'),
    path('staff/members/', StaffMemberListCreateView.as_view(), name='staff-list'),
    path('staff/members/<int:pk>/', StaffMemberDetailView.as_view(), name='staff-detail'),
    path('staff/shifts/', ShiftListCreateView.as_view(), name='shift-list'),
    path('staff/shifts/<int:pk>/', ShiftDetailView.as_view(), name='shift-detail'),
    path('staff/allocation-rules/', AllocationRuleListCreateView.as_view(), name='allocation-rule-list'),
    path('staff/allocation-rules/<int:pk>/', AllocationRuleDetailView.as_view(), name='allocation-rule-detail'),
    path('staff/reports/', StaffReportView.as_view(), name='staff-report'),
]
