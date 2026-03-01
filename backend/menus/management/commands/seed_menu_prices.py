from decimal import Decimal

from django.core.management.base import BaseCommand

from dishes.models import Dish, DishCategory, ProteinType
from menus.models import MenuDishPortion, MenuTemplate, MenuTemplatePriceTier


# HR-Outdoor spreadsheet data
# Barat/Walima menus: tiers at 50, 100, 200 pax
BARAT_MENUS = [
    {
        'name': 'Golden Elegance Feast',
        'tiers': {50: 2750, 100: 2450, 200: 2350},
    },
    {
        'name': 'Royal Heritage Spread',
        'tiers': {50: 3250, 100: 3000, 200: 2500},
    },
    {
        'name': 'Majestic Celebration Banquet',
        'tiers': {50: 3800, 100: 3600, 200: 3050},
    },
    {
        'name': 'Opulent Legacy Feast',
        'tiers': {50: 4150, 100: 3900, 200: 3400},
    },
    {
        'name': 'Grand Imperial Feast',
        'tiers': {50: 4650, 100: 4400, 200: 3900},
    },
    {
        'name': 'Heritage Elegance Banquet',
        'tiers': {50: 5000, 100: 4750, 200: 4250},
    },
    {
        'name': 'Timeless Royal Spread',
        'tiers': {50: 5500, 100: 5000, 200: 4500},
    },
]

# Mehndi/Mayon menus: tiers at 50, 100, 200, 300 pax
MEHNDI_MENUS = [
    {
        'name': 'Golden Evening Feast',
        'tiers': {50: 2500, 100: 2250, 200: 2000, 300: 1750},
    },
    {
        'name': 'Colors of Tradition',
        'tiers': {50: 3000, 100: 2850, 200: 2500, 300: 2250},
    },
    {
        'name': 'Moonlit Celebration',
        'tiers': {50: 3200, 100: 2950, 200: 2650, 300: 2450},
    },
    {
        'name': 'Blossoms of Joy',
        'tiers': {50: 3600, 100: 3350, 200: 3100, 300: 2850},
    },
    {
        'name': 'Royal Festive Banquet',
        'tiers': {50: 4100, 100: 3850, 200: 3600, 300: 3350},
    },
    {
        'name': 'Magic of Celebration',
        'tiers': {50: 5000, 100: 4450, 200: 4200, 300: 3950},
    },
]

