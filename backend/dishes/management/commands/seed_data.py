from django.core.management.base import BaseCommand
from dishes.models import DishCategory, Dish
from menus.models import MenuTemplate, MenuDishPortion
from rules.models import (
    GlobalConfig, BudgetProfile, GuestProfile,
    CombinationRule, GlobalConstraint, CategoryConstraint,
)


class Command(BaseCommand):
    help = 'Seed the database with dishes, categories, rules, and menu templates'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true', help='Delete existing data before seeding')

    def handle(self, *args, **options):
        if options['reset']:
            self.stdout.write('Resetting data...')
            MenuDishPortion.objects.all().delete()
            MenuTemplate.objects.all().delete()
            Dish.objects.all().delete()
            DishCategory.objects.all().delete()
            CombinationRule.objects.all().delete()
            BudgetProfile.objects.all().delete()
            CategoryConstraint.objects.all().delete()
            GuestProfile.objects.all().delete()
            GlobalConfig.objects.all().delete()
            GlobalConstraint.objects.all().delete()

        self.stdout.write('Seeding data...')

        # ── Categories ──
        # Baselines calibrated from single-dish real data (Golden Elegance Feast):
        #   Curry (meat): 1 dish → 160g (Chicken Qorma), so baseline=160, min=70
        #   BBQ: 1 dish → 180g (Chicken Seekh Kabab), so baseline=180, min=100
        #   Rice: 1 dish → 100g (Chicken Biryani), so baseline=100, min=70
        #   Veg Curry: accompaniment pool, baseline=80, min=30
        #   Sides: accompaniment pool, baseline=60, min=30
        #   Dessert: 1 dish → 80g (Fruit Trifle), so baseline=80, min=40
        #   Salad: 50g per dish, category max 100g
        #   Condiment: 40g fixed
        #   Bread: 1 per person
        #   Tea: 1 per person
        #
        # Absent-category budget is redistributed proportionally by the engine.
        #
        # (name, display_name, order, protein_is_additive, pool, unit,
        #  baseline_budget, min_per_dish, fixed_portion)
        categories = {}
        cat_data = [
            ('curry',         'Curry',          0, False, 'protein',       'kg', 160,  70, None),
            ('dry_barbecue',  'Dry / Barbecue', 1, False, 'protein',       'kg', 180, 100, None),
            ('rice',          'Rice',           2, True,  'protein',       'kg', 100,  70, None),
            ('veg_curry',     'Veg Curry',      3, False, 'accompaniment', 'kg',  80,  30, None),
            ('sides',         'Sides',          4, False, 'accompaniment', 'kg',  60,  30, None),
            ('dessert',       'Dessert',        5, False, 'dessert',       'kg',  80,  40, None),
            ('salad',         'Salad',          6, False, 'service',       'kg',   0,   0,  50),
            ('condiment',     'Condiment',      7, False, 'service',       'kg',   0,   0,  40),
            ('bread',         'Bread',          8, False, 'service',       'qty',  0,   0,   1),
            ('tea',           'Tea',            9, False, 'service',       'qty',  0,   0,   1),
        ]
        for name, display, order, additive, pool, unit, baseline, min_dish, fixed in cat_data:
            cat, _ = DishCategory.objects.update_or_create(
                name=name, defaults={
                    'display_name': display,
                    'display_order': order,
                    'protein_is_additive': additive,
                    'pool': pool,
                    'unit': unit,
                    'baseline_budget_grams': baseline,
                    'min_per_dish_grams': min_dish,
                    'fixed_portion_grams': fixed,
                }
            )
            categories[name] = cat

        # ── Dishes ──
        # (name, category, protein_type, default_portion_g, popularity, cost_per_gram, is_veg)
        dishes = {}
        dish_data = [
            # === CURRY ===
            ('Mutton Qorma',            'curry', 'mutton',  120, 1.0, 0.0055, False),
            ('Mutton Badami Qorma',     'curry', 'mutton',  120, 1.0, 0.0060, False),
            ('Mutton White Qorma',      'curry', 'mutton',  120, 1.0, 0.0058, False),
            ('Mutton Kunna',            'curry', 'mutton',  120, 1.0, 0.0055, False),
            ('Mutton Paye',             'curry', 'mutton',  130, 1.0, 0.0060, False),
            ('Mutton Rezala',           'curry', 'mutton',  120, 1.0, 0.0058, False),
            ('Mutton Karahi',           'curry', 'mutton',  120, 1.0, 0.0055, False),
            ('Mutton Shinwari Karahi',  'curry', 'mutton',  120, 1.0, 0.0058, False),
            ('Lamb Shinwari Karahi',    'curry', 'lamb',    120, 1.0, 0.0065, False),
            ('Palak Paneer',            'veg_curry', 'none', 110, 1.0, 0.0030, True),
            ('Chicken Qorma',           'curry', 'chicken', 120, 1.0, 0.0038, False),
            ('Bombay Chicken',          'curry', 'chicken', 120, 1.0, 0.0040, False),
            ('Chicken Curry',           'curry', 'chicken', 120, 1.0, 0.0035, False),
            ('Aaloo Chicken',           'curry', 'chicken', 120, 1.0, 0.0032, False),
            ('Chicken Chanay',          'curry', 'chicken', 120, 1.0, 0.0033, False),
            ('Veal Qorma',             'curry', 'veal',    120, 1.0, 0.0050, False),
            ('Mix Daal',                'veg_curry', 'none', 110, 1.0, 0.0012, True),
            ('Lahori Chicken Karahi',   'curry', 'chicken', 120, 1.0, 0.0040, False),
            ('Chicken Handi',           'curry', 'chicken', 120, 1.0, 0.0038, False),
            ('Chicken Haleem',          'curry', 'chicken', 130, 1.0, 0.0035, False),
            ('Beef Haleem',             'curry', 'beef',    130, 1.0, 0.0040, False),
            ('Curry Pakora',            'veg_curry', 'none', 100, 1.0, 0.0020, True),
            ('Daal Chana',              'veg_curry', 'none', 110, 1.0, 0.0012, True),
            ('Lobia',                   'veg_curry', 'none', 110, 1.0, 0.0012, True),
            ('Kofta Curry',             'curry', 'beef',    120, 1.0, 0.0042, False),
            ('Aaloo Achari',            'veg_curry', 'none', 100, 1.0, 0.0012, True),
            ('Lahori Chanay',           'veg_curry', 'none', 110, 1.0, 0.0012, True),
            ('Chicken Handi (With Bone)', 'curry', 'chicken', 130, 1.0, 0.0036, False),

            # === RICE ===
            ('Chicken Biryani',         'rice', 'chicken',  180, 1.0, 0.0028, False),
            ('Chicken Sindhi Biryani',  'rice', 'chicken',  180, 1.0, 0.0030, False),
            ('Vegetable Biryani',       'rice', 'none',     170, 1.0, 0.0015, True),
            ('Matka Biryani',           'rice', 'chicken',  180, 1.0, 0.0032, False),
            ('Chicken Pulao',           'rice', 'chicken',  170, 1.0, 0.0025, False),
            ('Mutton Pulao',            'rice', 'mutton',   170, 1.0, 0.0045, False),
            ('Mutton Bukhara Pulao',    'rice', 'mutton',   170, 1.0, 0.0048, False),
            ('Veal Kabuli Pulao',       'rice', 'veal',     170, 1.0, 0.0042, False),
            ('Peas Pulao',              'rice', 'none',     160, 1.0, 0.0010, True),
            ('Chana Pulao',             'rice', 'none',     160, 1.0, 0.0012, True),
            ('Vegetable Pulao',         'rice', 'none',     160, 1.0, 0.0012, True),
            ('Singaporean Rice',        'rice', 'none',     160, 1.0, 0.0012, True),
            ('Arabic Rice',             'rice', 'none',     160, 1.0, 0.0010, True),
            ('Vegetable Fried Rice',    'rice', 'none',     160, 1.0, 0.0014, True),
            ('Egg Fried Rice',          'rice', 'none',     160, 1.0, 0.0015, False),
            ('Chicken Fried Rice',      'rice', 'chicken',  170, 1.0, 0.0022, False),
            ('Veal Biryani',            'rice', 'veal',     180, 1.0, 0.0040, False),

            # === DRY / BARBECUE ===
            ('Whole Mutton Roast',      'dry_barbecue', 'mutton',  100, 1.0, 0.0070, False),
            ('Whole Lamb Roast',        'dry_barbecue', 'lamb',    100, 1.0, 0.0075, False),
            ('Mutton Foil Roast',       'dry_barbecue', 'mutton',  100, 1.0, 0.0065, False),
            ('Mutton Leg',              'dry_barbecue', 'mutton',  100, 1.0, 0.0065, False),
            ('Veal Foil Roast',         'dry_barbecue', 'veal',    100, 1.0, 0.0055, False),
            ('Chicken with Almond',     'dry_barbecue', 'chicken', 100, 1.0, 0.0045, False),
            ('Steam Roast',             'dry_barbecue', 'chicken', 100, 1.0, 0.0042, False),
            ('Whole Chicken',           'dry_barbecue', 'chicken', 100, 1.0, 0.0040, False),
            ('Lahori Fried Fish',       'dry_barbecue', 'fish',     90, 1.0, 0.0050, False),
            ('Crumb Fried Fish',        'dry_barbecue', 'fish',     90, 1.0, 0.0048, False),
            ('Tawa Fish',               'dry_barbecue', 'fish',     90, 1.0, 0.0052, False),
            ('Chicken Boti Tikka',      'dry_barbecue', 'chicken', 100, 1.0, 0.0045, False),
            ('Seekh Kabab',             'dry_barbecue', 'beef',    100, 1.0, 0.0048, False),
            ('Mix Vegetable Bhujiyya',  'dry_barbecue', 'none',     80, 1.0, 0.0015, True),
            ('Spring Roll',             'dry_barbecue', 'none',     70, 1.0, 0.0020, True),
            ('Chicken Seekh Kabab',     'dry_barbecue', 'chicken', 100, 1.0, 0.0046, False),
            ('Mutton Seekh Kabab',      'dry_barbecue', 'mutton',  100, 1.0, 0.0060, False),
            ('Chicken Tandoori Boti',   'dry_barbecue', 'chicken', 100, 1.0, 0.0048, False),
            ('Turkish Kabab',           'dry_barbecue', 'beef',    100, 1.0, 0.0055, False),
            ('Lebanese Boti',           'dry_barbecue', 'chicken', 100, 1.0, 0.0050, False),
            ('Shish Tawok',             'dry_barbecue', 'chicken', 100, 1.0, 0.0048, False),
            ('Beef Afghani Boti',       'dry_barbecue', 'beef',    100, 1.0, 0.0052, False),

            # === DESSERT ===
            ('Zarda',                   'dessert', 'none', 80, 1.0, 0.0018, True),
            ('Mutanjan (Special)',      'dessert', 'none', 80, 1.0, 0.0022, True),
            ('Fruit Trifle',            'dessert', 'none', 80, 1.0, 0.0025, True),
            ('Kheer',                   'dessert', 'none', 80, 1.0, 0.0020, True),
            ('Hyderabadi Shahi Tukray', 'dessert', 'none', 80, 1.0, 0.0028, True),
            ('Chocolate Mousse',        'dessert', 'none', 70, 1.0, 0.0035, True),
            ('Ice Cream',               'dessert', 'none', 80, 1.0, 0.0030, True),
            ('Halwa Petha',             'dessert', 'none', 70, 1.0, 0.0015, True),
            ('Gajar Halwa',             'dessert', 'none', 80, 1.0, 0.0020, True),
            ('Gulab Jaman',             'dessert', 'none', 60, 1.0, 0.0022, True),
            ('Halwa Suji',              'dessert', 'none', 70, 1.0, 0.0015, True),
            ('Cream Caramel',           'dessert', 'none', 80, 1.0, 0.0030, True),
            ('Bread Pudding',           'dessert', 'none', 80, 1.0, 0.0020, True),
            ('Caramel Crunch',          'dessert', 'none', 70, 1.0, 0.0028, True),

            # === SIDES (veg curry) ===
            ('Bhagaray Baingan',        'sides', 'none', 60, 1.0, 0.0015, True),
            ('Bhindi Fry',              'sides', 'none', 60, 1.0, 0.0015, True),
            ('Mirchi Ka Salan',         'sides', 'none', 50, 1.0, 0.0012, True),
            ('Khattay Aaloo',           'sides', 'none', 60, 1.0, 0.0010, True),
            ('Aaloo Bukharay ke Chutney', 'sides', 'none', 40, 1.0, 0.0010, True),

            # === SALAD ===
            ('Fresh Green Salad',       'salad', 'none', 50, 1.0, 0.0008, True),
            ('Macaroni Salad',          'salad', 'none', 50, 1.0, 0.0012, True),
            ('Greek Village Salad',     'salad', 'none', 50, 1.0, 0.0015, True),
            ('Caesar Salad',            'salad', 'none', 50, 1.0, 0.0015, True),
            ('Pasta Salad',             'salad', 'none', 50, 1.0, 0.0012, True),
            ('Waldorf Salad',           'salad', 'none', 50, 1.0, 0.0015, True),
            ('Cabbage Salad with Apple & Walnuts', 'salad', 'none', 50, 1.0, 0.0012, True),

            # === CONDIMENT ===
            ('Raita',                   'condiment', 'none', 40, 1.0, 0.0008, True),

            # === BREAD ===
            ('Assorted Naan',           'bread', 'none', 1.0, 1.0, 0.0, True),
            ('Puri',                    'bread', 'none', 1.0, 1.0, 0.0, True),

            # === TEA ===
            ('Green Tea',               'tea', 'none', 1.0, 1.0, 0.0, True),
        ]

        for name, cat, protein, portion, pop, cpg, veg in dish_data:
            dish, _ = Dish.objects.get_or_create(
                name=name,
                defaults={
                    'category': categories[cat],
                    'protein_type': protein,
                    'default_portion_grams': portion,
                    'popularity': pop,
                    'cost_per_gram': cpg,
                    'is_vegetarian': veg,
                }
            )
            dishes[name] = dish

        # ── Global Config ──
        # Protein ceiling 590g calibrated from real Majestic Celebration Banquet:
        # BBQ(330) + curry(190) + rice(70) = 590g
        GlobalConfig.objects.update_or_create(pk=1, defaults={
            'popularity_enabled': True,
            'popularity_strength': 0.3,
            'protein_pool_ceiling_grams': 590,
            'accompaniment_pool_ceiling_grams': 150,
            'dessert_pool_ceiling_grams': 150,
            'dish_growth_rate': 0.20,
            'absent_redistribution_fraction': 0.70,
        })

        # ── Budget Profiles ──
        profile_data = [
            ('Standard', 'Standard protein ceiling (590g)', True, None, None,
             ['curry', 'dry_barbecue', 'rice']),
            ('Grand', 'Grand tier with expanded ceiling (700g)', False, 700, None,
             ['curry', 'dry_barbecue', 'rice', 'dessert']),
        ]

        for name, desc, is_default, protein_ceil, dessert_ceil, cat_names in profile_data:
            profile, created = BudgetProfile.objects.get_or_create(
                name=name,
                defaults={
                    'description': desc,
                    'is_default': is_default,
                    'protein_pool_ceiling_grams': protein_ceil,
                    'dessert_pool_ceiling_grams': dessert_ceil,
                },
            )
            if created:
                profile.categories.set([categories[cn] for cn in cat_names])

        # ── Guest Profiles ──
        for name, mult in [('gents', 1.0), ('ladies', 1.0)]:
            GuestProfile.objects.get_or_create(name=name, defaults={'portion_multiplier': mult})

        # ── Global Constraint ──
        GlobalConstraint.objects.get_or_create(pk=1, defaults={
            'max_total_food_per_person_grams': 1000,
            'min_portion_per_dish_grams': 30,
        })

        # ── Category Constraints ──
        # Salad: min 30g per dish, max 100g total for category
        salad_cat = categories['salad']
        CategoryConstraint.objects.update_or_create(
            category=salad_cat,
            defaults={
                'min_portion_grams': 30,
                'max_total_category_grams': 100,
            }
        )

        # ── Menu Templates ──
        # All menus are 50G/50L. Portions are per-person snapshots.

        # 1. Golden Elegance Feast — BBQ + curry + rice (standard)
        # Real data: 100 ppl. Seekh 18kg, Qorma 16kg, Biryani 10kg
        self._create_menu(
            'Golden Elegance Feast',
            'BBQ, curry, and rice — standard tier',
            dishes,
            [
                ('Chicken Seekh Kabab', 180),
                ('Chicken Qorma', 160),
                ('Chicken Biryani', 100),
                ('Fresh Green Salad', 40),
                ('Macaroni Salad', 60),
                ('Raita', 40),
                ('Assorted Naan', 1),
                ('Fruit Trifle', 80),
                ('Green Tea', 1),
            ],
        )

        # 2. Royal Heritage Spread — curry + rice (simple)
        # Real data: 100 ppl. Qorma 24kg, Biryani 10kg
        self._create_menu(
            'Royal Heritage Spread',
            'Curry and rice — simple baseline',
            dishes,
            [
                ('Mutton Qorma', 240),
                ('Chicken Biryani', 100),
                ('Fresh Green Salad', 40),
                ('Macaroni Salad', 60),
                ('Raita', 40),
                ('Assorted Naan', 1.25),
                ('Fruit Trifle', 80),
                ('Green Tea', 1),
            ],
        )

        # 3. Majestic Celebration Banquet — the baseline standard menu
        # Calibrated from real catering data: BBQ 330g, curry 190g, rice 70g
        self._create_menu(
            'Majestic Celebration Banquet',
            'Heavy BBQ and curry — the standard baseline menu',
            dishes,
            [
                ('Mutton Seekh Kabab', 130),
                ('Chicken Tandoori Boti', 200),
                ('Mutton Qorma', 120),
                ('Lahori Chicken Karahi', 70),
                ('Matka Biryani', 70),
                ('Fresh Green Salad', 50),
                ('Macaroni Salad', 50),
                ('Raita', 40),
                ('Assorted Naan', 1),
                ('Chocolate Mousse', 40),
                ('Halwa Petha', 100),
                ('Green Tea', 1),
            ],
        )

        # 4. Golden Evening Feast — BBQ + veg curry (casual)
        # Real data: 100 ppl. Seekh 20kg, Aaloo 14kg, Chanay 3kg, Salad 8kg
        self._create_menu(
            'Golden Evening Feast',
            'BBQ with veg sides — casual style',
            dishes,
            [
                ('Chicken Seekh Kabab', 200),
                ('Aaloo Achari', 140),
                ('Lahori Chanay', 30),
                ('Fresh Green Salad', 80),
                ('Puri', 1.5),
                ('Assorted Naan', 1.25),
                ('Halwa Suji', 120),
                ('Green Tea', 1),
            ],
        )

        # 5. Heritage Elegance Banquet — 3 BBQ + curry + rice (over-allocated)
        self._create_menu(
            'Heritage Elegance Banquet',
            '3 BBQ items, curry, and rice — over-allocated, engine should correct',
            dishes,
            [
                ('Whole Mutton Roast', 110),
                ('Chicken Boti Tikka', 110),
                ('Seekh Kabab', 110),
                ('Mutton Qorma', 95),
                ('Chicken Qorma', 95),
                ('Chicken Biryani', 70),
                ('Zarda', 140),
                ('Fresh Green Salad', 50),
                ('Raita', 40),
                ('Assorted Naan', 1),
                ('Green Tea', 1),
            ],
        )

        # 6. Timeless Royal Spread — heavy BBQ + curry + rice + veg (over-allocated)
        self._create_menu(
            'Timeless Royal Spread',
            'Heavy BBQ, curry, rice, and veg sides — over-allocated, engine should correct',
            dishes,
            [
                ('Whole Mutton Roast', 100),
                ('Chicken Boti Tikka', 100),
                ('Mutton Seekh Kabab', 100),
                ('Chicken Seekh Kabab', 100),
                ('Mutton Kunna', 95),
                ('Chicken Qorma', 95),
                ('Chicken Biryani', 70),
                ('Bhagaray Baingan', 30),
                ('Khattay Aaloo', 30),
                ('Zarda', 70),
                ('Mutanjan (Special)', 70),
                ('Fresh Green Salad', 50),
                ('Raita', 40),
                ('Assorted Naan', 1),
                ('Green Tea', 1),
            ],
        )

        self.stdout.write(self.style.SUCCESS(
            f'Seeded: {DishCategory.objects.count()} categories, '
            f'{Dish.objects.count()} dishes, '
            f'{BudgetProfile.objects.count()} budget profiles, '
            f'{MenuTemplate.objects.count()} templates'
        ))

    def _create_menu(self, name, description, dishes, dish_portions):
        menu, created = MenuTemplate.objects.get_or_create(
            name=name,
            defaults={
                'description': description,
                'default_gents': 50,
                'default_ladies': 50,
            }
        )
        if created:
            for dish_name, portion in dish_portions:
                MenuDishPortion.objects.create(
                    menu=menu, dish=dishes[dish_name], portion_grams=portion
                )
