from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response

from bookings.activity import log_activity
from bookings.models import Lead
from bookings.models.reminders import Reminder
from bookings.serializers.reminders import ReminderSerializer
from users.mixins import get_request_org, is_superuser_without_org, get_org_object_or_404


class ReminderListCreateView(generics.ListCreateAPIView):
    """GET /api/bookings/reminders/ — list reminders (filterable).
       POST /api/bookings/reminders/ — create a reminder."""
    serializer_class = ReminderSerializer

    def get_queryset(self):
        qs = Reminder.objects.select_related('lead', 'user', 'created_by').all()
        if not is_superuser_without_org(self.request):
            org = get_request_org(self.request)
            if org is not None:
                qs = qs.filter(lead__organisation=org)
        params = self.request.query_params

        # Default to current user
        user_filter = params.get('user')
        if user_filter == 'me' or not user_filter:
            if self.request.user.is_authenticated:
                qs = qs.filter(user=self.request.user)
        elif user_filter:
            qs = qs.filter(user_id=user_filter)

        status_filter = params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        due_before = params.get('due_before')
        if due_before:
            qs = qs.filter(due_at__lte=due_before)

        due_after = params.get('due_after')
        if due_after:
            qs = qs.filter(due_at__gte=due_after)

        lead_filter = params.get('lead')
        if lead_filter:
            qs = qs.filter(lead_id=lead_filter)

        return qs

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user)


class ReminderDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/bookings/reminders/<pk>/"""
    serializer_class = ReminderSerializer

    def get_queryset(self):
        qs = Reminder.objects.select_related('lead', 'user', 'created_by').all()
        if not is_superuser_without_org(self.request):
            org = get_request_org(self.request)
            if org is not None:
                qs = qs.filter(lead__organisation=org)
        return qs

    def perform_update(self, serializer):
        reminder = self.get_object()
        new_status = serializer.validated_data.get('status')
        user = self.request.user if self.request.user.is_authenticated else None

        # Handle snooze: update due_at to snoozed_until
        if new_status == 'snoozed':
            snoozed_until = serializer.validated_data.get('snoozed_until')
            if snoozed_until:
                serializer.validated_data['due_at'] = snoozed_until

        # Handle done: set completed_at, log activity on lead
        if new_status == 'done' and reminder.status != 'done':
            serializer.validated_data['completed_at'] = timezone.now()
            log_activity(
                reminder.lead, 'status_change', user=user,
                description=f"Completed follow-up reminder: {reminder.note[:100]}" if reminder.note else "Completed follow-up reminder",
            )

        serializer.save()


class LeadReminderListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/bookings/leads/<pk>/reminders/"""
    serializer_class = ReminderSerializer

    def get_queryset(self):
        # Validate lead belongs to user's org
        get_org_object_or_404(Lead, self.request, pk=self.kwargs['pk'])
        return Reminder.objects.select_related(
            'lead', 'user', 'created_by',
        ).filter(lead_id=self.kwargs['pk'])

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        lead = get_org_object_or_404(Lead, self.request, pk=self.kwargs['pk'])
        serializer.save(
            lead=lead,
            created_by=user,
            user=serializer.validated_data.get('user') or user,
        )


class ReminderCountsView(generics.GenericAPIView):
    """GET /api/bookings/reminders/counts/ — overdue + due-today counts."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({'overdue': 0, 'due_today': 0})

        now = timezone.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timezone.timedelta(days=1)

        base = Reminder.objects.filter(user=request.user, status='pending')
        if not is_superuser_without_org(request):
            org = get_request_org(request)
            if org is not None:
                base = base.filter(lead__organisation=org)
        overdue = base.filter(due_at__lt=now).count()
        due_today = base.filter(due_at__gte=now, due_at__lt=today_end).count()

        return Response({'overdue': overdue, 'due_today': due_today})