# ── New dishes to create (not already in seed_data) ──────────────────────
# Format: (name, category_name, protein_type, default_portion_grams)
NEW_DISHES = [
    # Dry / Barbecue
    ('Reshmi Seekh Kabab', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Chicken Malai Boti', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Chicken Shashlik BBQ', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Meerath Kabab', 'dry_barbecue', ProteinType.VEAL, 100),
    ('Kafta Kabab', 'dry_barbecue', ProteinType.BEEF, 100),
    ('Gola Kabab', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Chicken Hazari Kabab', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Behari Kabab', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Tawa Lacha Chicken', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Chicken Satay', 'dry_barbecue', ProteinType.CHICKEN, 100),
    ('Chicken Haryali Boti', 'dry_barbecue', ProteinType.CHICKEN, 100),
    # Curry
    ('Chicken White Karahi', 'curry', ProteinType.CHICKEN, 120),
    ('Mutton Shahi Qorma', 'curry', ProteinType.MUTTON, 120),
    ('Chicken Karahi', 'curry', ProteinType.CHICKEN, 120),
    ('Dum Qeema', 'curry', ProteinType.CHICKEN, 120),
    # Veg curry
    ('Mian Jee Daal', 'veg_curry', ProteinType.NONE, 110),
    ('Makhani Chanay', 'veg_curry', ProteinType.NONE, 110),
    ('Bombay Chanay', 'veg_curry', ProteinType.NONE, 110),
    # Salad
    ('Potato Salad', 'salad', ProteinType.NONE, 50),
    ('Bean Salad', 'salad', ProteinType.NONE, 50),
    # Condiment
    ('Mint Raita', 'condiment', ProteinType.NONE, 40),
    ('Zeera Raita', 'condiment', ProteinType.NONE, 40),
    ('Kachumer Raita', 'condiment', ProteinType.NONE, 40),
    # Bread
    ('Puri Paratha', 'bread', ProteinType.NONE, 1),
    # Dessert
    ('Halwa Suji Badami', 'dessert', ProteinType.NONE, 70),
    ('Halwa Suji (Gulabi)', 'dessert', ProteinType.NONE, 70),
    ('Caramel Crunch Ice Cream', 'dessert', ProteinType.NONE, 80),
    ('Fruit Custard', 'dessert', ProteinType.NONE, 80),
]

# ── Dish assignments per menu (HR-Outdoor spreadsheet) ───────────────────
# Where spreadsheet shows alternatives ("X / Y"), the first option is used.
MENU_DISHES = {
    # ── Barat / Walima ──
    'Golden Elegance Feast': [
        'Chicken Seekh Kabab',
        'Chicken Qorma',
        'Chicken Biryani',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Raita',
        'Assorted Naan',
        'Fruit Trifle',
        'Green Tea',
    ],
    'Royal Heritage Spread': [
        'Mutton Qorma',
        'Chicken Biryani',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Raita',
        'Assorted Naan',
        'Fruit Trifle',
        'Green Tea',
    ],
    'Majestic Celebration Banquet': [
        'Mutton Seekh Kabab',
        'Chicken Tandoori Boti',
        'Mutton Qorma',
        'Matka Biryani',
        'Lahori Chicken Karahi',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Raita',
        'Assorted Naan',
        'Chocolate Mousse',
        'Halwa Petha',
        'Green Tea',
    ],
    'Opulent Legacy Feast': [
        'Reshmi Seekh Kabab',
        'Chicken Malai Boti',
        'Mutton Shahi Qorma',
        'Veal Kabuli Pulao',
        'Palak Paneer',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Potato Salad',
        'Raita',
        'Assorted Naan',
        'Caramel Crunch',
        'Halwa Petha',
        'Green Tea',
    ],
    'Grand Imperial Feast': [
        'Meerath Kabab',
        'Chicken Shashlik BBQ',
        'Lahori Fried Fish',
        'Mutton Badami Qorma',
        'Chicken White Karahi',
        'Mutton Pulao',
        'Mian Jee Daal',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Potato Salad',
        'Raita',
        'Assorted Naan',
        'Fruit Trifle',
        'Halwa Petha',
        'Caramel Crunch',
        'Green Tea',
    ],
    'Heritage Elegance Banquet': [
        'Kafta Kabab',
        'Beef Afghani Boti',
        'Crumb Fried Fish',
        'Mutton Rezala',
        'Bombay Chicken',
        'Veal Kabuli Pulao',
        'Mirchi Ka Salan',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Cabbage Salad with Apple & Walnuts',
        'Raita',
        'Assorted Naan',
        'Fruit Trifle',
        'Halwa Petha',
        'Caramel Crunch',
        'Green Tea',
    ],
    'Timeless Royal Spread': [
        'Turkish Kabab',
        'Lebanese Boti',
        'Veal Foil Roast',
        'Mutton Kunna',
        'Chicken Handi (With Bone)',
        'Mutton Bukhara Pulao',
        'Bhagaray Baingan',
        'Fresh Green Salad',
        'Greek Village Salad',
        'Pasta Salad',
        'Waldorf Salad',
        'Raita',
        'Assorted Naan',
        'Fruit Trifle',
        'Halwa Petha',
        'Caramel Crunch',
        'Cream Caramel',
        'Green Tea',
    ],
    # ── Mehndi / Mayon ──
    'Golden Evening Feast': [
        'Chicken Seekh Kabab',
        'Aaloo Achari',
        'Lahori Chanay',
        'Fresh Green Salad',
        'Puri',
        'Assorted Naan',
        'Halwa Suji',
        'Green Tea',
    ],
    'Colors of Tradition': [
        'Reshmi Seekh Kabab',
        'Khattay Aaloo',
        'Makhani Chanay',
        'Chicken Biryani',
        'Fresh Green Salad',
        'Bean Salad',
        'Mint Raita',
        'Puri',
        'Assorted Naan',
        'Halwa Suji Badami',
        'Fruit Trifle',
        'Green Tea',
    ],
    'Moonlit Celebration': [
        'Gola Kabab',
        'Lahori Chicken Karahi',
        'Bombay Chanay',
        'Chicken Sindhi Biryani',
        'Fresh Green Salad',
        'Bean Salad',
        'Kachumer Raita',
        'Puri',
        'Assorted Naan',
        'Halwa Suji (Gulabi)',
        'Gajar Halwa',
        'Green Tea',
    ],
    'Blossoms of Joy': [
        'Chicken Hazari Kabab',
        'Chicken Boti Tikka',
        'Chicken Karahi',
        'Lahori Chanay',
        'Matka Biryani',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Bean Salad',
        'Zeera Raita',
        'Puri',
        'Assorted Naan',
        'Halwa Suji',
        'Gajar Halwa',
        'Green Tea',
    ],
    'Royal Festive Banquet': [
        'Behari Kabab',
        'Chicken Malai Boti',
        'Tawa Lacha Chicken',
        'Bombay Chicken',
        'Chicken Pulao',
        'Fresh Green Salad',
        'Pasta Salad',
        'Potato Salad',
        'Zeera Raita',
        'Puri Paratha',
        'Caramel Crunch Ice Cream',
        'Gulab Jaman',
        'Assorted Naan',
        'Green Tea',
    ],
    'Magic of Celebration': [
        'Chicken Satay',
        'Turkish Kabab',
        'Chicken Haryali Boti',
        'Mutton Karahi',
        'Dum Qeema',
        'Chicken Biryani',
        'Fresh Green Salad',
        'Macaroni Salad',
        'Waldorf Salad',
        'Raita',
        'Puri Paratha',
        'Fruit Custard',
        'Gajar Halwa',
        'Kheer',
        'Assorted Naan',
        'Green Tea',
    ],
}


class Command(BaseCommand):
    help = 'Seed menu template price tiers and dish assignments from HR-Outdoor spreadsheet'

    def handle(self, *args, **options):
        created_menus = 0
        created_tiers = 0

        # ── 1. Create menus and price tiers ──
        for menu_data in BARAT_MENUS:
            menu, was_created = MenuTemplate.objects.get_or_create(
                name=menu_data['name'],
                defaults={'menu_type': 'barat'},
            )
            if was_created:
                created_menus += 1
                self.stdout.write(f'  Created menu: {menu.name}')
            elif menu.menu_type != 'barat':
                menu.menu_type = 'barat'
                menu.save(update_fields=['menu_type'])
                self.stdout.write(f'  Updated type: {menu.name} -> barat')

            for min_guests, price in menu_data['tiers'].items():
                _, tier_created = MenuTemplatePriceTier.objects.get_or_create(
                    menu=menu,
                    min_guests=min_guests,
                    defaults={'price_per_head': Decimal(str(price))},
                )
                if tier_created:
                    created_tiers += 1

        for menu_data in MEHNDI_MENUS:
            menu, was_created = MenuTemplate.objects.get_or_create(
                name=menu_data['name'],
                defaults={'menu_type': 'mehndi'},
            )
            if was_created:
                created_menus += 1
                self.stdout.write(f'  Created menu: {menu.name}')
            elif menu.menu_type != 'mehndi':
                menu.menu_type = 'mehndi'
                menu.save(update_fields=['menu_type'])
                self.stdout.write(f'  Updated type: {menu.name} -> mehndi')

            for min_guests, price in menu_data['tiers'].items():
                _, tier_created = MenuTemplatePriceTier.objects.get_or_create(
                    menu=menu,
                    min_guests=min_guests,
                    defaults={'price_per_head': Decimal(str(price))},
                )
                if tier_created:
                    created_tiers += 1

        self.stdout.write(self.style.SUCCESS(
            f'Tiers: created {created_menus} menus, {created_tiers} price tiers'
        ))

        # ── 2. Create new dishes ──
        created_dishes = 0
        cat_cache = {}
        for name, cat_name, protein, portion in NEW_DISHES:
            if cat_name not in cat_cache:
                cat_cache[cat_name] = DishCategory.objects.get(name=cat_name)
            _, was_created = Dish.objects.get_or_create(
                name=name,
                defaults={
                    'category': cat_cache[cat_name],
                    'protein_type': protein,
                    'default_portion_grams': portion,
                },
            )
            if was_created:
                created_dishes += 1
                self.stdout.write(f'  Created dish: {name}')

        self.stdout.write(self.style.SUCCESS(
            f'Dishes: created {created_dishes} new dishes'
        ))

        # ── 3. Assign dishes to menus ──
        assigned = 0
        removed = 0
        for menu_name, dish_names in MENU_DISHES.items():
            menu = MenuTemplate.objects.get(name=menu_name)
            desired_dishes = list(Dish.objects.filter(name__in=dish_names))

            # Verify all dishes were found
            found_names = {d.name for d in desired_dishes}
            missing = set(dish_names) - found_names
            if missing:
                self.stderr.write(
                    self.style.ERROR(f'  {menu_name}: missing dishes: {missing}')
                )
                continue

            desired_ids = {d.id for d in desired_dishes}
            existing_portions = MenuDishPortion.objects.filter(menu=menu)
            existing_ids = {p.dish_id for p in existing_portions}

            # Remove dishes not in the spreadsheet
            to_remove = existing_ids - desired_ids
            if to_remove:
                count = MenuDishPortion.objects.filter(
                    menu=menu, dish_id__in=to_remove,
                ).delete()[0]
                removed += count
                self.stdout.write(f'  {menu_name}: removed {count} old dish(es)')

            # Add missing dishes
            for dish in desired_dishes:
                if dish.id not in existing_ids:
                    MenuDishPortion.objects.create(
                        menu=menu,
                        dish=dish,
                        portion_grams=dish.default_portion_grams,
                    )
                    assigned += 1

            dish_count = MenuDishPortion.objects.filter(menu=menu).count()
            self.stdout.write(f'  {menu_name}: {dish_count} dishes')

        self.stdout.write(self.style.SUCCESS(
            f'Assignments: added {assigned}, removed {removed}'
        ))
