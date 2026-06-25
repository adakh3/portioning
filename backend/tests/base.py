from django.db import connection
from django.test.utils import CaptureQueriesContext

from users.models import Organisation, User


def assert_list_queries_constant(testcase, client, url, make_row, label=""):
    """Guard a list endpoint against N+1: the query count must NOT grow as rows
    are added. Creates one row, warms per-request/module caches, measures the
    query count; adds two more rows, measures again; asserts the counts are equal.

    A growth means a serializer field reads a related object (FK/related set) that
    the view's queryset doesn't ``select_related``/``prefetch_related`` — fix it
    on the queryset, not by trimming the field.

    ``make_row`` is a zero-arg callable that creates ONE row in the client's org.
    """
    make_row()
    client.get(url)  # warm caches (module-level label caches, etc.)
    with CaptureQueriesContext(connection) as first:
        res = client.get(url)
        testcase.assertEqual(res.status_code, 200, f"{label or url}: GET -> {res.status_code}")
    base = len(first.captured_queries)

    make_row()
    make_row()
    with CaptureQueriesContext(connection) as second:
        testcase.assertEqual(client.get(url).status_code, 200)
    grown = len(second.captured_queries)

    testcase.assertEqual(
        base, grown,
        f"N+1 on {label or url}: query count grew {base} -> {grown} as rows were added. "
        f"Add the related FK(s) the serializer reads to select_related/prefetch_related "
        f"on the view queryset.",
    )


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
