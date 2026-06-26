from rest_framework import permissions

# Role tiers. A superuser maps to owner (full access everywhere).
ADMIN_ROLES = ('admin', 'owner')               # org settings / configuration
MANAGER_ROLES = ('manager', 'admin', 'owner')  # operational management


def _allowed(request, roles):
    user = getattr(request, 'user', None)
    if not (user and user.is_authenticated):
        return False
    if getattr(user, 'is_superuser', False):
        return True  # superuser maps to owner
    return getattr(user, 'role', '') in roles


class IsManagerOrOwner(permissions.BasePermission):
    """Manager, admin or owner (or superuser) — operational management."""

    def has_permission(self, request, view):
        return _allowed(request, MANAGER_ROLES)


class IsAdminOrOwner(permissions.BasePermission):
    """Admin or owner (or superuser) — org settings / configuration. Plain
    managers are excluded (they don't see admin settings)."""

    def has_permission(self, request, view):
        return _allowed(request, ADMIN_ROLES)


class IsAdminOrOwnerOrReadOnly(permissions.BasePermission):
    """Any authenticated user may read; only admin/owner may write. Use for
    org config catalogs that operational users must *read* (e.g. when building
    an event) but only admins should *change* (equipment, labor roles, rules)."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return _allowed(request, ADMIN_ROLES)


class IsOwner(permissions.BasePermission):
    """Owner only (or superuser)."""

    def has_permission(self, request, view):
        return _allowed(request, ('owner',))


def is_owner_actor(user):
    """True if the user may manage the owner account (owner or superuser)."""
    return bool(
        user and user.is_authenticated
        and (getattr(user, 'is_superuser', False) or getattr(user, 'role', '') == 'owner')
    )


def is_salesperson(user):
    """Return True if the authenticated user has the salesperson role."""
    return (
        user
        and user.is_authenticated
        and getattr(user, 'role', '') == 'salesperson'
    )
