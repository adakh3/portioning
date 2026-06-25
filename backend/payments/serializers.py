from rest_framework import serializers

from .models import Subscription


class SubscriptionSerializer(serializers.ModelSerializer):
    """Read-only view of the org's billing state for the frontend to gate on.

    Deliberately omits raw Stripe ids the client doesn't need — exposes status,
    plan, and period info plus the derived ``has_access`` flag.
    """
    has_access = serializers.BooleanField(read_only=True)
    is_trialing = serializers.BooleanField(read_only=True)
    trial_days_remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            'status',
            'plan_name',
            'current_period_end',
            'cancel_at_period_end',
            'trial_ends_at',
            'is_trialing',
            'trial_days_remaining',
            'has_access',
        ]
        read_only_fields = fields
