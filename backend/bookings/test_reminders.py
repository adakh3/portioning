"""Follow-up reminder visibility + assignment tests.

Covers the role-aware scoping of the reminders list/counts (salespeople see only
their own; admins/owners see the whole team and can filter by person) and the
rule that a new follow-up is assigned to the lead's owner, not whoever added it.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import Lead
from bookings.models.reminders import Reminder
from bookings.tests import _make_org
from users.models import User


class ReminderScopeTests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.owner = User.objects.create(
            email="owner@rem.test", first_name="Ow", last_name="Ner",
            role="owner", organisation=self.org,
        )
        self.admin = User.objects.create(
            email="admin@rem.test", first_name="Ad", last_name="Min",
            role="admin", organisation=self.org,
        )
        self.rep_a = User.objects.create(
            email="repa@rem.test", first_name="Rep", last_name="A",
            role="salesperson", organisation=self.org,
        )
        self.rep_b = User.objects.create(
            email="repb@rem.test", first_name="Rep", last_name="B",
            role="salesperson", organisation=self.org,
        )
        self.lead_a = Lead.objects.create(
            organisation=self.org, contact_name="Cust A", assigned_to=self.rep_a, status="new",
        )
        self.lead_b = Lead.objects.create(
            organisation=self.org, contact_name="Cust B", assigned_to=self.rep_b, status="new",
        )
        now = timezone.now()
        self.rem_a = Reminder.objects.create(
            lead=self.lead_a, user=self.rep_a, due_at=now, status="pending",
        )
        self.rem_b = Reminder.objects.create(
            lead=self.lead_b, user=self.rep_b, due_at=now, status="pending",
        )
        self.client = APIClient()

    LIST_URL = "/api/bookings/reminders/?status=pending&page_size=all"

    def _ids(self, res):
        return {r["id"] for r in res.data}

    def test_salesperson_sees_only_their_own(self):
        self.client.force_authenticate(user=self.rep_a)
        res = self.client.get(self.LIST_URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._ids(res), {self.rem_a.id})

    def test_admin_sees_whole_team_by_default(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.get(self.LIST_URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._ids(res), {self.rem_a.id, self.rem_b.id})

    def test_owner_sees_whole_team_by_default(self):
        self.client.force_authenticate(user=self.owner)
        res = self.client.get(self.LIST_URL)
        self.assertEqual(self._ids(res), {self.rem_a.id, self.rem_b.id})

    def test_admin_can_filter_by_person(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.get(f"{self.LIST_URL}&user={self.rep_b.id}")
        self.assertEqual(self._ids(res), {self.rem_b.id})

    def test_admin_user_me_filters_to_self(self):
        self.client.force_authenticate(user=self.admin)
        # Admin has no reminders of their own.
        res = self.client.get(f"{self.LIST_URL}&user=me")
        self.assertEqual(self._ids(res), set())

    def test_salesperson_cannot_widen_scope_via_user_param(self):
        # Even asking for another rep, a salesperson still only gets their own.
        self.client.force_authenticate(user=self.rep_a)
        res = self.client.get(f"{self.LIST_URL}&user={self.rep_b.id}")
        self.assertEqual(self._ids(res), {self.rem_a.id})

    def test_counts_scope_matches_list(self):
        now = timezone.now()
        # Rep A's own is comfortably in the future; rep B's is overdue.
        Reminder.objects.filter(id=self.rem_a.id).update(due_at=now + timezone.timedelta(days=2))
        Reminder.objects.filter(id=self.rem_b.id).update(due_at=now - timezone.timedelta(days=1))

        self.client.force_authenticate(user=self.rep_a)
        rep_counts = self.client.get("/api/bookings/reminders/counts/").data
        self.assertEqual(rep_counts["overdue"], 0)  # rep A's own isn't overdue

        self.client.force_authenticate(user=self.admin)
        admin_counts = self.client.get("/api/bookings/reminders/counts/").data
        self.assertEqual(admin_counts["overdue"], 1)  # sees rep B's overdue one


class ReminderAssignmentTests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.admin = User.objects.create(
            email="admin2@rem.test", first_name="Ad", last_name="Min",
            role="admin", organisation=self.org,
        )
        self.rep = User.objects.create(
            email="rep@rem.test", first_name="Rep", last_name="X",
            role="salesperson", organisation=self.org,
        )
        self.client = APIClient()

    def test_followup_assigned_to_lead_assignee_not_creator(self):
        lead = Lead.objects.create(
            organisation=self.org, contact_name="Cust", assigned_to=self.rep, status="new",
        )
        # Admin adds the follow-up, but it should belong to the lead's rep.
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            f"/api/bookings/leads/{lead.id}/reminders/",
            {"due_at": timezone.now().isoformat(), "note": "Call back"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        reminder = Reminder.objects.get(id=res.data["id"])
        self.assertEqual(reminder.user_id, self.rep.id)
        self.assertEqual(reminder.created_by_id, self.admin.id)

    def test_followup_falls_back_to_lead_creator_when_unassigned(self):
        lead = Lead.objects.create(
            organisation=self.org, contact_name="Cust", assigned_to=None,
            created_by=self.rep, status="new",
        )
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            f"/api/bookings/leads/{lead.id}/reminders/",
            {"due_at": timezone.now().isoformat(), "note": "Call"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        reminder = Reminder.objects.get(id=res.data["id"])
        self.assertEqual(reminder.user_id, self.rep.id)


class ReminderReassignMigrationTests(TestCase):
    """The 0058 data migration realigns outstanding reminders to the lead owner."""

    def _run_migration(self):
        import importlib
        from django.apps import apps as django_apps
        mod = importlib.import_module(
            'bookings.migrations.0058_reassign_reminders_to_lead_owner'
        )
        mod.reassign_to_lead_owner(django_apps, None)

    def test_outstanding_move_to_owner_history_untouched(self):
        org = _make_org()
        rep = User.objects.create(
            email="rep@mig.test", first_name="Rep", last_name="Owner",
            role="salesperson", organisation=org,
        )
        admin = User.objects.create(
            email="admin@mig.test", first_name="Ad", last_name="Min",
            role="admin", organisation=org,
        )
        lead = Lead.objects.create(
            organisation=org, contact_name="Cust", assigned_to=rep, status="new",
        )
        now = timezone.now()
        # Historical bad state: admin scheduled these, so they're stuck on the admin.
        pending = Reminder.objects.create(lead=lead, user=admin, due_at=now, status="pending")
        snoozed = Reminder.objects.create(lead=lead, user=admin, due_at=now, status="snoozed")
        done = Reminder.objects.create(lead=lead, user=admin, due_at=now, status="done")

        self._run_migration()

        pending.refresh_from_db()
        snoozed.refresh_from_db()
        done.refresh_from_db()
        self.assertEqual(pending.user_id, rep.id)   # realigned to the lead's rep
        self.assertEqual(snoozed.user_id, rep.id)   # realigned
        self.assertEqual(done.user_id, admin.id)    # historical — left untouched

    def test_falls_back_to_lead_creator_when_unassigned(self):
        org = _make_org()
        rep = User.objects.create(
            email="creator@mig.test", first_name="Cre", last_name="Ator",
            role="salesperson", organisation=org,
        )
        admin = User.objects.create(
            email="admin3@mig.test", first_name="Ad", last_name="Min",
            role="admin", organisation=org,
        )
        lead = Lead.objects.create(
            organisation=org, contact_name="Cust", assigned_to=None,
            created_by=rep, status="new",
        )
        rem = Reminder.objects.create(
            lead=lead, user=admin, due_at=timezone.now(), status="pending",
        )
        self._run_migration()
        rem.refresh_from_db()
        self.assertEqual(rem.user_id, rep.id)
