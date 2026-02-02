from django.urls import path
from . import views

urlpatterns = [
    path('calculate/', views.CalculateView.as_view(), name='calculate'),
    path('check-portions/', views.CheckPortionsView.as_view(), name='check-portions'),
    path('export-pdf/', views.ExportPDFView.as_view(), name='export-pdf'),
]
