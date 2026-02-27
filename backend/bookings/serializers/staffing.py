from rest_framework import serializers

from bookings.models import LaborRole, StaffMember, Shift


class LaborRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = LaborRole
        fields = ['id', 'name', 'default_hourly_rate', 'description', 'is_active', 'created_at']
        read_only_fields = ['created_at']


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

    def get_role_names(self, obj):
        return list(obj.roles.values_list('name', flat=True))


class ShiftSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.name', read_only=True, default=None)
    role_name = serializers.CharField(source='role.name', read_only=True)
    duration_hours = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    shift_cost = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

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
