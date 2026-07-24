from django.test import TestCase


class HealthEndpointTests(TestCase):
    def test_health_returns_ok_without_auth(self):
        """The probe must answer 200 with no login and no org context."""
        resp = self.client.get("/api/health/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"status": "ok"})
