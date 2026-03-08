from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Q, Avg, Sum, F
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Lead
from bookings.models.activity import ActivityLog
from bookings.models.choices import LeadStatusOption
from bookings.models import Reminder
from bookings.permissions import IsManagerOrOwner


class DashboardStatsView(APIView):
    """GET /api/bookings/dashboard/stats/?period=today|week|month"""
    permission_classes = [IsManagerOrOwner]

    def get(self, request):
        period = request.query_params.get('period', 'today')
        now = timezone.now()

        if period == 'week':
            since = now - timedelta(days=7)
        elif period == 'month':
            since = now - timedelta(days=30)
        else:  # today
            since = now.replace(hour=0, minute=0, second=0, microsecond=0)

        ct = ContentType.objects.get_for_model(Lead)

        # Activity logs in period
        period_logs = ActivityLog.objects.filter(
            content_type=ct,
            created_at__gte=since,
        )

        # Lead summary
        new_leads = period_logs.filter(action='created').count()
        status_transitions = period_logs.filter(action='status_change').count()
        won = period_logs.filter(action='status_change', new_value='won').count()
        lost = period_logs.filter(action='status_change', new_value='lost').count()
        total_active = Lead.objects.exclude(status__in=['won', 'lost']).count()

        # Team activity — per user (period-scoped from activity logs)
        team_raw = (
            period_logs
            .filter(user__isnull=False)
            .values('user__id', 'user__first_name', 'user__last_name', 'user__email')
            .annotate(
                leads_created=Count('id', filter=Q(action='created')),
                transitions_made=Count('id', filter=Q(action='status_change')),
                won=Count('id', filter=Q(action='status_change', new_value='won')),
                lost=Count('id', filter=Q(action='status_change', new_value='lost')),
            )
            .order_by('-leads_created')
        )
        team_activity = []
        for row in team_raw:
            name = f"{row['user__first_name']} {row['user__last_name']}".strip() or row['user__email']
            team_activity.append({
                'user_id': row['user__id'],
                'user_name': name,
                'leads_created': row['leads_created'],
                'transitions_made': row['transitions_made'],
                'won': row['won'],
                'lost': row['lost'],
            })

        # KPIs
        conversion_rate = 0
        if new_leads > 0:
            conversion_rate = round(won / new_leads * 100, 1)

        converted_lead_ids = list(
            period_logs.filter(action='status_change', new_value='won')
            .values_list('object_id', flat=True)
        )
        avg_days = None
        if converted_lead_ids:
            result = (
                Lead.objects.filter(id__in=converted_lead_ids, won_at__isnull=False)
                .annotate(days=F('won_at') - F('created_at'))
                .aggregate(avg_days=Avg('days'))
            )
            if result['avg_days']:
                avg_days = round(result['avg_days'].total_seconds() / 86400, 1)

        pipeline = Lead.objects.exclude(status__in=['won', 'lost']).aggregate(
            pipeline_value=Sum('budget'),
            pipeline_count=Count('id'),
        )

        # ── Salesperson performance ──
        # All statuses in DB order
        statuses = list(
            LeadStatusOption.objects.filter(is_active=True)
            .order_by('sort_order')
            .values_list('value', 'label')
        )
        status_values = [s[0] for s in statuses]
        status_labels = {s[0]: s[1] for s in statuses}

        # Current pipeline per assigned_to (snapshot — not period-filtered)
        pipeline_qs = (
            Lead.objects
            .filter(assigned_to__isnull=False)
            .values(
                'assigned_to__id',
                'assigned_to__first_name',
                'assigned_to__last_name',
                'assigned_to__email',
                'status',
            )
            .annotate(count=Count('id'), value=Sum('budget'))
            .order_by('assigned_to__first_name', 'assigned_to__last_name')
        )

        # Period activity per assigned user (won/lost in the period)
        period_won_by_user = dict(
            period_logs
            .filter(action='status_change', new_value='won', user__isnull=False)
            .values_list('user__id')
            .annotate(c=Count('id'))
            .values_list('user__id', 'c')
        )
        period_lost_by_user = dict(
            period_logs
            .filter(action='status_change', new_value='lost', user__isnull=False)
            .values_list('user__id')
            .annotate(c=Count('id'))
            .values_list('user__id', 'c')
        )
        period_created_by_user = dict(
            period_logs
            .filter(action='created', user__isnull=False)
            .values_list('user__id')
            .annotate(c=Count('id'))
            .values_list('user__id', 'c')
        )

        # Overdue reminders per assigned user
        overdue_by_user = dict(
            Reminder.objects.filter(
                status='pending',
                due_at__lt=now,
                lead__assigned_to__isnull=False,
            )
            .values_list('lead__assigned_to')
            .annotate(c=Count('id'))
            .values_list('lead__assigned_to', 'c')
        )

        # Stale leads per assigned user (no activity in 7+ days, still active)
        stale_cutoff = now - timedelta(days=7)
        stale_by_user = dict(
            Lead.objects.filter(
                assigned_to__isnull=False,
                updated_at__lt=stale_cutoff,
            )
            .exclude(status__in=['won', 'lost'])
            .values_list('assigned_to')
            .annotate(c=Count('id'))
            .values_list('assigned_to', 'c')
        )

        # Build per-salesperson data
        sp_map = {}
        for row in pipeline_qs:
            uid = row['assigned_to__id']
            if uid not in sp_map:
                name = (
                    f"{row['assigned_to__first_name']} {row['assigned_to__last_name']}".strip()
                    or row['assigned_to__email']
                )
                sp_map[uid] = {
                    'user_id': uid,
                    'user_name': name,
                    'pipeline': {sv: 0 for sv in status_values},
                    'pipeline_value': 0,
                    'total_assigned': 0,
                    'period_created': period_created_by_user.get(uid, 0),
                    'period_won': period_won_by_user.get(uid, 0),
                    'period_lost': period_lost_by_user.get(uid, 0),
                    'overdue_reminders': overdue_by_user.get(uid, 0),
                    'stale_leads': stale_by_user.get(uid, 0),
                }
            sp = sp_map[uid]
            st = row['status']
            if st in sp['pipeline']:
                sp['pipeline'][st] = row['count']
            sp['total_assigned'] += row['count']
            sp['pipeline_value'] += float(row['value'] or 0)

        # Also include users who have period activity but no currently-assigned leads
        all_period_users = set(period_won_by_user) | set(period_lost_by_user) | set(period_created_by_user)
        for uid in all_period_users - set(sp_map):
            from users.models import User
            try:
                u = User.objects.get(pk=uid)
                name = f"{u.first_name} {u.last_name}".strip() or u.email
            except User.DoesNotExist:
                continue
            sp_map[uid] = {
                'user_id': uid,
                'user_name': name,
                'pipeline': {sv: 0 for sv in status_values},
                'pipeline_value': 0,
                'total_assigned': 0,
                'period_created': period_created_by_user.get(uid, 0),
                'period_won': period_won_by_user.get(uid, 0),
                'period_lost': period_lost_by_user.get(uid, 0),
                'overdue_reminders': overdue_by_user.get(uid, 0),
                'stale_leads': stale_by_user.get(uid, 0),
            }

        # Unassigned leads row
        unassigned_qs = (
            Lead.objects
            .filter(assigned_to__isnull=True)
            .values('status')
            .annotate(count=Count('id'), value=Sum('budget'))
        )
        unassigned_pipeline = {sv: 0 for sv in status_values}
        unassigned_total = 0
        unassigned_value = 0
        for row in unassigned_qs:
            st = row['status']
            if st in unassigned_pipeline:
                unassigned_pipeline[st] = row['count']
            unassigned_total += row['count']
            unassigned_value += float(row['value'] or 0)

        unassigned_stale = (
            Lead.objects.filter(
                assigned_to__isnull=True,
                updated_at__lt=stale_cutoff,
            )
            .exclude(status__in=['won', 'lost'])
            .count()
        )
        unassigned_overdue = Reminder.objects.filter(
            status='pending',
            due_at__lt=now,
            lead__assigned_to__isnull=True,
        ).count()

        unassigned_row = {
            'user_id': None,
            'user_name': 'Unassigned',
            'pipeline': unassigned_pipeline,
            'pipeline_value': unassigned_value,
            'total_assigned': unassigned_total,
            'period_created': 0,
            'period_won': 0,
            'period_lost': 0,
            'overdue_reminders': unassigned_overdue,
            'stale_leads': unassigned_stale,
        }

        salesperson_performance = sorted(sp_map.values(), key=lambda x: x['total_assigned'], reverse=True)
        if unassigned_total > 0:
            salesperson_performance.append(unassigned_row)

        # ── Status distribution: all leads grouped by status ──
        status_distribution_qs = (
            Lead.objects
            .values('status')
            .annotate(count=Count('id'))
        )
        status_dist_map = {row['status']: row['count'] for row in status_distribution_qs}
        status_distribution = [
            {'status': v, 'label': status_labels[v], 'count': status_dist_map.get(v, 0)}
            for v in status_values
        ]

        return Response({
            'lead_summary': {
                'new_leads': new_leads,
                'status_transitions': status_transitions,
                'won': won,
                'lost': lost,
                'total_active': total_active,
            },
            'team_activity': team_activity,
            'salesperson_performance': salesperson_performance,
            'status_columns': [{'value': v, 'label': status_labels[v]} for v in status_values],
            'status_distribution': status_distribution,
            'kpis': {
                'conversion_rate': conversion_rate,
                'avg_days_to_convert': avg_days,
                'pipeline_value': str(pipeline['pipeline_value'] or 0),
                'pipeline_count': pipeline['pipeline_count'],
            },
        })
