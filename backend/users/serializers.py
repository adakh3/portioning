from rest_framework import serializers


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    email = serializers.EmailField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_superuser = serializers.BooleanField(read_only=True)
    organisation = serializers.SerializerMethodField()
    all_orgs = serializers.SerializerMethodField()

    def get_organisation(self, obj):
        request = self.context.get('request')
        # In all-orgs mode, return null for org
        if request and getattr(request, '_org_all_override', False):
            return None
        org = getattr(request, 'organisation', None) if request else None
        # Fall back to user's own org (e.g. during login before middleware runs)
        if org is None:
            org = obj.organisation
        if org:
            return {"id": org.id, "name": org.name}
        return None

    def get_all_orgs(self, obj):
        request = self.context.get('request')
        return bool(request and getattr(request, '_org_all_override', False))


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()
