from rest_framework import serializers

from .models import LaborRole, StaffMember, Shift, AllocationRule


class LaborRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = LaborRole
        fields = ['id', 'name', 'default_hourly_rate', 'description', 'color', 'sort_order', 'is_active', 'created_at']
        read_only_fields = ['created_at']
        extra_kwargs = {'description': {'max_length': 2000}}


class StaffMemberSerializer(serializers.ModelSerializer):
    role_names = serializers.SerializerMethodField()

    class Meta:
        model = StaffMember
        fields = [
            'id', 'name', 'email', 'phone', 'roles', 'role_names',
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
        return list(obj.roles.values_list('name', flat=True))


class ShiftSerializer(serializers.ModelSerializer):
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


class AllocationRuleSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source='role.name', read_only=True)

    class Meta:
        model = AllocationRule
        fields = ['id', 'role', 'role_name', 'event_type', 'guests_per_staff', 'minimum_staff', 'is_active', 'created_at']
        read_only_fields = ['created_at']
