from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import OrgSettings
from bookings.permissions import IsManagerOrOwner
from bookings.serializers.settings import OrgSettingsSerializer
from users.mixins import get_request_org


class SiteSettingsView(APIView):
    def get(self, request):
        settings = OrgSettings.for_org(get_request_org(request))
        return Response(OrgSettingsSerializer(settings).data)

    def patch(self, request):
        self.permission_classes = [IsManagerOrOwner]
        self.check_permissions(request)
        settings = OrgSettings.for_org(get_request_org(request))
        serializer = OrgSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
