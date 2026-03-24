from rest_framework import permissions


class IsManagerOrOwner(permissions.BasePermission):
    """Only allow users with role 'manager' or 'owner'."""

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'role', '') in ('manager', 'owner')
        )


class IsOwner(permissions.BasePermission):
    """Only allow users with role 'owner'."""

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'role', '') == 'owner'
        )


def is_salesperson(user):
    """Return True if the authenticated user has the salesperson role."""
    return (
        user
        and user.is_authenticated
        and getattr(user, 'role', '') == 'salesperson'
    )
