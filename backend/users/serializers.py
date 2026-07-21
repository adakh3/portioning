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
        org = None
        if request is not None:
            # Resolves the superuser's session org-override too — JWT traffic
            # never gets an org from OrgMiddleware (it runs before DRF auth).
            from users.mixins import get_request_org
            org = get_request_org(request)
        # Fall back to user's own org (e.g. during login before middleware runs)
        if org is None:
            org = obj.organisation
        if org:
            return {"id": org.id, "name": org.name}
        return None

    def get_all_orgs(self, obj):
        request = self.context.get('request')
        return bool(request and getattr(request, '_org_all_override', False))


class UserManageSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    product_lines = serializers.PrimaryKeyRelatedField(
        many=True, required=False,
        queryset=serializers.empty,  # set dynamically in __init__
    )
    product_line_names = serializers.SerializerMethodField()

    class Meta:
        from .models import User
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'role', 'is_active', 'password', 'product_lines', 'product_line_names']
        read_only_fields = ['id']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from bookings.models.leads import ProductLine
        request = self.context.get('request')
        if request:
            org = getattr(request, 'organisation', None) or getattr(request.user, 'organisation', None)
            if org:
                self.fields['product_lines'].child_relation.queryset = ProductLine.objects.filter(organisation=org)

    def get_product_line_names(self, obj):
        # Read the prefetched `product_lines` cache (the list view prefetches it);
        # .values_list() would bypass it and query per user.
        return [pl.name for pl in obj.product_lines.all()]

    def create(self, validated_data):
        from .models import User
        password = validated_data.pop('password', None)
        product_lines = validated_data.pop('product_lines', [])
        user = User(**validated_data)
        if password:
            user.set_password(password)
        user.save()
        if product_lines:
            user.product_lines.set(product_lines)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        product_lines = validated_data.pop('product_lines', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        if product_lines is not None:
            instance.product_lines.set(product_lines)
        return instance


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()
