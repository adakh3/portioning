from django.core.exceptions import ValidationError
from django.db.models.signals import m2m_changed, post_save, pre_save
from django.dispatch import receiver

from users.models import Organisation, User
from users.model_mixins import model_is_org_scoped


@receiver(post_save, sender=Organisation)
def create_org_defaults(sender, instance, created, **kwargs):
    """Auto-create OrgSettings and workflow choice options for new orgs."""
    if not created:
        return

    from bookings.models.settings import OrgSettings
    from users.country_defaults import defaults_for_country
    from bookings.default_terms import DEFAULT_QUOTATION_TERMS
    # Currency/tax/timezone default to the org's country (USD fallback), not the
    # model's hardcoded UK defaults; a starter T&C template so the quote/sign page
    # isn't blank on day one. Owner can change all of these in Settings later.
    OrgSettings.objects.get_or_create(
        organisation=instance,
        defaults={
            **defaults_for_country(instance.country),
            'quotation_terms': DEFAULT_QUOTATION_TERMS,
        },
    )

    from bookings.models import CommissionPlan
    CommissionPlan.objects.get_or_create(
        organisation=instance, is_default=True, defaults={'name': 'Default'},
    )

    from bookings.models.choices import LeadStatusOption, LostReasonOption

    # Lead statuses carry colour + semantic flags (default/won/lost stage).
    LEAD_STATUS_DEFAULTS = [
        # value, label, sort_order, color, is_default, is_won, is_lost
        ('new', 'New', 0, 'blue', True, False, False),
        ('contacted', 'Contacted', 1, 'amber', False, False, False),
        ('qualified', 'Qualified', 2, 'cyan', False, False, False),
        ('proposal_sent', 'Proposal Sent', 3, 'violet', False, False, False),
        ('won', 'Won', 4, 'green', False, True, False),
        ('lost', 'Lost', 5, 'gray', False, False, True),
    ]
    for value, label, sort_order, color, is_default, is_won, is_lost in LEAD_STATUS_DEFAULTS:
        LeadStatusOption.objects.get_or_create(
            organisation=instance,
            value=value,
            defaults={
                'label': label, 'sort_order': sort_order, 'color': color,
                'is_default': is_default, 'is_won': is_won, 'is_lost': is_lost,
            },
        )

    LOST_REASON_DEFAULTS = [
        ('too_expensive', 'Too expensive', 0),
        ('competitor', 'Went with competitor', 1),
        ('date_unavailable', 'Date unavailable', 2),
        ('no_response', 'No response', 3),
        ('budget_cut', 'Budget cut', 4),
        ('changed_plans', 'Changed plans', 5),
        ('other', 'Other', 6),
    ]
    for value, label, sort_order in LOST_REASON_DEFAULTS:
        LostReasonOption.objects.get_or_create(
            organisation=instance,
            value=value,
            defaults={'label': label, 'sort_order': sort_order},
        )

    # Non-workflow dropdowns (event types, sources, service styles, meal
    # types) get sensible US-mainstream starters so the org's forms aren't
    # empty on day one. All editable/removable in Settings.
    from bookings.defaults import seed_choice_defaults
    seed_choice_defaults(instance)

    # Auto-onboard the org with a starter catalog (dishes, menus, add-ons, labor
    # roles, equipment, rules) so its forms aren't empty on day one. Guarded by a
    # setting (off under the test runner). Best-effort: a seeding hiccup must never
    # block org creation, so it's caught and logged.
    from django.conf import settings as django_settings
    if getattr(django_settings, 'SEED_STARTER_CATALOG_ON_ORG_CREATE', False):
        try:
            from dishes.management.commands.seed_starter_catalog import Command as SeedCatalog
            SeedCatalog().seed(instance)
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "Starter-catalog auto-seed failed for org %s", instance.pk)


@receiver(m2m_changed)
def block_cross_org_m2m(sender, instance, action, reverse, model, pk_set, **kwargs):
    """Block linking an org-scoped object to a row in another organisation.

    The model layer (``OrgScopedModel.save``) cannot see M2M additions — they
    happen after save, through a join table. This receiver is the data-layer
    backstop for those: on ``pre_add``, every row being linked must share the
    owning object's organisation. Fires for both the forward and reverse side,
    whichever holds the ``organisation`` column. Defense-in-depth partner to the
    serializer layer, which scopes writable M2M querysets at the API boundary.
    """
    if action != 'pre_add' or not pk_set:
        return
    org_id = getattr(instance, 'organisation_id', None)
    if org_id is None or not model_is_org_scoped(model):
        return
    if (
        model._base_manager.filter(pk__in=pk_set)
        .exclude(organisation_id=org_id)
        .exists()
    ):
        raise ValidationError(
            f'Cannot link {model.__name__} from a different organisation.'
        )


# ── Credential changes end existing sessions (REL-486) ──
#
# Placed on the model rather than in UserManageSerializer so it holds for every
# path that can change a credential: the admin/owner user-management API, the
# Django admin's "Set / reset password" field, a management command, the shell.
# The scenario that matters is the ordinary one — "this employee is leaving,
# reset their password" — where the account is expected to be locked out now,
# not in seven days.

_CREDENTIAL_FIELDS = frozenset({'password', 'is_active'})


@receiver(pre_save, sender=User)
def flag_credential_change(sender, instance, raw=False, update_fields=None, **kwargs):
    """Record whether this save changes a credential, before the row is written.

    Reading the old row has to happen in pre_save; acting on it waits for
    post_save, so a save that fails never revokes a working session.
    """
    instance._revoke_tokens_on_save = False
    if raw or instance.pk is None:
        return
    if update_fields is not None and not _CREDENTIAL_FIELDS & set(update_fields):
        # Notably every login, which writes only last_login — no query needed.
        return
    previous = (
        sender._base_manager.filter(pk=instance.pk)
        .values('password', 'is_active').first()
    )
    if previous is None:
        return
    instance._revoke_tokens_on_save = (
        previous['password'] != instance.password
        or (previous['is_active'] and not instance.is_active)
    )


@receiver(post_save, sender=User)
def revoke_tokens_on_credential_change(sender, instance, created, **kwargs):
    if created or not getattr(instance, '_revoke_tokens_on_save', False):
        return
    instance._revoke_tokens_on_save = False
    from users.tokens import revoke_user_tokens
    revoked = revoke_user_tokens(instance)
    if revoked:
        import logging
        logging.getLogger('tenant.audit').info(
            "Revoked %s outstanding token(s) for user %s (pk=%s) after a "
            "credential change", revoked, instance.email, instance.pk,
        )
