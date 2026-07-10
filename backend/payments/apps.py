from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    name = 'payments'
    verbose_name = 'Billing & Subscriptions'

    def ready(self):
        import payments.signals  # noqa: F401
