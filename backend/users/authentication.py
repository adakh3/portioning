from rest_framework.authentication import CSRFCheck
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication


class CookieJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        raw_token = request.COOKIES.get("access_token")
        if raw_token is None:
            # Fall back to header-based JWT (e.g. for API clients)
            return super().authenticate(request)
        # Cookie-based auth: enforce CSRF on unsafe methods
        self._enforce_csrf(request)
        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token

    def _enforce_csrf(self, request):
        if request.method in ("GET", "HEAD", "OPTIONS", "TRACE"):
            return
        check = CSRFCheck(lambda req: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f"CSRF Failed: {reason}")
