from datetime import datetime, timedelta

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
from users.mixins import get_request_org, apply_org_filter


class MyDashboardStatsView(APIView):
    """GET /api/bookings/dashboard/my-stats/ — personal pipeline for salespeople."""

    def get(self, request):
        org = get_request_org(request)
        my_leads = apply_org_filter(Lead.objects.filter(assigned_to=request.user), request)

        # Status options
        statuses = list(
            apply_org_filter(LeadStatusOption.objects.filter(is_active=True), request)
            .order_by('sort_order')
            .values_list('value', 'label')
        )
        status_values = [s[0] for s in statuses]
        status_labels = {s[0]: s[1] for s in statuses}

        # Pipeline: count per status
        pipeline_qs = (
            my_leads.exclude(status__in=['won', 'lost'])
            .values('status')
            .annotate(count=Count('id'))
        )
        pipeline = {sv: 0 for sv in status_values if sv not in ('won', 'lost')}
        for row in pipeline_qs:
            if row['status'] in pipeline:
                pipeline[row['status']] = row['count']

        # Pipeline value
        agg = my_leads.exclude(status__in=['won', 'lost']).aggregate(
            pipeline_value=Sum('budget'),
            pipeline_count=Count('id'),
        )

        # KPIs
        total_active = agg['pipeline_count']
        won_count = my_leads.filter(status='won').count()
        total_decided = won_count + my_leads.filter(status='lost').count()
        conversion_rate = round(won_count / total_decided * 100, 1) if total_decided > 0 else 0

        avg_days = None
        won_leads = my_leads.filter(status='won', won_at__isnull=False)
        if won_leads.exists():
            result = won_leads.annotate(days=F('won_at') - F('created_at')).aggregate(avg_days=Avg('days'))
            if result['avg_days']:
                avg_days = round(result['avg_days'].total_seconds() / 86400, 1)

        # Status distribution (for bar chart — all statuses including won/lost)
        dist_qs = my_leads.values('status').annotate(count=Count('id'))
        dist_map = {row['status']: row['count'] for row in dist_qs}
        status_distribution = [
            {'status': v, 'label': status_labels[v], 'count': dist_map.get(v, 0)}
            for v in status_values
        ]

        # Unread WhatsApp messages count (leads with at least one unread inbound message)
        from bookings.models import WhatsAppMessage
        unread_whatsapp_leads = WhatsAppMessage.objects.filter(
            organisation=org,
            lead__assigned_to=request.user,
            direction='inbound',
            read_at__isnull=True,
        ).values('lead').distinct().count()

        return Response({
            'pipeline': pipeline,
            'pipeline_value': str(agg['pipeline_value'] or 0),
            'kpis': {
                'conversion_rate': conversion_rate,
                'avg_days_to_convert': avg_days,
                'total_active': total_active,
                'unread_whatsapp_leads': unread_whatsapp_leads,
            },
            'status_columns': [{'value': v, 'label': status_labels[v]} for v in status_values],
            'status_distribution': status_distribution,
        })


