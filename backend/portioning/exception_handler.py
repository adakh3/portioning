"""
Global DRF exception handler.

Catches unhandled errors (e.g. DecimalField overflow during serialization)
so that endpoints always return structured JSON instead of 500 stack traces.
"""

import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def _as_drf_validation_error(exc):
    """Django's ValidationError as DRF's, so it renders as a 400 with field errors.

    Model-layer validation — notably the org-scoping FK guard in
    ``users.model_mixins`` — raises Django's ValidationError from ``save()``, which
    DRF does not recognise. Left alone it fell through to the generic 500 handler
    below, so a genuine "belongs to a different organisation" rejection reached the
    client as an opaque server error. Converting centrally keeps that guard in one
    place instead of re-raising it per endpoint.
    """
    if hasattr(exc, 'message_dict'):
        return DRFValidationError(exc.message_dict)
    return DRFValidationError(exc.messages if hasattr(exc, 'messages') else str(exc))


def custom_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = _as_drf_validation_error(exc)

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
