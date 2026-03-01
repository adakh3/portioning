from decimal import Decimal

from django.core.management.base import BaseCommand

from dishes.models import Dish


# Item Wise Cost spreadsheet — PKR costs
# KG items:  cost_per_gram = PKR_per_KG / 1000
# Per-unit items (Naan, Puri, Tea): cost_per_gram = PKR_per_unit
#   (since portion = 1 unit, cost_per_gram stores cost-per-unit)
# Bowl items: treated as ~1 KG equivalent (per industry serving bowl)
# Inner items: treated as ~2.5 KG equivalent
DISH_COSTS = {
    # ── Dry / Barbecue (KG) ──
    'Beef Afghani Boti': Decimal('2.827'),         # Veal Afghani Boti 2827/KG
    'Chicken Boti Tikka': Decimal('0.811'),         # 811/KG
    'Chicken Seekh Kabab': Decimal('0.799'),        # 799/KG
    'Chicken Tandoori Boti': Decimal('0.811'),      # ~Boti Tikka 811/KG
    'Chicken with Almond': Decimal('1.367'),        # 1367/KG
    'Crumb Fried Fish': Decimal('2.213'),           # Pangasius 2213/KG
    'Lahori Fried Fish': Decimal('2.081'),          # Pangasius 2081/KG
    'Lebanese Boti': Decimal('1.181'),              # ~Haryali Boti 1181/KG
    'Mix Vegetable Bhujiyya': Decimal('0.275'),     # 275/KG
    'Mutton Foil Roast': Decimal('2.930'),          # 2930/KG
    'Mutton Leg': Decimal('3.599'),                 # 5398/1.5KG
    'Mutton Seekh Kabab': Decimal('2.044'),         # 2044/KG
    'Seekh Kabab': Decimal('1.272'),                # Veal Seekh 1272/KG
    'Shish Tawok': Decimal('1.629'),                # 1629/KG
    'Spring Roll': Decimal('1.833'),                # 55/No * ~33pcs/KG
    'Steam Roast': Decimal('0.981'),                # 981/KG
    'Tawa Fish': Decimal('2.470'),                  # Pan Fried Pangasius 2470/KG
    'Turkish Kabab': Decimal('1.469'),              # ~Chandan Kabab 1469/KG
    'Veal Foil Roast': Decimal('1.880'),            # 1880/KG
    'Whole Chicken': Decimal('0.981'),              # ~Steam Roast 981/KG
    'Whole Lamb Roast': Decimal('3.016'),           # 31668/10.5KG
    'Whole Mutton Roast': Decimal('3.067'),         # 32200/10.5KG (Special)
    # New dry/BBQ dishes
    'Reshmi Seekh Kabab': Decimal('0.871'),         # 871/KG
    'Chicken Malai Boti': Decimal('1.181'),         # 1181/KG (boneless)
    'Chicken Shashlik BBQ': Decimal('1.412'),       # 1412/KG
    'Meerath Kabab': Decimal('1.511'),              # ~Veal Cheese Kabab 1511/KG
    'Kafta Kabab': Decimal('1.182'),                # ~Chicken Chapli Kabab 1182/KG
    'Gola Kabab': Decimal('1.029'),                 # Chicken Gola Kabab 1029/KG
    'Chicken Hazari Kabab': Decimal('0.799'),       # ~Chicken Seekh Kabab 799/KG
    'Behari Kabab': Decimal('1.228'),               # Chicken Behari Kabab 1228/KG
    'Tawa Lacha Chicken': Decimal('0.972'),         # ~Chicken Lahori Karahi 972/KG
    'Chicken Satay': Decimal('1.465'),              # Grilled Chicken Satay 1465/KG
    'Chicken Haryali Boti': Decimal('1.181'),       # 1181/KG

    # ── Curry (KG) ──
    'Aaloo Chicken': Decimal('0.857'),              # 857/KG
    'Beef Haleem': Decimal('0.967'),                # Veal Haleem 967/KG
    'Bombay Chicken': Decimal('1.100'),             # Chicken Bohri Fried 1100/KG
    'Chicken Chanay': Decimal('1.033'),             # Murgh Cholay 1033/KG
    'Chicken Curry': Decimal('0.832'),              # 832/KG
    'Chicken Haleem': Decimal('0.537'),             # 537/KG
    'Chicken Handi': Decimal('1.291'),              # Chicken Handi Boneless 1291/KG
    'Chicken Handi (With Bone)': Decimal('1.429'),  # Chef Special 1429/KG
    'Chicken Qorma': Decimal('0.923'),              # 923/KG
    'Kofta Curry': Decimal('1.518'),                # Veal Kofta Curry 1518/KG
    'Lahori Chicken Karahi': Decimal('0.972'),      # 972/KG
    'Lamb Shinwari Karahi': Decimal('3.077'),       # 3077/KG
    'Mutton Badami Qorma': Decimal('2.662'),        # 2662/KG
    'Mutton Karahi': Decimal('2.606'),              # Mutton Lahori Karahi 2606/KG
    'Mutton Kunna': Decimal('3.437'),               # 3437/KG
    'Mutton Paye': Decimal('2.064'),                # Mutton Kunna Paye 2064/KG
    'Mutton Qorma': Decimal('2.558'),               # 2558/KG
    'Mutton Rezala': Decimal('2.600'),              # ~Mutton Shahi Qorma 2600/KG
    'Mutton Shinwari Karahi': Decimal('2.617'),     # 2617/KG
    'Mutton White Qorma': Decimal('2.780'),         # 2780/KG
    'Veal Qorma': Decimal('1.538'),                 # 1538/KG
    # New curries
    'Chicken White Karahi': Decimal('1.183'),       # 1183/KG
    'Mutton Shahi Qorma': Decimal('2.600'),         # 2600/KG
    'Chicken Karahi': Decimal('1.225'),             # Boneless 1225/KG
    'Dum Qeema': Decimal('1.225'),                  # Chicken Tawa Qeema 1225/KG

    # ── Rice (KG) ──
    'Arabic Rice': Decimal('0.453'),                # ~White Rice 453/KG
    'Chana Pulao': Decimal('0.727'),                # 727/KG
    'Chicken Biryani': Decimal('1.377'),            # 1377/KG
    'Chicken Fried Rice': Decimal('0.833'),         # 833/KG
    'Chicken Pulao': Decimal('1.323'),              # 1323/KG
    'Chicken Sindhi Biryani': Decimal('1.392'),     # 1392/KG
    'Egg Fried Rice': Decimal('0.607'),             # 607/KG
    'Matka Biryani': Decimal('1.676'),              # 1676/KG
    'Mutton Bukhara Pulao': Decimal('2.947'),       # 2947/KG
    'Mutton Pulao': Decimal('2.957'),               # 2957/KG
    'Peas Pulao': Decimal('0.687'),                 # 687/KG
    'Singaporean Rice': Decimal('1.134'),           # 1134/KG
    'Veal Biryani': Decimal('1.840'),               # 1840/KG
    'Veal Kabuli Pulao': Decimal('1.776'),          # 1776/KG
    'Vegetable Biryani': Decimal('0.758'),          # 758/KG
    'Vegetable Fried Rice': Decimal('0.557'),       # 557/KG
    'Vegetable Pulao': Decimal('0.705'),            # 705/KG

    # ── Veg Curry (KG) ──
    'Aaloo Achari': Decimal('0.320'),               # 320/KG
    'Curry Pakora': Decimal('0.383'),               # Karhi Pakora 383/KG
    'Daal Chana': Decimal('0.575'),                 # Daal Mix 575/KG
    'Lahori Chanay': Decimal('1.243'),              # 1243/KG
    'Lobia': Decimal('0.466'),                      # White Beans 466/KG
    'Mix Daal': Decimal('0.575'),                   # 575/KG
    'Palak Paneer': Decimal('0.506'),               # 506/KG
    # New veg curries
    'Mian Jee Daal': Decimal('0.650'),              # Mian Jee Style 650/KG
    'Makhani Chanay': Decimal('1.243'),             # 1243/KG
    'Bombay Chanay': Decimal('1.243'),              # ~Lahori Chanay 1243/KG

    # ── Sides (KG) ──
    'Aaloo Bukharay ke Chutney': Decimal('1.500'),  # 1500/KG
    'Bhagaray Baingan': Decimal('0.768'),           # 768/KG
    'Bhindi Fry': Decimal('0.495'),                 # Bhindi Masala 495/KG
    'Khattay Aaloo': Decimal('0.267'),              # 267/KG
    'Mirchi Ka Salan': Decimal('0.874'),            # 874/KG

    # ── Dessert ──
    'Bread Pudding': Decimal('1.244'),              # Bowl=1244 -> ~1244/KG
    'Caramel Crunch': Decimal('0.466'),             # Inner=1165 / 2.5KG
    'Chocolate Mousse': Decimal('1.825'),           # Bowl=1825 -> ~1825/KG
    'Cream Caramel': Decimal('0.924'),              # Bowl=924 -> ~924/KG
    'Fruit Trifle': Decimal('0.667'),               # Inner=1668 / 2.5KG
    'Gajar Halwa': Decimal('0.674'),                # 674/KG
    'Gulab Jaman': Decimal('0.695'),                # 695/KG
    'Halwa Petha': Decimal('0.873'),                # 873/KG (Desi Ghee)
    'Halwa Suji': Decimal('0.350'),                 # 350/KG
    'Hyderabadi Shahi Tukray': Decimal('0.706'),    # 1765/No -> ~2.5KG platter
    'Ice Cream': Decimal('0.436'),                  # Kulfa 436/KG
    'Kheer': Decimal('0.340'),                      # Bowl=340 -> ~340/KG
    'Mutanjan (Special)': Decimal('0.876'),         # 876/KG
    'Zarda': Decimal('0.876'),                      # 876/KG
    # New desserts
    'Halwa Suji Badami': Decimal('0.300'),          # 300/KG
    'Halwa Suji (Gulabi)': Decimal('0.360'),        # 360/KG
    'Caramel Crunch Ice Cream': Decimal('0.483'),   # 483/KG
    'Fruit Custard': Decimal('0.290'),              # Inner=726 / 2.5KG

    # ── Salad (KG) ──
    'Cabbage Salad with Apple & Walnuts': Decimal('0.567'),  # 567/KG
    'Caesar Salad': Decimal('2.169'),               # 2169/KG
    'Fresh Green Salad': Decimal('0.179'),          # 179/KG
    'Greek Village Salad': Decimal('0.726'),        # 726/KG
    'Macaroni Salad': Decimal('0.748'),             # 748/KG
    'Pasta Salad': Decimal('0.738'),                # 738/KG
    'Waldorf Salad': Decimal('1.547'),              # 1547/KG
    # New salads
    'Potato Salad': Decimal('0.524'),               # 524/KG
    'Bean Salad': Decimal('0.807'),                 # 807/KG

    # ── Condiment (KG) ──
    'Raita': Decimal('0.249'),                      # 249/KG
    'Mint Raita': Decimal('0.249'),                 # ~Raita 249/KG
    'Zeera Raita': Decimal('0.249'),                # ~Raita 249/KG
    'Kachumer Raita': Decimal('0.249'),             # ~Raita 249/KG

    # ── Bread (per unit) ──
    'Assorted Naan': Decimal('35'),                 # Roghni+Plain 35/No
    'Puri': Decimal('36'),                          # 36/No
    'Puri Paratha': Decimal('120'),                 # 120/No

    # ── Tea (per unit) ──
    'Green Tea': Decimal('22'),                     # 22/No
}


class Command(BaseCommand):
    help = 'Update dish cost_per_gram to PKR values from Item Wise Cost spreadsheet'

    def handle(self, *args, **options):
        updated = 0
        not_found = []

        for dish_name, cost in DISH_COSTS.items():
            try:
                dish = Dish.objects.get(name=dish_name)
            except Dish.DoesNotExist:
                not_found.append(dish_name)
                continue

            old_cost = dish.cost_per_gram
            dish.cost_per_gram = cost
            dish.save()  # triggers selling_price_per_gram recalculation
            updated += 1
            self.stdout.write(
                f'  {dish_name}: {old_cost} -> {cost}'
            )

        if not_found:
            self.stderr.write(self.style.WARNING(
                f'Not found in DB ({len(not_found)}): {", ".join(not_found)}'
            ))

        self.stdout.write(self.style.SUCCESS(
            f'Done — updated {updated} dishes'
        ))
