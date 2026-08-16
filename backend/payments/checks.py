"""Deploy-time checks for the Stripe credentials (REL-484).

The gateway already fails closed at call time, which is the guarantee that
matters: an unset secret can never be used to verify anything. These checks are
the earlier, cheaper warning — ``manage.py check --deploy`` surfaces a missing
credential before it reaches a running environment, instead of the first real
webhook doing it.

Registered as checks rather than an ``ImproperlyConfigured`` at settings load
because settings are imported by every test run, management command and the
migration job. A hard raise there would make an environment without Stripe keys
unbootable for work that has nothing to do with billing; a deploy check is silent
until you ask for it, and CI/deploy asks for it.
"""
from django.conf import settings
from django.core.checks import Error, Tags, register

# id → the consequence of leaving it unset, in the message the operator reads.
_REQUIRED = {
    'STRIPE_WEBHOOK_SECRET': (
        'payments.E001',
        'Stripe webhook signatures cannot be verified. Stripe\'s '
        'construct_event() does not reject an empty secret — it HMACs with it — '
        'so anyone able to reach /api/billing/webhook/ could forge a valid '
        'signature and grant themselves a paid subscription.',
    ),
    'STRIPE_SECRET_KEY': (
        'payments.E002',
        'No Stripe API calls can be made: checkout, the billing portal and '
        'customer creation will all fail.',
    ),
}


@register(Tags.security, deploy=True)
def check_stripe_credentials(app_configs, **kwargs):
    errors = []
    for name, (check_id, consequence) in _REQUIRED.items():
        if not (getattr(settings, name, '') or '').strip():
            errors.append(Error(
                f'{name} is not set.',
                hint=consequence,
                id=check_id,
            ))
    return errors
