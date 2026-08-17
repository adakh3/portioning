from django.contrib import admin

from agents.models import AgentThread, ProposalDraft


@admin.register(AgentThread)
class AgentThreadAdmin(admin.ModelAdmin):
    """Read-only audit view. Threads are written by the graph runner, never by
    hand — editing status/result here would desync from the checkpointer."""

    list_display = ('thread_key', 'agent', 'organisation', 'status', 'updated_at')
    list_filter = ('agent', 'status', 'organisation')
    search_fields = ('thread_key',)
    readonly_fields = (
        'agent', 'organisation', 'thread_key', 'status', 'result', 'error',
        'created_at', 'updated_at',
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ProposalDraft)
class ProposalDraftAdmin(admin.ModelAdmin):
    """Read-only audit view of proposal runs — written by the agent, never by hand."""

    list_display = ('id', 'organisation', 'lead', 'status', 'quote', 'updated_at')
    list_filter = ('status', 'organisation')
    readonly_fields = ('organisation', 'lead', 'agent_thread', 'quote', 'status',
                       'questions', 'answers', 'error', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
