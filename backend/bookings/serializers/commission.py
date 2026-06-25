from rest_framework import serializers

from bookings.models import CommissionBand, SalesTarget


class CommissionBandSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommissionBand
        fields = ['id', 'min_attainment_pct', 'rate']
        read_only_fields = ['id']


class SalesTargetSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = SalesTarget
        fields = ['id', 'user', 'user_name', 'amount']
        read_only_fields = ['id']

    def get_user_name(self, obj):
        u = obj.user
        return f"{u.first_name} {u.last_name}".strip() if u else None
