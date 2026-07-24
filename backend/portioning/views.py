from django.http import JsonResponse


def health(_request):
    """Liveness probe for the post-deploy smoke check (REL-360).

    Deliberately unauthenticated and touches no database or org state — it only
    proves the app process is up and serving. Keep it that way so an alert here
    means "the deploy is down", not "some tenant's data is off".
    """
    return JsonResponse({"status": "ok"})
