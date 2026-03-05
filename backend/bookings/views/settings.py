from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import SiteSettings
from bookings.serializers.settings import SiteSettingsSerializer


class SiteSettingsView(APIView):
    def get(self, request):
        settings = SiteSettings.load()
        return Response(SiteSettingsSerializer(settings).data)

    def patch(self, request):
        self.permission_classes = [IsAdminUser]
        self.check_permissions(request)
        settings = SiteSettings.load()
        serializer = SiteSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
