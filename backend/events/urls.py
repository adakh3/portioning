from django.urls import path
from bookings.views import EventSendForSignatureView
from bookings.views.client_messages import (
    ClientMessageDraftView, ClientMessageListView, ClientMessageSendView,
    ClientMessagingStatusView,
)
from . import views

urlpatterns = [
    path('events/', views.EventListCreateView.as_view(), name='event-list'),
    path('events/calendar/', views.EventCalendarView.as_view(), name='event-calendar'),
    path('events/<int:pk>/', views.EventDetailView.as_view(), name='event-detail'),
    path('events/<int:pk>/pdf/', views.EventPDFView.as_view(), name='event-pdf'),
    path('events/<int:pk>/beo/', views.EventBEOView.as_view(), name='event-beo'),
    path('events/<int:pk>/beo/revise/', views.EventBEORevisionView.as_view(), name='event-beo-revise'),
    path('events/<int:pk>/calculate/', views.EventCalculateView.as_view(), name='event-calculate'),
    path('events/<int:pk>/finals/', views.EventFinalsView.as_view(), name='event-finals'),
    path('events/<int:event_pk>/payments/', views.EventPaymentListCreateView.as_view(), name='event-payment-list'),
    path('events/<int:event_pk>/payments/<int:pk>/', views.EventPaymentDetailView.as_view(), name='event-payment-detail'),
    path('events/<int:pk>/send-for-signature/', EventSendForSignatureView.as_view(), name='event-send-for-signature'),

    # Client messaging — the event side of the same three verbs as quotes.
    path('events/<int:pk>/draft-message/', ClientMessageDraftView.as_view(), {'parent_type': 'event'}, name='event-draft-message'),
    path('events/<int:pk>/send-message/', ClientMessageSendView.as_view(), {'parent_type': 'event'}, name='event-send-message'),
    path('events/<int:pk>/messages/', ClientMessageListView.as_view(), {'parent_type': 'event'}, name='event-messages'),
    path('events/<int:pk>/messaging-status/', ClientMessagingStatusView.as_view(), {'parent_type': 'event'}, name='event-messaging-status'),
]
