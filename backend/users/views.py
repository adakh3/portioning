import logging

from django.conf import settings
from django.contrib.auth import authenticate
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import serializers as drf_serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from rest_framework import generics

from .models import Organisation, User
from .serializers import DemoRequestSerializer, LoginSerializer, UserSerializer, UserManageSerializer

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
            # Whose token is it, and is that account still allowed in? Checked
            # on every refresh, not just the rotating branch: simplejwt blocks a
            # de-activated user's *access* token at use, but nothing stopped the
            # refresh chain from minting new ones for the rest of its 7-day life
            # — and the whole chain sprang back if the account was ever
            # re-activated. A deleted user used to raise DoesNotExist straight
            # past the handler below as an unauthenticated 500 (REL-486).
            user_id = old_refresh.payload.get("user_id")
            if user_id is None:
                raise InvalidToken("Refresh token carries no user.")
            user = User.objects.get(pk=user_id, is_active=True)

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
                new_refresh = RefreshToken.for_user(user)
                response.set_cookie(
                    "refresh_token",
                    str(new_refresh),
                    max_age=int(jwt_settings["REFRESH_TOKEN_LIFETIME"].total_seconds()),
                    **kwargs,
                )

            return response
        except (InvalidToken, TokenError, User.DoesNotExist):
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
            # All-orgs mode is disabled — a superuser views exactly one org at a time.
            return Response(
                {"detail": "All-orgs mode is disabled. Select a single organisation."},
                status=status.HTTP_400_BAD_REQUEST,
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


class UserManageListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/auth/users/ — admin/owner user management. Only the owner
    (or a superuser) may create an owner account."""
    serializer_class = UserManageSerializer

    def get_permissions(self):
        from bookings.permissions import IsAdminOrOwner
        return [IsAdminOrOwner()]

    def get_queryset(self):
        org = getattr(self.request, 'organisation', None) or self.request.user.organisation
        # prefetch product_lines so the serializer's product_line_names doesn't query per user.
        return User.objects.filter(organisation=org).prefetch_related(
            'product_lines').order_by('first_name', 'last_name')

    def perform_create(self, serializer):
        from rest_framework.exceptions import PermissionDenied
        from bookings.permissions import is_owner_actor
        if serializer.validated_data.get('role') == 'owner' and not is_owner_actor(self.request.user):
            raise PermissionDenied('Only the owner can create an owner account.')
        org = getattr(self.request, 'organisation', None) or self.request.user.organisation
        serializer.save(organisation=org)


class UserManageDetailView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/auth/users/<pk>/ — admin/owner user management. Only the
    owner (or a superuser) may edit the owner account or assign the owner role."""
    serializer_class = UserManageSerializer

    def get_permissions(self):
        from bookings.permissions import IsAdminOrOwner
        return [IsAdminOrOwner()]

    def get_queryset(self):
        org = getattr(self.request, 'organisation', None) or self.request.user.organisation
        return User.objects.filter(organisation=org)

    def update(self, request, *args, **kwargs):
        from bookings.permissions import is_owner_actor
        target = self.get_object()
        if not is_owner_actor(request.user):
            if target.role == 'owner':
                return Response(
                    {'detail': 'Only the owner can edit the owner account.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if request.data.get('role') == 'owner':
                return Response(
                    {'detail': 'Only the owner can assign the owner role.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        return super().update(request, *args, **kwargs)


# The hidden field a human never sees. Deliberately not called "website" or
# anything else a password manager recognises: browsers and 1Password happily
# autofill a text input named for a URL, which would make the honeypot fire on
# real people instead of bots.
DEMO_HONEYPOT_FIELD = "referral_source"


class DemoRequestThrottle(ScopedRateThrottle):
    """Throttle the public demo form on the caller's real IP.

    DRF's default `get_ident` returns the *whole* X-Forwarded-For header when
    `NUM_PROXIES` is unset, and that header is client-supplied — so a spammer
    varying it by one byte per request mints a fresh bucket every time and the
    limit may as well not exist. The address the trusted proxy in front of us
    appended is the last entry, so key on that.

    Scoped to this view rather than fixed globally via `NUM_PROXIES`: if the
    proxy count in front of the app ever changes, the blast radius of getting
    it wrong is one marketing form, not the client-facing sign page.
    """

    def get_ident(self, request):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        if forwarded:
            return forwarded.split(",")[-1].strip()
        return request.META.get("REMOTE_ADDR")


class DemoRequestCreateView(APIView):
    """Public Book-a-Demo endpoint for the landing page (REL-482).

    Spam guard: the hidden honeypot field above. When it arrives filled we
    validate and answer *exactly* as a genuine submission would but save
    nothing — the response has to be indistinguishable from success in both
    directions. A bot that can spot the difference simply stops filling the
    field, and a human whose password manager filled it must never be shown an
    error for a lead we quietly dropped.
    """

    permission_classes = [AllowAny]
    throttle_classes = [DemoRequestThrottle]
    throttle_scope = "demo_requests"

    def post(self, request):
        # Validate first: it rejects a non-dict body (a bare JSON list used to
        # reach `.get` below and raise AttributeError → an unauthenticated 500).
        serializer = DemoRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not request.data.get(DEMO_HONEYPOT_FIELD):
            serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
