from decimal import Decimal

from django.core.management.base import BaseCommand

from dishes.models import DishCategory


# Placeholder surcharge values (PKR) — adjust via admin after running
SURCHARGES = {
    'dry_barbecue': {'addition': Decimal('100'), 'removal': Decimal('25')},
    'curry':        {'addition': Decimal('75'),  'removal': Decimal('25')},
    'rice':         {'addition': Decimal('75'),  'removal': Decimal('25')},
    'veg_curry':    {'addition': Decimal('50'),  'removal': Decimal('15')},
    'side':         {'addition': Decimal('40'),  'removal': Decimal('10')},
    'salad':        {'addition': Decimal('30'),  'removal': Decimal('10')},
    'condiment':    {'addition': Decimal('20'),  'removal': Decimal('5')},
    'dessert':      {'addition': Decimal('75'),  'removal': Decimal('25')},
    'bread':        {'addition': Decimal('30'),  'removal': Decimal('10')},
    'tea':          {'addition': Decimal('20'),  'removal': Decimal('5')},
}


class Command(BaseCommand):
    help = 'Seed addition_surcharge and removal_discount on DishCategory'

    def handle(self, *args, **options):
        updated = 0
        for cat_name, values in SURCHARGES.items():
            try:
                cat = DishCategory.objects.get(name=cat_name)
            except DishCategory.DoesNotExist:
                self.stderr.write(self.style.WARNING(f'  Category not found: {cat_name}'))
                continue

            cat.addition_surcharge = values['addition']
            cat.removal_discount = values['removal']
            cat.save(update_fields=['addition_surcharge', 'removal_discount'])
            updated += 1
            self.stdout.write(
                f'  {cat.display_name}: +{values["addition"]} / -{values["removal"]}'
            )

        self.stdout.write(self.style.SUCCESS(
            f'Done — updated {updated} categories'
        ))
