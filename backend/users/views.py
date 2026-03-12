import logging

from django.conf import settings
from django.contrib.auth import authenticate
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import serializers as drf_serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Organisation, User
from .serializers import LoginSerializer, UserSerializer

logger = logging.getLogger(__name__)

COOKIE_PATH = "/api/"


def _cookie_kwargs():
    jwt_settings = settings.SIMPLE_JWT
    return {
        "httponly": jwt_settings.get("AUTH_COOKIE_HTTP_ONLY", True),
        "secure": jwt_settings.get("AUTH_COOKIE_SECURE", False),
        "samesite": jwt_settings.get("AUTH_COOKIE_SAMESITE", "Lax"),
        "path": COOKIE_PATH,
    }


def _set_auth_cookies(response, refresh):
    access_token = str(refresh.access_token)
    refresh_token = str(refresh)
    jwt_settings = settings.SIMPLE_JWT
    kwargs = _cookie_kwargs()

    response.set_cookie(
        "access_token",
        access_token,
        max_age=int(jwt_settings["ACCESS_TOKEN_LIFETIME"].total_seconds()),
        **kwargs,
    )
    response.set_cookie(
        "refresh_token",
        refresh_token,
        max_age=int(jwt_settings["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        **kwargs,
    )
    return response


def _clear_auth_cookies(response):
    response.delete_cookie("access_token", path=COOKIE_PATH)
    response.delete_cookie("refresh_token", path=COOKIE_PATH)
    return response


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(ensure_csrf_cookie, name='dispatch')
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate(
            request,
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            logger.warning("Failed login attempt for email: %s", serializer.validated_data["email"])
            return Response(
                {"detail": "Invalid email or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        refresh = RefreshToken.for_user(user)
        response = Response(UserSerializer(user).data)
        return _set_auth_cookies(response, refresh)

    def get(self, request):
        """GET returns an empty response — used to fetch the CSRF cookie."""
        return Response({"detail": "CSRF cookie set."})


@method_decorator(csrf_exempt, name='dispatch')
class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        raw_refresh = request.COOKIES.get("refresh_token")
        if raw_refresh:
            try:
                token = RefreshToken(raw_refresh)
                token.blacklist()
            except (InvalidToken, TokenError):
                pass  # Token already invalid/expired — still clear cookies
        # Clear org override on logout
        request.session.pop('org_override', None)
        response = Response({"detail": "Logged out."})
        return _clear_auth_cookies(response)


@method_decorator(csrf_exempt, name='dispatch')
class RefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        raw_refresh = request.COOKIES.get("refresh_token")
        if not raw_refresh:
            return Response(
                {"detail": "No refresh token."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        try:
            old_refresh = RefreshToken(raw_refresh)
            # Get new access token from the old refresh token
            access_token = str(old_refresh.access_token)

            response = Response({"detail": "Refreshed."})
            kwargs = _cookie_kwargs()
            jwt_settings = settings.SIMPLE_JWT

            # Set new access token cookie
            response.set_cookie(
                "access_token",
                access_token,
                max_age=int(jwt_settings["ACCESS_TOKEN_LIFETIME"].total_seconds()),
                **kwargs,
            )

            # With ROTATE_REFRESH_TOKENS, blacklist the old token and issue a new one
            if settings.SIMPLE_JWT.get("ROTATE_REFRESH_TOKENS", False):
                old_refresh.blacklist()
                user = User.objects.get(pk=old_refresh.payload.get("user_id"))
                new_refresh = RefreshToken.for_user(user)
                response.set_cookie(
                    "refresh_token",
                    str(new_refresh),
                    max_age=int(jwt_settings["REFRESH_TOKEN_LIFETIME"].total_seconds()),
                    **kwargs,
                )

            return response
        except (InvalidToken, TokenError):
            return Response(
                {"detail": "Invalid refresh token."},
                status=status.HTTP_401_UNAUTHORIZED,
            )


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            UserSerializer(request.user, context={'request': request}).data
        )


class SwitchOrgView(APIView):
    """Allow superusers to switch their effective organisation via session."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can switch organisations."},
                status=status.HTTP_403_FORBIDDEN,
            )

        audit_logger = logging.getLogger('tenant.audit')
        org_id = request.data.get('org_id')

        if org_id == 'all':
            # Explicit all-orgs mode
            request.session['org_override'] = '__all__'
            request.organisation = None
            request._org_all_override = True
            audit_logger.info(
                "Superuser %s (pk=%s) switched to all-orgs mode",
                request.user.email, request.user.pk,
            )
        elif org_id is None:
            # Clear override — back to own org
            request.session.pop('org_override', None)
            request.organisation = request.user.organisation
            request._org_all_override = False
            audit_logger.info(
                "Superuser %s (pk=%s) cleared org override (own org)",
                request.user.email, request.user.pk,
            )
        else:
            try:
                org = Organisation.objects.get(pk=org_id, is_active=True)
            except Organisation.DoesNotExist:
                return Response(
                    {"detail": "Organisation not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            request.session['org_override'] = org.pk
            request.organisation = org
            request._org_all_override = False
            audit_logger.info(
                "Superuser %s (pk=%s) switched to org %s (pk=%s)",
                request.user.email, request.user.pk, org.name, org.pk,
            )

        return Response(
            UserSerializer(request.user, context={'request': request}).data
        )


class OrganisationListView(APIView):
    """List all active organisations — superusers only."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can list organisations."},
                status=status.HTTP_403_FORBIDDEN,
            )
        orgs = Organisation.objects.filter(is_active=True).order_by('name').values('id', 'name')
        return Response(list(orgs))
