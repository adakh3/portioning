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
