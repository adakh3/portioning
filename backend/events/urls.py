from django.urls import path
from . import views

urlpatterns = [
    path('events/', views.EventListCreateView.as_view(), name='event-list'),
    path('events/calendar/', views.EventCalendarView.as_view(), name='event-calendar'),
    path('events/<int:pk>/', views.EventDetailView.as_view(), name='event-detail'),
    path('events/<int:pk>/pdf/', views.EventPDFView.as_view(), name='event-pdf'),
    path('events/<int:pk>/calculate/', views.EventCalculateView.as_view(), name='event-calculate'),
    path('events/<int:event_pk>/payments/', views.EventPaymentListCreateView.as_view(), name='event-payment-list'),
    path('events/<int:event_pk>/payments/<int:pk>/', views.EventPaymentDetailView.as_view(), name='event-payment-detail'),
]
