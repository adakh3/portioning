from rest_framework import serializers

from bookings.models import ConnectedMailbox


class ConnectedMailboxSerializer(serializers.ModelSerializer):
    """What Settings is allowed to know about the connected mailbox.

    `fields` is an explicit allow-list on purpose: with `exclude` instead, the
    day someone adds another token column it would start being served to the
    browser. The token columns must never appear here.
    """

    provider_display = serializers.CharField(source='get_provider_display', read_only=True)

    class Meta:
        model = ConnectedMailbox
        fields = [
            'id', 'provider', 'provider_display', 'email_address',
            'status', 'last_error', 'created_at', 'updated_at',
        ]
        read_only_fields = fields
