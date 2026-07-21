"""New orgs get OrgSettings currency/tax defaults derived from their country."""
from decimal import Decimal

from django.test import TestCase

from users.models import Organisation
from users.country_defaults import defaults_for_country
from bookings.models.settings import OrgSettings


class CountryDefaultsUnitTests(TestCase):
    def test_known_country(self):
        d = defaults_for_country('US')
        self.assertEqual(d['currency_code'], 'USD')
        self.assertEqual(d['tax_label'], 'Sales Tax')

    def test_case_insensitive(self):
        self.assertEqual(defaults_for_country('gb')['currency_code'], 'GBP')

    def test_unmapped_falls_back_to_usd(self):
        d = defaults_for_country('ZZ')
        self.assertEqual(d['currency_code'], 'USD')
        self.assertEqual(defaults_for_country('')['currency_code'], 'USD')
        self.assertEqual(defaults_for_country(None)['currency_code'], 'USD')


class OrgSettingsFromCountryTests(TestCase):
    """The org-creation signal seeds OrgSettings from the org's country."""

    def _settings_for(self, country):
        org = Organisation.objects.create(
            name=f"Org-{country}", slug=f"org-{country.lower()}", country=country,
        )
        return OrgSettings.objects.get(organisation=org)

    def test_us_org_gets_usd_sales_tax(self):
        s = self._settings_for('US')
        self.assertEqual(s.currency_code, 'USD')
        self.assertEqual(s.currency_symbol, '$')
        self.assertEqual(s.tax_label, 'Sales Tax')
        self.assertEqual(s.default_tax_rate, Decimal('0.0000'))
        self.assertEqual(s.date_format, 'MM/DD/YYYY')

    def test_uae_org_gets_aed(self):
        s = self._settings_for('AE')
        self.assertEqual(s.currency_code, 'AED')
        self.assertEqual(s.tax_label, 'VAT')
        self.assertEqual(s.default_tax_rate, Decimal('0.0500'))

    def test_uk_org_gets_gbp(self):
        s = self._settings_for('GB')
        self.assertEqual(s.currency_code, 'GBP')
        self.assertEqual(s.currency_symbol, '£')

    def test_unmapped_country_gets_usd_fallback(self):
        s = self._settings_for('ZZ')
        self.assertEqual(s.currency_code, 'USD')

    def test_new_org_gets_starter_terms(self):
        """Every new org is seeded with the starter T&C template, regardless of
        country, so its quote/sign page isn't blank on day one."""
        from bookings.default_terms import DEFAULT_QUOTATION_TERMS
        for country in ('US', 'AE', 'ZZ'):
            with self.subTest(country=country):
                self.assertEqual(self._settings_for(country).quotation_terms,
                                 DEFAULT_QUOTATION_TERMS)
