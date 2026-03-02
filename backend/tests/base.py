from users.models import User


def get_test_user():
    """Get or create a test user for authenticated API tests."""
    user, _ = User.objects.get_or_create(
        email="test@example.com",
        defaults={
            "first_name": "Test",
            "last_name": "User",
            "role": "owner",
        },
    )
    return user