class DashboardStatsView(APIView):
    """GET /api/bookings/dashboard/stats/?period=all|today|week|month|custom"""
    permission_classes = [IsManagerOrOwner]

    def get(self, request):
        period = request.query_params.get('period', 'all')
        now = timezone.now()
        until = None

        if period == 'custom':
            date_from = request.query_params.get('date_from')
            date_to = request.query_params.get('date_to')
            since = (
                timezone.make_aware(datetime.strptime(date_from, '%Y-%m-%d'))
                if date_from else None
            )
            until = (
                timezone.make_aware(datetime.strptime(date_to, '%Y-%m-%d')) + timedelta(days=1)
                if date_to else None
            )
        elif period == 'week':
            since = now - timedelta(days=7)
        elif period == 'month':
            since = now - timedelta(days=30)
        elif period == 'today':
            since = now.replace(hour=0, minute=0, second=0, microsecond=0)
        else:  # all
            since = None

        org = get_request_org(request)
        base_leads = apply_org_filter(Lead.objects.all(), request)
        ct = ContentType.objects.get_for_model(Lead)

        # Restrict activity logs to leads in this org
        org_lead_ids = base_leads.values_list('id', flat=True)
        period_logs = ActivityLog.objects.filter(content_type=ct, object_id__in=org_lead_ids)
        if since:
            period_logs = period_logs.filter(created_at__gte=since)
        if until:
            period_logs = period_logs.filter(created_at__lt=until)

        # Lead summary (single aggregate instead of 4 separate counts)
        summary = period_logs.aggregate(
            new_leads=Count('id', filter=Q(action='created')),
            status_transitions=Count('id', filter=Q(action='status_change')),
            won=Count('id', filter=Q(action='status_change', new_value='won')),
            lost=Count('id', filter=Q(action='status_change', new_value='lost')),
        )
        new_leads = summary['new_leads']
        status_transitions = summary['status_transitions']
        won = summary['won']
        lost = summary['lost']
        total_active = base_leads.exclude(status__in=['won', 'lost']).count()

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

        converted_lead_ids = (
            period_logs.filter(action='status_change', new_value='won')
            .values_list('object_id', flat=True)
        )
        avg_days = None
        if converted_lead_ids.exists():
            result = (
                base_leads.filter(id__in=converted_lead_ids, won_at__isnull=False)
                .annotate(days=F('won_at') - F('created_at'))
                .aggregate(avg_days=Avg('days'))
            )
            if result['avg_days']:
                avg_days = round(result['avg_days'].total_seconds() / 86400, 1)

        pipeline = base_leads.exclude(status__in=['won', 'lost']).aggregate(
            pipeline_value=Sum('budget'),
            pipeline_count=Count('id'),
        )

        # ── Salesperson performance ──
        # All statuses in DB order
        statuses = list(
            apply_org_filter(LeadStatusOption.objects.filter(is_active=True), request)
            .order_by('sort_order')
            .values_list('value', 'label')
        )
        status_values = [s[0] for s in statuses]
        status_labels = {s[0]: s[1] for s in statuses}

        # Lead IDs that had any activity in the period (kept as subquery)
        active_lead_ids = (
            period_logs.values_list('object_id', flat=True).distinct()
        ) if since or until else None

        # Pipeline per assigned_to — scoped to leads with activity in period
        lead_qs = base_leads.filter(assigned_to__isnull=False)
        if active_lead_ids is not None:
            lead_qs = lead_qs.filter(id__in=active_lead_ids)
        pipeline_qs = (
            lead_qs
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

        # Overdue reminders per user (assigned + unassigned in one query)
        reminder_base = Reminder.objects.filter(
            status='pending',
            due_at__lt=now,
        )
        if org is not None:
            reminder_base = reminder_base.filter(lead__organisation=org)
        overdue_all = dict(
            reminder_base
            .values_list('lead__assigned_to')
            .annotate(c=Count('id'))
            .values_list('lead__assigned_to', 'c')
        )
        unassigned_overdue = overdue_all.pop(None, 0)
        overdue_by_user = overdue_all

        # Stale leads per user (assigned + unassigned in one query)
        stale_cutoff = now - timedelta(days=7)
        stale_all = dict(
            base_leads.filter(
                updated_at__lt=stale_cutoff,
            )
            .exclude(status__in=['won', 'lost'])
            .values_list('assigned_to')
            .annotate(c=Count('id'))
            .values_list('assigned_to', 'c')
        )
        unassigned_stale = stale_all.pop(None, 0)
        stale_by_user = stale_all

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
                    'overdue_reminders': overdue_by_user.get(uid, 0),
                    'stale_leads': stale_by_user.get(uid, 0),
                }
            sp = sp_map[uid]
            st = row['status']
            if st in sp['pipeline']:
                sp['pipeline'][st] = row['count']
            sp['total_assigned'] += row['count']
            sp['pipeline_value'] += float(row['value'] or 0)

        # Unassigned leads row
        unassigned_lead_qs = base_leads.filter(assigned_to__isnull=True)
        if active_lead_ids is not None:
            unassigned_lead_qs = unassigned_lead_qs.filter(id__in=active_lead_ids)
        unassigned_qs = (
            unassigned_lead_qs
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

        unassigned_row = {
            'user_id': None,
            'user_name': 'Unassigned',
            'pipeline': unassigned_pipeline,
            'pipeline_value': unassigned_value,
            'total_assigned': unassigned_total,
            'overdue_reminders': unassigned_overdue,
            'stale_leads': unassigned_stale,
        }

        salesperson_performance = sorted(sp_map.values(), key=lambda x: x['total_assigned'], reverse=True)
        if unassigned_total > 0:
            salesperson_performance.append(unassigned_row)

        # ── Lost reasons breakdown (period-scoped) ──
        lost_lead_ids = (
            period_logs.filter(action='status_change', new_value='lost')
            .values_list('object_id', flat=True)
        )
        lost_reasons = []
        if lost_lead_ids.exists():
            lost_reason_qs = (
                Lead.objects.filter(id__in=lost_lead_ids)
                .values('lost_reason_option__label')
                .annotate(count=Count('id'))
                .order_by('-count')
            )
            for row in lost_reason_qs:
                lost_reasons.append({
                    'reason': row['lost_reason_option__label'] or 'No reason given',
                    'count': row['count'],
                })

        # ── Status distribution: leads with activity in period, grouped by status ──
        status_dist_lead_qs = base_leads
        if active_lead_ids is not None:
            status_dist_lead_qs = status_dist_lead_qs.filter(id__in=active_lead_ids)
        status_distribution_qs = (
            status_dist_lead_qs
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
            'lost_reasons': lost_reasons,
            'status_distribution': status_distribution,
            'kpis': {
                'conversion_rate': conversion_rate,
                'avg_days_to_convert': avg_days,
                'pipeline_value': str(pipeline['pipeline_value'] or 0),
                'pipeline_count': pipeline['pipeline_count'],
            },
        })
