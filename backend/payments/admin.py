from django.conf import settings
from django.contrib import admin

from .models import Subscription


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('organisation', 'status', 'plan_name', 'trial_ends_at',
                    'trial_days_remaining', 'current_period_end',
                    'cancel_at_period_end')
    list_filter = ('status', 'cancel_at_period_end')
    search_fields = ('organisation__name', 'stripe_customer_id',
                     'stripe_subscription_id')
    # Stripe is the source of truth; these are mirrored read-only locally.
    # ``trial_ends_at`` stays editable so staff can extend a trial by hand.
    readonly_fields = ('stripe_customer_id', 'stripe_subscription_id',
                       'stripe_price_id', 'trial_days_remaining',
                       'created_at', 'updated_at')
    actions = ('extend_trial_default',)

    @admin.display(description='Trial days left')
    def trial_days_remaining(self, obj):
        return obj.trial_days_remaining

    @admin.action(description='Extend free trial by default length')
    def extend_trial_default(self, request, queryset):
        for sub in queryset:
            sub.extend_trial(settings.DEFAULT_TRIAL_DAYS)
            sub.save()
        self.message_user(
            request,
            f'Extended {queryset.count()} trial(s) by {settings.DEFAULT_TRIAL_DAYS} days.',
        )
