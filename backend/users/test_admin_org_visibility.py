"""The multi-tenant Django admin must surface each row's organisation so a
superuser can see and filter by tenant."""
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import TestCase, RequestFactory

from bookings.models import Account, Contact, Invoice, Lead, Payment, Quote
from dishes.models import Dish, DishCategory
from equipment.models import EquipmentItem, EquipmentReservation
from menus.models import MenuTemplate
from rules.models import CategoryConstraint, GlobalConfig
from staff.models import AllocationRule, LaborRole, Shift, StaffMember


class TestAdminOrgVisibility(TestCase):
    def setUp(self):
        self.req = RequestFactory().get("/")
        self.req.user = get_user_model()(is_superuser=True, is_staff=True)

    def _ma(self, model):
        return admin.site._registry[model]

    def test_direct_org_models_show_org_column_and_filter(self):
        for model in [MenuTemplate, Dish, DishCategory, LaborRole, StaffMember,
                      EquipmentItem, GlobalConfig,
                      # bookings admins (via OrgScopedAdmin)
                      Lead, Account, Contact, Quote]:
            ma = self._ma(model)
            self.assertIn("organisation", ma.get_list_display(self.req), model.__name__)
            self.assertIn("organisation", ma.get_list_filter(self.req), model.__name__)

    def test_user_admin_surfaces_elevated_access(self):
        from django.contrib.auth import get_user_model
        ma = self._ma(get_user_model())
        ld = ma.get_list_display(self.req)
        self.assertIn("is_superuser", ld)
        self.assertIn("organisation", ld)
        self.assertIn("is_superuser", ma.get_list_filter(self.req))

    def test_child_models_filter_by_org_path(self):
        cases = {
            Shift: "event__organisation",
            AllocationRule: "role__organisation",
            EquipmentReservation: "equipment__organisation",
            CategoryConstraint: "category__organisation",
            # bookings records scoped through a parent
            Invoice: "event__organisation",
            Payment: "invoice__event__organisation",
        }
        for model, path in cases.items():
            self.assertIn(path, self._ma(model).get_list_filter(self.req), model.__name__)
