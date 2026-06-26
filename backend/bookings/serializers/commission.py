from rest_framework import serializers

from bookings.models import CommissionPlan, CommissionBand, SalesTarget


class CommissionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommissionPlan
        fields = ['id', 'name', 'commission_model', 'commission_flat_rate', 'is_default']
        read_only_fields = ['id', 'is_default']


class CommissionBandSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommissionBand
        fields = ['id', 'plan', 'min_attainment_pct', 'rate']
        read_only_fields = ['id']


class SalesTargetSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = SalesTarget
        fields = ['id', 'user', 'user_name', 'plan', 'amount']
        read_only_fields = ['id']

    def get_user_name(self, obj):
        u = obj.user
        return f"{u.first_name} {u.last_name}".strip() if u else None
