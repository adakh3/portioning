"""
Global DRF exception handler.

Catches unhandled errors (e.g. DecimalField overflow during serialization)
so that endpoints always return structured JSON instead of 500 stack traces.
"""

import logging

from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is None:
        # DRF didn't handle it — log and return a generic 500 JSON body
        view = context.get("view", None)
        logger.exception(
            "Unhandled exception in %s: %s",
            view.__class__.__name__ if view else "unknown",
            exc,
        )
        from rest_framework.response import Response
        from rest_framework import status

        return Response(
            {"detail": "An internal error occurred. Please try again or contact support."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return response
