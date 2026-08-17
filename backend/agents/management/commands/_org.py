"""Shared org resolver for the agent management commands."""
from django.core.management.base import CommandError

from users.models import Organisation


def resolve_org(value):
    org = Organisation.objects.filter(pk=value).first() if str(value).isdigit() else None
    if org is None:
        org = Organisation.objects.filter(slug=value).first() or Organisation.objects.filter(name=value).first()
    if org is None:
        raise CommandError(f"No organisation matching {value!r}")
    return org
