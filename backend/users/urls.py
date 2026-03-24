from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.LoginView.as_view(), name="auth-login"),
    path("logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("refresh/", views.RefreshView.as_view(), name="auth-refresh"),
    path("me/", views.MeView.as_view(), name="auth-me"),
    path("switch-org/", views.SwitchOrgView.as_view(), name="auth-switch-org"),
    path("organisations/", views.OrganisationListView.as_view(), name="auth-organisations"),
    path("users/", views.UserManageListCreateView.as_view(), name="user-manage-list"),
    path("users/<int:pk>/", views.UserManageDetailView.as_view(), name="user-manage-detail"),
]
