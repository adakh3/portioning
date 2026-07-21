from rest_framework import serializers

from .models import LaborRole, StaffMember, Shift, AllocationRule
from users.serializer_mixins import OrgScopedModelSerializer


class LaborRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = LaborRole
        fields = ['id', 'name', 'default_hourly_rate', 'description', 'color', 'sort_order', 'is_active', 'created_at']
        read_only_fields = ['created_at']
        extra_kwargs = {'description': {'max_length': 2000}}


class StaffMemberSerializer(serializers.ModelSerializer):
    role_names = serializers.SerializerMethodField()
    # The display name is composed from first/last on save; forms send parts.
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate(self, attrs):
        if self.instance is None and not (attrs.get('name') or attrs.get('first_name')):
            raise serializers.ValidationError({'first_name': 'First name is required.'})
        return attrs

    class Meta:
        model = StaffMember
        fields = [
            'id', 'name', 'first_name', 'last_name', 'email', 'phone', 'roles', 'role_names',
            'hourly_rate', 'certifications',
            'emergency_contact', 'emergency_phone',
            'is_active', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            'certifications': {'max_length': 2000},
            'notes': {'max_length': 5000},
        }

    def get_role_names(self, obj):
        # Read the prefetched `roles` cache (the list view prefetch_relateds it);
        # .values_list() would bypass that cache and query per staff member.
        return [r.name for r in obj.roles.all()]


class ShiftSerializer(OrgScopedModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.name', read_only=True, default=None)
    role_name = serializers.CharField(source='role.name', read_only=True)
    duration_hours = serializers.SerializerMethodField()
    shift_cost = serializers.SerializerMethodField()

    class Meta:
        model = Shift
        fields = [
            'id', 'event', 'staff_member', 'staff_member_name',
            'role', 'role_name',
            'start_time', 'end_time', 'break_minutes',
            'hourly_rate', 'status', 'notes',
            'duration_hours', 'shift_cost', 'created_at',
        ]
        read_only_fields = ['created_at']
        extra_kwargs = {'notes': {'max_length': 5000}}

    def get_duration_hours(self, obj):
        try:
            return str(obj.duration_hours)
        except Exception:
            return None

    def get_shift_cost(self, obj):
        try:
            return str(obj.shift_cost)
        except Exception:
            return None


class AllocationRuleSerializer(OrgScopedModelSerializer):
    role_name = serializers.CharField(source='role.name', read_only=True)

    class Meta:
        model = AllocationRule
        fields = ['id', 'role', 'role_name', 'event_type', 'guests_per_staff', 'minimum_staff', 'is_active', 'created_at']
        read_only_fields = ['created_at']
