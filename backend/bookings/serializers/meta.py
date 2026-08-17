from rest_framework import serializers

from bookings.models import ConnectedMetaPage


class ConnectedMetaPageSerializer(serializers.ModelSerializer):
    """What Settings is allowed to know about a connected Page.

    An explicit allow-list, like ConnectedMailboxSerializer: the token columns
    must never be served to the browser, and `exclude` would start leaking them
    the day another one is added.
    """

    default_product_line_name = serializers.CharField(
        source='default_product_line.name', read_only=True, default=None,
    )

    class Meta:
        model = ConnectedMetaPage
        fields = [
            'id', 'page_id', 'page_name',
            'instagram_account_id', 'instagram_username',
            'default_product_line', 'default_product_line_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields
