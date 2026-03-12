from users.models import Organisation, User


def get_test_org():
    """Get or create a default test organisation."""
    org, _ = Organisation.objects.get_or_create(
        slug="default",
        defaults={"name": "Default Organisation", "country": "PK"},
    )
    return org


def get_test_user():
    """Get or create a test user for authenticated API tests."""
    org = get_test_org()
    user, _ = User.objects.get_or_create(
        email="test@example.com",
        defaults={
            "first_name": "Test",
            "last_name": "User",
            "role": "owner",
            "organisation": org,
        },
    )
    if user.organisation is None:
        user.organisation = org
        user.save(update_fields=["organisation"])
    return user
