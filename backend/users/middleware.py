class OrgMiddleware:
    """Set request.organisation from the authenticated user."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if hasattr(request, 'user') and request.user.is_authenticated:
            request.organisation = request.user.organisation
        else:
            request.organisation = None
        return self.get_response(request)
