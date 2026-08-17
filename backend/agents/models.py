"""Generic keying + audit record for every REL-412 agent run.

An ``AgentThread`` is the org-scoped, durable record that pairs a LangGraph
*checkpoint thread* (keyed by ``thread_key``) with the business context it runs
for. The graph's typed state and interrupt/resume checkpoints live in the
checkpointer (see ``agents/checkpointer.py``); this row is the queryable,
org-boundaried handle onto that run — its status, its result, its errors — so
the rest of the app (and later, HTTP endpoints) never has to reach into the
checkpointer to answer "what happened to this run?".

Real agents (REL-413's proposal builder, etc.) either FK this model or follow
its pattern. It is deliberately generic: no agent-specific columns.
"""
from django.db import models

from users.managers import TenantManager
from users.model_mixins import OrgScopedModel


class AgentThread(OrgScopedModel, models.Model):
    """One run of one agent, for one org, keyed to one checkpoint thread."""

    # Lifecycle. A run is created ``RUNNING``, parks at ``AWAITING_INPUT`` when
    # it hits a human-in-the-loop interrupt, and ends ``COMPLETED`` or ``FAILED``.
    RUNNING = 'running'
    AWAITING_INPUT = 'awaiting_input'
    COMPLETED = 'completed'
    FAILED = 'failed'
    STATUS_CHOICES = [
        (RUNNING, 'Running'),
        (AWAITING_INPUT, 'Awaiting input'),
        (COMPLETED, 'Completed'),
        (FAILED, 'Failed'),
    ]

    objects = TenantManager()

    agent = models.CharField(
        max_length=64,
        help_text="Which agent this run belongs to, e.g. 'skeleton' or 'proposal'.",
    )
    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='agent_threads',
    )
    # The LangGraph checkpoint thread id. Convention: "{agent}:{org_id}:{record_id}"
    # (see agents/checkpointer.py). Unique so a resume can never address two runs.
    thread_key = models.CharField(max_length=255, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=RUNNING)
    # Working payload while awaiting input (holds the pending question); the
    # finalized result once completed. Kept as opaque JSON so agents don't need
    # bespoke columns.
    result = models.JSONField(default=dict, blank=True)
    # Populated only on FAILED — the validation/LLM error that ended the run.
    error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['organisation', 'agent', 'status']),
        ]

    def __str__(self):
        return f"{self.thread_key} ({self.status})"


class ProposalDraft(OrgScopedModel, models.Model):
    """The REL-413 proposal-builder run for one lead (the first real agent).

    Follows the pattern REL-510 set out: it FKs an ``AgentThread`` (the generic
    checkpoint keying + audit record) and adds the proposal-specific columns —
    the lead it drafts for, the questions/answers of the human-in-the-loop step,
    and the ``Quote`` it produces once assembled. Org-scoped like everything else.
    """

    # Human-in-the-loop lifecycle. Created ``QUESTIONS_PENDING`` (parked at the
    # smart-form interrupt), advances to ``DRAFTING`` on resume, then ``DRAFTED``
    # once the quote is assembled. ``FAILED`` on an unrecoverable error;
    # ``ABANDONED`` if the caterer walks away.
    QUESTIONS_PENDING = 'questions_pending'
    DRAFTING = 'drafting'
    DRAFTED = 'drafted'
    FAILED = 'failed'
    ABANDONED = 'abandoned'
    STATUS_CHOICES = [
        (QUESTIONS_PENDING, 'Questions pending'),
        (DRAFTING, 'Drafting'),
        (DRAFTED, 'Drafted'),
        (FAILED, 'Failed'),
        (ABANDONED, 'Abandoned'),
    ]

    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='proposal_drafts',
    )
    lead = models.ForeignKey(
        'bookings.Lead', on_delete=models.CASCADE, related_name='proposal_drafts',
    )
    # The generic run/audit + checkpoint keying record. One AgentThread per draft.
    agent_thread = models.OneToOneField(
        AgentThread, on_delete=models.CASCADE, related_name='proposal_draft',
    )
    # Set once assemble_draft runs. SET_NULL so deleting a draft-quote doesn't take
    # the audit row with it.
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='proposal_drafts',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=QUESTIONS_PENDING)
    # The clarifying form the agent generated, and the caterer's answers.
    questions = models.JSONField(default=list, blank=True)
    answers = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['organisation', 'lead', 'status']),
        ]

    def __str__(self):
        return f"ProposalDraft #{self.pk} lead={self.lead_id} ({self.status})"
