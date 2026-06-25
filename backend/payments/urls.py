from django.urls import path

from . import views

urlpatterns = [
    path('billing/subscription/', views.SubscriptionStatusView.as_view(),
         name='subscription-status'),
    path('billing/checkout/', views.CheckoutSessionView.as_view(),
         name='billing-checkout'),
    path('billing/portal/', views.BillingPortalView.as_view(),
         name='billing-portal'),
    path('billing/extend-trial/<int:org_id>/', views.ExtendTrialView.as_view(),
         name='extend-trial'),
    path('billing/webhook/', views.StripeWebhookView.as_view(),
         name='stripe-webhook'),
]
