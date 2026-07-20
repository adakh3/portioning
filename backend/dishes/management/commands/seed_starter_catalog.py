"""Seed a **neutral US-based starter catalog** into an organisation so a brand-new
org is usable immediately (dishes, menus, add-ons, staff/equipment, rules, and the
choice options quotes/events need).

Idempotent (get_or_create) — safe to re-run. Per-org, so every org gets its own
copy (unlike the dev-only desi ``seed_data``).

    python manage.py seed_starter_catalog --org "Acme Catering"
"""
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from users.models import Organisation
from dishes.models import DishCategory, Dish
from menus.models import MenuTemplate, MenuDishPortion, MenuTemplatePriceTier
from bookings.models.addons import AddOnProduct
from bookings.models.choices import (
    EventTypeOption, MealTypeOption, ServiceStyleOption, SourceOption,
)
from staff.models import LaborRole
from equipment.models import EquipmentItem
from rules.models import GlobalConfig, GlobalConstraint, BudgetProfile, GuestSegment


class Command(BaseCommand):
    help = 'Seed a neutral starter catalog into an organisation.'

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help='Organisation name to seed into.')

    def handle(self, *args, **options):
        try:
            org = Organisation.objects.get(name=options['org'])
        except Organisation.DoesNotExist:
            raise CommandError(f"No organisation named {options['org']!r}.")
        self.seed(org)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded starter catalog into {org.name!r}: "
            f"{Dish.objects.filter(organisation=org).count()} dishes, "
            f"{MenuTemplate.objects.filter(organisation=org).count()} menus, "
            f"{AddOnProduct.objects.filter(organisation=org).count()} add-ons."
        ))

    def seed(self, org):
        """Idempotently seed the starter catalog into `org`. Reusable from the
        org-creation signal (auto-onboarding) as well as this command — pass the
        org object directly, no name lookup."""
        self.org = org
        self._choice_options()
        cats = self._categories()
        dishes = self._dishes(cats)
        self._menus(dishes)
        self._addons()
        self._labor_roles()
        self._equipment()
        self._rules(cats)

    # ── Choice options (so quotes/events are usable) ──
    def _choice_options(self):
        def seed(model, items):
            for i, (value, label) in enumerate(items):
                model.objects.get_or_create(
                    organisation=self.org, value=value,
                    defaults={'label': label, 'sort_order': i},
                )
        seed(EventTypeOption, [
            ('wedding', 'Wedding'), ('corporate', 'Corporate Event'),
            ('birthday', 'Birthday Party'), ('anniversary', 'Anniversary'),
            ('holiday', 'Holiday Party'), ('private_dinner', 'Private Dinner'),
            ('graduation', 'Graduation'),
        ])
        seed(MealTypeOption, [
            ('breakfast', 'Breakfast'), ('brunch', 'Brunch'), ('lunch', 'Lunch'),
            ('dinner', 'Dinner'), ('cocktail', 'Cocktail Reception'),
            ('hors_doeuvres', "Hors d'oeuvres"),
        ])
        seed(ServiceStyleOption, [
            ('buffet', 'Buffet'), ('plated', 'Plated (Sit-down)'),
            ('family_style', 'Family Style'), ('stations', 'Food Stations'),
            ('drop_off', 'Drop-off / Delivery'),
        ])
        seed(SourceOption, [
            ('referral', 'Referral'), ('website', 'Website'), ('instagram', 'Instagram'),
            ('google', 'Google'), ('facebook', 'Facebook'), ('walk_in', 'Walk-in'),
            ('repeat', 'Repeat Client'),
        ])

    # ── Dish categories ── (name, display, order, pool, unit, baseline, min, fixed)
    def _categories(self):
        data = [
            ('appetizers', 'Appetizers', 0, 'accompaniment', 'kg',  60, 30, None),
            ('entrees',    'Entrées',    1, 'protein',       'kg', 180, 100, None),
            ('sides',      'Sides',      2, 'accompaniment', 'kg', 110, 50, None),
            ('salads',     'Salads',     3, 'service',       'kg',   0,  0,  85),
            ('breads',     'Breads',     4, 'service',       'qty',  0,  0,   1),
            ('desserts',   'Desserts',   5, 'dessert',       'kg',  90, 40, None),
        ]
        cats = {}
        for name, display, order, pool, unit, baseline, min_dish, fixed in data:
            cat, _ = DishCategory.objects.get_or_create(
                organisation=self.org, name=name,
                defaults={
                    'display_name': display, 'display_order': order,
                    'protein_is_additive': False, 'pool': pool, 'unit': unit,
                    'baseline_budget_grams': baseline, 'min_per_dish_grams': min_dish,
                    'fixed_portion_grams': fixed,
                },
            )
            cats[name] = cat
        return cats

    # ── Dishes ── (name, category, protein, portion_g, cost_per_gram, is_veg)
    def _dishes(self, cats):
        data = [
            ('Bruschetta',                 'appetizers', 'none',    60, 0.006, True),
            ('Stuffed Mushrooms',          'appetizers', 'none',    60, 0.008, True),
            ('Shrimp Cocktail',            'appetizers', 'seafood', 70, 0.020, False),
            ('Grilled Chicken Breast',     'entrees', 'chicken',   180, 0.012, False),
            ('Roast Beef',                 'entrees', 'beef',      180, 0.018, False),
            ('Baked Salmon',               'entrees', 'fish',      170, 0.022, False),
            ('Roast Turkey',               'entrees', 'turkey',    180, 0.011, False),
            ('Vegetable Lasagna',          'entrees', 'none',      200, 0.008, True),
            ('Mashed Potatoes',            'sides', 'none',        110, 0.004, True),
            ('Roasted Seasonal Vegetables','sides', 'none',        110, 0.006, True),
            ('Rice Pilaf',                 'sides', 'none',        110, 0.004, True),
            ('Mac & Cheese',               'sides', 'none',        110, 0.006, True),
            ('Caesar Salad',               'salads', 'none',        85, 0.005, True),
            ('Garden Salad',               'salads', 'none',        85, 0.004, True),
            ('Dinner Rolls',               'breads', 'none',         1, 0.000, True),
            ('Chocolate Brownies',         'desserts', 'none',      80, 0.008, True),
            ('New York Cheesecake',        'desserts', 'none',      90, 0.010, True),
            ('Fresh Fruit Platter',        'desserts', 'none',      90, 0.007, True),
        ]
        dishes = {}
        for name, cat, protein, portion, cpg, veg in data:
            dish, _ = Dish.objects.get_or_create(
                organisation=self.org, name=name,
                defaults={
                    'category': cats[cat], 'protein_type': protein,
                    'default_portion_grams': portion, 'popularity': 1.0,
                    'cost_per_gram': Decimal(str(cpg)), 'is_vegetarian': veg,
                },
            )
            dishes[name] = dish
        return dishes

    def _menus(self, dishes):
        self._menu(dishes, 'Corporate Lunch Buffet',
                   'A crowd-pleasing lunch spread for corporate events.',
                   [('Garden Salad', 85), ('Grilled Chicken Breast', 180),
                    ('Roasted Seasonal Vegetables', 110), ('Rice Pilaf', 110),
                    ('Dinner Rolls', 1), ('Chocolate Brownies', 80)],
                   tiers=[(25, Decimal('32.00')), (50, Decimal('28.00')), (100, Decimal('25.00'))])
        self._menu(dishes, 'Wedding Reception Dinner',
                   'An elegant plated or buffet dinner for weddings.',
                   [('Bruschetta', 60), ('Caesar Salad', 85), ('Roast Beef', 180),
                    ('Baked Salmon', 170), ('Mashed Potatoes', 110),
                    ('Roasted Seasonal Vegetables', 110), ('Dinner Rolls', 1),
                    ('New York Cheesecake', 90)],
                   tiers=[(50, Decimal('75.00')), (100, Decimal('68.00')), (200, Decimal('62.00'))])

    def _menu(self, dishes, name, description, portions, tiers):
        menu, created = MenuTemplate.objects.get_or_create(
            organisation=self.org, name=name,
            defaults={'description': description, 'default_gents': 50, 'default_ladies': 50},
        )
        if created:
            for dish_name, grams in portions:
                MenuDishPortion.objects.create(menu=menu, dish=dishes[dish_name], portion_grams=grams)
            for min_guests, price in tiers:
                MenuTemplatePriceTier.objects.create(menu=menu, min_guests=min_guests, price_per_head=price)

    # ── Add-ons ── (name, category, unit, price, taxable, featured)
    def _addons(self):
        data = [
            ('Soft Drinks',          'beverage', 'per_guest', '3.00',   True,  True),
            ('Coffee & Tea Service', 'beverage', 'per_guest', '2.50',   True,  True),
            ('Bottled Water',        'beverage', 'per_guest', '1.50',   True,  False),
            ('Server / Waitstaff',   'labor',    'per_hour',  '35.00',  False, True),
            ('Bartender',            'labor',    'per_hour',  '45.00',  False, False),
            ('Event Captain',        'labor',    'per_hour',  '55.00',  False, False),
            ('Round Tables',         'rental',   'each',      '12.00',  True,  False),
            ('Chiavari Chairs',      'rental',   'each',      '6.00',   True,  False),
            ('Linens',               'rental',   'each',      '15.00',  True,  False),
            ('Chafing Dishes',       'rental',   'each',      '20.00',  True,  False),
            ('Delivery & Setup',     'fee',      'flat',      '150.00', True,  True),
        ]
        for i, (name, cat, unit, price, taxable, featured) in enumerate(data):
            AddOnProduct.objects.get_or_create(
                organisation=self.org, name=name,
                defaults={
                    'category': cat, 'default_unit': unit, 'unit_price': Decimal(price),
                    'is_taxable': taxable, 'is_featured': featured, 'sort_order': i,
                },
            )

    def _labor_roles(self):
        for i, (name, rate) in enumerate([
            ('Head Chef', '40.00'), ('Line Cook', '28.00'), ('Server', '25.00'),
            ('Bartender', '30.00'), ('Event Captain', '38.00'),
        ]):
            LaborRole.objects.get_or_create(
                organisation=self.org, name=name,
                defaults={'default_hourly_rate': Decimal(rate), 'sort_order': i},
            )

    def _equipment(self):
        data = [
            ('Round Table (60")', 'table',   50, '12.00', '80.00'),
            ('Chiavari Chair',    'other',  400, '6.00',  '45.00'),
            ('Chafing Dish',      'chafer',  40, '20.00', '120.00'),
            ('Linen Tablecloth',  'linen',  100, '15.00', '35.00'),
            ('Beverage Dispenser','serving', 30, '10.00', '60.00'),
        ]
        for name, cat, stock, rental, replace in data:
            EquipmentItem.objects.get_or_create(
                organisation=self.org, name=name,
                defaults={
                    'category': cat, 'stock_quantity': stock,
                    'rental_price': Decimal(rental), 'replacement_cost': Decimal(replace),
                },
            )

    # ── Portioning rules (so the calculator works out-of-the-box) ──
    def _rules(self, cats):
        GlobalConfig.objects.get_or_create(organisation=self.org, defaults={
            'popularity_enabled': True, 'popularity_strength': 0.3,
            'protein_pool_ceiling_grams': 260, 'accompaniment_pool_ceiling_grams': 260,
            'dessert_pool_ceiling_grams': 120, 'dish_growth_rate': 0.20,
            'absent_redistribution_fraction': 0.70,
        })
        GlobalConstraint.objects.get_or_create(organisation=self.org, defaults={
            'max_total_food_per_person_grams': 1000, 'min_portion_per_dish_grams': 30,
        })
        # US orgs use meal-type segments (not a gender split): Adults full price,
        # Kids/Vendors eat & pay less. Vendors are additional covers (crew meals),
        # not part of the headline guest count.
        # (portion_multiplier, price_multiplier, is_default, counts_toward_total)
        for i, (name, portion, price, default, counts) in enumerate([
            ('Adults', 1.0, '1.0000', True, True),
            ('Kids', 0.6, '0.5000', False, True),
            ('Vendors', 1.0, '0.5000', False, False),
        ]):
            GuestSegment.objects.get_or_create(
                organisation=self.org, name=name,
                defaults={'portion_multiplier': portion, 'price_multiplier': Decimal(price),
                          'sort_order': i, 'is_default': default,
                          'counts_toward_total': counts},
            )
        std, created = BudgetProfile.objects.get_or_create(
            organisation=self.org, name='Standard',
            defaults={'description': 'Standard portions', 'is_default': True})
        if created:
            std.categories.set([cats['entrees'], cats['sides']])
        prem, created = BudgetProfile.objects.get_or_create(
            organisation=self.org, name='Premium',
            defaults={'description': 'Larger portions', 'is_default': False,
                      'protein_pool_ceiling_grams': 340})
        if created:
            prem.categories.set([cats['entrees'], cats['sides'], cats['desserts']])
