"""Merge the duplicate choice options existing orgs inherited from two seeders.

Until REL-435, `dishes.seed_starter_catalog` and `bookings.defaults` BOTH seeded
non-workflow choice options on the `Organisation` post_save, using different
slugs for the same label. Every org created in that window carries duplicate
rows — "Family Style" twice, "Drop-off / Delivery" twice, "Holiday Party" twice
— storing DIFFERENT values, so one real-world choice is split across two slugs
for filtering and reporting.

The seeding bug itself is fixed (the catalog seeder no longer touches choice
options). This repairs the rows already out there, and the bookings pointing at
them.

Deliberately a command rather than a data migration:

* CLAUDE.md: `bookings/defaults.py` is the single source of truth for these
  options and no data migration should bulk-touch them — `seed_org_choices` is
  the established shape for a retrofit like this.
* It rewrites REAL booking rows. That should be something the owner runs and
  reads the output of, not something a deploy does silently.

Dry run by default; nothing is written without `--apply`.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count

from bookings.models.choices import EventTypeOption, ServiceStyleOption
from bookings.models.leads import Lead
from bookings.models.quotes import Quote
from events.models import Event
from staff.models import AllocationRule
from users.models import Organisation


# Which option table backs each slug column.
CHOICE_MODELS = {
    'service_style': ServiceStyleOption,
    'event_type': EventTypeOption,
}

# (choice type, legacy slug seeded by the old catalog, canonical slug owned by
# defaults.py). Derived by diffing the two seeders at the commit that removed the
# overlap (2a64e1e): these are every pair that shares a label but not a value.
# Options only one seeder ever had ("Private Dinner", "Walk-in", "Hors
# d'oeuvres") are NOT duplicates — they are real options an org may be using, and
# are untouched.
DUPLICATE_PAIRS = [
    ('service_style', 'family_style', 'family'),
    ('service_style', 'drop_off', 'dropoff'),
    ('event_type', 'holiday', 'holiday_party'),
]

# Every *live* column storing one of these slugs. A miss here would strand a
# booking on a value whose option row has just been deleted, so this list is the
# crux of the command — `event_type` also reaches the staffing rules, not just
# bookings.
#
# Deliberately excluded: `bookings.ActivityLog.old_value` / `new_value`, which
# also hold these slugs (both fields are tracked — see `bookings/activity.py`).
# That is an append-only record of what actually happened at the time, so
# rewriting it would falsify history rather than repair data.
REFERENCES = {
    'service_style': [
        (Quote, 'service_style'),
        (Event, 'service_style'),
        (Lead, 'service_style'),
    ],
    'event_type': [
        (Quote, 'event_type'),
        (Event, 'event_type'),
        (Lead, 'event_type'),
        (AllocationRule, 'event_type'),
    ],
}


def _same_label(a, b):
    """Labels equal ignoring case and surrounding space.

    The guard that stops this being destructive: two rows are only duplicates
    while they still SAY the same thing. An org that renamed one of them made a
    deliberate distinction, and merging would silently destroy it.
    """
    return a.strip().casefold() == b.strip().casefold()


class Command(BaseCommand):
    help = (
        "Merge duplicate choice options (Family Style x2, Drop-off x2, Holiday "
        "Party x2) that orgs inherited from the old double-seeding, repointing "
        "any bookings, leads and staffing rules onto the surviving slug. "
        "Idempotent. Dry run unless --apply is passed."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--org", help="Limit to one organisation by id or name (default: all).",
        )
        parser.add_argument(
            "--apply", action="store_true",
            help="Actually write the changes. Without this the command only reports.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        orgs = (
            [self._resolve_org(options["org"])] if options["org"]
            else list(Organisation.objects.order_by("name"))
        )

        self.stdout.write(
            self.style.WARNING("DRY RUN — nothing will be written. Re-run with --apply to commit.")
            if not apply else
            self.style.WARNING("APPLYING — rows will be rewritten and duplicate options deleted.")
        )

        merged = repointed = 0
        # One transaction for the whole run: a partial merge would leave bookings
        # pointing at a slug whose option row is already gone.
        with transaction.atomic():
            for org in orgs:
                self.stdout.write(f"\n{org.name}")
                org_merged, org_repointed = self._merge_org(org, apply)
                merged += org_merged
                repointed += org_repointed
                self._report_other_duplicates(org)
                self._report_stranded(org)
            if not apply:
                transaction.set_rollback(True)

        self.stdout.write("")
        summary = f"{merged} duplicate option(s) merged, {repointed} row(s) repointed."
        self.stdout.write(
            self.style.SUCCESS(f"Done — {summary}") if apply
            else self.style.WARNING(f"Would merge: {summary}  (nothing written)")
        )

    def _merge_org(self, org, apply):
        merged = repointed = 0
        for choice_type, legacy_value, canonical_value in DUPLICATE_PAIRS:
            Model = CHOICE_MODELS[choice_type]
            legacy = Model.objects.for_org(org).filter(value=legacy_value).first()
            canonical = Model.objects.for_org(org).filter(value=canonical_value).first()

            if legacy is None:
                continue  # already merged, or this org never had the legacy row

            # The org has ONLY the legacy slug — it isn't a duplicate, it's their
            # option. Renaming it to a slug they never used would be a silent
            # rewrite of working data for no benefit.
            if canonical is None:
                self.stdout.write(
                    f"  · {choice_type}: only {legacy_value!r} present — left alone (not a duplicate)"
                )
                continue

            if not _same_label(legacy.label, canonical.label):
                self.stdout.write(self.style.WARNING(
                    f"  ! {choice_type}: {legacy_value!r} ({legacy.label!r}) and "
                    f"{canonical_value!r} ({canonical.label!r}) no longer share a label — "
                    f"left alone, looks like a deliberate edit"
                ))
                continue

            counts = []
            for RefModel, field in REFERENCES[choice_type]:
                qs = RefModel.objects.for_org(org).filter(**{field: legacy_value})
                n = qs.count()
                if n:
                    if apply:
                        qs.update(**{field: canonical_value})
                    counts.append(f"{RefModel.__name__}.{field}={n}")
                    repointed += n

            if apply:
                # Keep the option visible if either row was: an org that hid one
                # copy and kept using the other must not lose the option.
                if legacy.is_active and not canonical.is_active:
                    canonical.is_active = True
                # Sit where the earlier of the two sat, so the surviving entry
                # doesn't appear to jump down the list. (Only affects service
                # styles in practice — event types are listed by label.)
                canonical.sort_order = min(legacy.sort_order, canonical.sort_order)
                canonical.save(update_fields=["is_active", "sort_order"])
                legacy.delete()
                self._warn_duplicate_allocation_rules(org, choice_type, canonical_value)

            merged += 1
            detail = f" — repointed {', '.join(counts)}" if counts else " — no rows referenced it"
            self.stdout.write(
                f"  ✓ {choice_type}: {legacy_value!r} → {canonical_value!r} "
                f"({canonical.label!r}){detail}"
            )
        return merged, repointed

    def _warn_duplicate_allocation_rules(self, org, choice_type, value):
        """A merge can leave two staffing rules for the same role + event type.

        `AllocationRule` has no uniqueness on (role, event_type), so an org with
        a "Holiday Party" rule under each slug ends up with both pointing at the
        same one. Merging them automatically would be guessing at staffing
        numbers, so this only says so.
        """
        if choice_type != 'event_type':
            return
        dupes = (
            AllocationRule.objects.for_org(org).filter(event_type=value)
            .values('role_id', 'role__name').annotate(n=Count('id')).filter(n__gt=1)
        )
        for d in dupes:
            self.stdout.write(self.style.WARNING(
                f"    ! {d['role__name']!r} now has {d['n']} staffing rules for "
                f"{value!r} — review them, they were separate before the merge"
            ))

    def _report_other_duplicates(self, org):
        """Read-only warning about same-label duplicates outside the known pairs.

        Never merged automatically — an unknown pair could be two options an org
        meant to keep. Surfacing them is useful; guessing at them is not.
        """
        known = {legacy for _, legacy, _ in DUPLICATE_PAIRS}
        for choice_type, Model in CHOICE_MODELS.items():
            seen = {}
            for row in Model.objects.for_org(org):
                if row.value in known:
                    continue
                seen.setdefault(row.label.strip().casefold(), []).append(row.value)
            for label, values in seen.items():
                if len(values) > 1:
                    self.stdout.write(self.style.WARNING(
                        f"  ? {choice_type}: {label!r} still appears under "
                        f"{sorted(values)} — not a known pair, left alone"
                    ))

    def _report_stranded(self, org):
        """Rows pointing at a slug with no option row behind it.

        Read-only, and the reason it exists: an org can delete a choice option
        itself (the manage endpoints have no in-use guard), which strands every
        booking already on it. Those rows are invisible to the merge — there is
        no duplicate left to key off — so without this the command prints
        nothing for that org and "0 merged" reads as "clean".

        Not repaired automatically: the right target for an unrecognised slug is
        a judgement call about that org's data, not something to guess at.
        """
        for choice_type, Model in CHOICE_MODELS.items():
            known = set(Model.objects.for_org(org).values_list('value', flat=True))
            for RefModel, field in REFERENCES[choice_type]:
                stranded = (
                    RefModel.objects.for_org(org)
                    .exclude(**{field: ''}).exclude(**{f"{field}__in": known})
                    .values(field).annotate(n=Count('id')).order_by(field)
                )
                for row in stranded:
                    self.stdout.write(self.style.WARNING(
                        f"  ! {RefModel.__name__}.{field}: {row['n']} row(s) still on "
                        f"{row[field]!r}, which has no option row — left alone, needs a look"
                    ))

    def _resolve_org(self, value):
        org = Organisation.objects.filter(pk=value).first() if value.isdigit() else None
        if org is not None:
            return org
        # Organisation.name is NOT unique. Picking one silently would rewrite one
        # org's data and quietly leave its namesake broken — refuse and let the
        # caller name the id instead.
        matches = list(Organisation.objects.filter(name=value).order_by('pk'))
        if len(matches) > 1:
            listed = ', '.join(f"{o.pk}={o.name!r}" for o in matches)
            raise CommandError(
                f"{len(matches)} organisations are named {value!r} ({listed}). "
                f"Re-run with --org <id>."
            )
        if not matches:
            raise CommandError(f"No organisation matching {value!r}")
        return matches[0]
