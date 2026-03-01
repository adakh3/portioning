from decimal import Decimal

from django.core.management.base import BaseCommand

from menus.models import MenuTemplate, MenuTemplatePriceTier


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


class Command(BaseCommand):
    help = 'Seed menu template price tiers from HR-Outdoor spreadsheet'

    def handle(self, *args, **options):
        created_menus = 0
        created_tiers = 0

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
                self.stdout.write(f'  Updated type: {menu.name} → barat')

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
                self.stdout.write(f'  Updated type: {menu.name} → mehndi')

            for min_guests, price in menu_data['tiers'].items():
                _, tier_created = MenuTemplatePriceTier.objects.get_or_create(
                    menu=menu,
                    min_guests=min_guests,
                    defaults={'price_per_head': Decimal(str(price))},
                )
                if tier_created:
                    created_tiers += 1

        self.stdout.write(self.style.SUCCESS(
            f'Done — created {created_menus} menus, {created_tiers} price tiers'
        ))
