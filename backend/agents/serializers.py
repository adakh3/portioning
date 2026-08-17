"""Serializers for agent records exposed over HTTP (REL-413)."""
from rest_framework import serializers

from agents.models import ProposalDraft


class ProposalDraftSerializer(serializers.ModelSerializer):
    """Read view of a proposal run for the lead page / smart form. Output only —
    the agent writes these rows, never the client."""

    quote_id = serializers.IntegerField(source='quote.id', read_only=True, default=None)

    class Meta:
        model = ProposalDraft
        fields = ['id', 'lead', 'status', 'questions', 'answers', 'quote_id', 'error',
                  'created_at', 'updated_at']
        read_only_fields = fields
