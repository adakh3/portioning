from rest_framework import serializers

from .models import Subscription, Plan


class SubscriptionSerializer(serializers.ModelSerializer):
    """Read-only view of the org's billing state for the frontend to gate on.

    Deliberately omits raw Stripe ids the client doesn't need — exposes status,
    plan, and period info plus the derived ``has_access`` flag.
    """
    has_access = serializers.BooleanField(read_only=True)
    is_trialing = serializers.BooleanField(read_only=True)
    trial_days_remaining = serializers.IntegerField(read_only=True)
    has_billing_account = serializers.BooleanField(read_only=True)

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
            'has_billing_account',
            'comped',
        ]
        read_only_fields = fields


class PlanSerializer(serializers.ModelSerializer):
    """A subscription tier priced for a specific region (passed in context as
    ``region``). ``display_amount`` / ``currency`` are None when the tier has no
    price in that region — the view filters those out."""
    display_amount = serializers.SerializerMethodField()
    currency = serializers.SerializerMethodField()
    currency_symbol = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = ['code', 'name', 'description', 'display_amount', 'currency', 'currency_symbol']

    def _price(self, obj):
        return obj.price_for_region(self.context.get('region'))

    def get_display_amount(self, obj):
        price = self._price(obj)
        return str(price.display_amount) if price else None

    def get_currency(self, obj):
        region = self.context.get('region')
        return region.currency_code if (region and self._price(obj)) else None

    def get_currency_symbol(self, obj):
        region = self.context.get('region')
        return region.currency_symbol if (region and self._price(obj)) else None
