from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import BudgetRangeOption, SiteSettings
from bookings.serializers.settings import BudgetRangeOptionSerializer, SiteSettingsSerializer


class BudgetRangeOptionListView(generics.ListAPIView):
    queryset = BudgetRangeOption.objects.filter(is_active=True)
    serializer_class = BudgetRangeOptionSerializer


class SiteSettingsView(APIView):
    def get(self, request):
        settings = SiteSettings.load()
        return Response(SiteSettingsSerializer(settings).data)
