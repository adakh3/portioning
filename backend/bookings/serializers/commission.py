from rest_framework import serializers

from bookings.models import CommissionPlan, CommissionBand


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
