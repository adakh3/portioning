"""The US starter catalog seeds a usable, isolated, idempotent per-org catalog,
and the calculator works against it out of the box."""
from django.core.management import call_command
from django.test import TestCase

from users.models import Organisation
from dishes.models import Dish, DishCategory
from menus.models import MenuTemplate
from bookings.models.addons import AddOnProduct
from staff.models import LaborRole
from rules.models import GlobalConfig, BudgetProfile


def seed(org_name, country='US'):
    org, _ = Organisation.objects.get_or_create(
        name=org_name, defaults={'slug': org_name.lower().replace(' ', '-'), 'country': country})
    call_command('seed_starter_catalog', '--org', org_name, verbosity=0)
    return org


class StarterCatalogTests(TestCase):
    def test_creates_a_usable_catalog(self):
        org = seed('Acme Catering')
        self.assertEqual(DishCategory.objects.filter(organisation=org).count(), 6)
        self.assertEqual(Dish.objects.filter(organisation=org).count(), 18)
        self.assertEqual(MenuTemplate.objects.filter(organisation=org).count(), 2)
        self.assertTrue(AddOnProduct.objects.filter(organisation=org).exists())
        self.assertTrue(LaborRole.objects.filter(organisation=org, name='Server').exists())
        self.assertTrue(GlobalConfig.objects.filter(organisation=org).exists())
        self.assertTrue(BudgetProfile.objects.filter(organisation=org, is_default=True).exists())

    def test_isolated_between_orgs(self):
        a = seed('Org A')
        b = seed('Org B')
        # Both orgs have their own copy — per-org uniqueness holds (would have
        # failed under the old global-unique category/role names).
        self.assertEqual(Dish.objects.filter(organisation=a).count(), 18)
        self.assertEqual(Dish.objects.filter(organisation=b).count(), 18)
        a_dish_ids = set(Dish.objects.filter(organisation=a).values_list('id', flat=True))
        b_dish_ids = set(Dish.objects.filter(organisation=b).values_list('id', flat=True))
        self.assertFalse(a_dish_ids & b_dish_ids)  # no shared rows

    def test_idempotent(self):
        org = seed('Repeat Co')
        call_command('seed_starter_catalog', '--org', 'Repeat Co', verbosity=0)
        self.assertEqual(Dish.objects.filter(organisation=org).count(), 18)  # no dupes

    def test_starter_dishes_arrive_tagged(self):
        # A new US org's catalog answers "what's gluten-free / nut-free?" on day
        # one instead of shipping 18 untagged dishes.
        org = seed('Tagged Co')
        salmon = Dish.objects.get(organisation=org, name='Baked Salmon')
        self.assertEqual(
            set(salmon.dietary_tags.values_list('slug', flat=True)),
            {'gluten_free', 'dairy_free', 'fish'},
        )
        untagged = [d.name for d in Dish.objects.filter(organisation=org)
                    if not d.dietary_tags.exists()]
        self.assertEqual(untagged, [])

    def test_reseeding_never_clobbers_curated_tags(self):
        # An org that corrected a dish's tags must keep that correction when the
        # catalog seeder runs again.
        org = seed('Curated Co')
        salmon = Dish.objects.get(organisation=org, name='Baked Salmon')
        salmon.dietary_tags.set(salmon.dietary_tags.exclude(slug='dairy_free'))
        call_command('seed_starter_catalog', '--org', 'Curated Co', verbosity=0)
        self.assertNotIn('dairy_free',
                         set(salmon.dietary_tags.values_list('slug', flat=True)))

    def test_calculator_works_on_a_starter_menu(self):
        org = seed('Calc Co')
        menu = MenuTemplate.objects.filter(organisation=org, name='Corporate Lunch Buffet').first()
        dish_ids = list(menu.portions.values_list('dish_id', flat=True))
        from calculator.engine.calculator import calculate_portions
        result = calculate_portions(dish_ids, {'gents': 50, 'ladies': 50}, org=org)
        self.assertTrue(result['portions'])  # produced per-dish portions
        self.assertGreater(result['totals']['total_food_weight_grams'], 0)

    def test_the_wedding_template_arrives_coursed_and_the_buffet_flat(self):
        """The two starters are deliberately different shapes.

        A caterer meets both states of the booking's menu card on day one: a flat
        list, and one already grouped into courses. Before this, every seeded
        template was course-less, so the template→booking course carry-over
        (REL-417) had nothing to carry.
        """
        org = seed('Shapes Co')

        flat = MenuTemplate.objects.get(organisation=org, name='Corporate Lunch Buffet')
        self.assertEqual(flat.courses.count(), 0)
        self.assertTrue(all(p.course_id is None for p in flat.portions.all()))

        coursed = MenuTemplate.objects.get(organisation=org, name='Wedding Reception Dinner')
        self.assertEqual(
            list(coursed.courses.values_list('name', flat=True)),
            ['Starter', 'Main', 'Dessert'],
        )
        by_course = {}
        for p in coursed.portions.select_related('dish', 'course'):
            by_course.setdefault(p.course.name if p.course else None, set()).add(p.dish.name)
        self.assertEqual(by_course['Starter'], {'Bruschetta', 'Caesar Salad'})
        self.assertEqual(by_course['Main'], {
            'Roast Beef', 'Baked Salmon', 'Mashed Potatoes', 'Roasted Seasonal Vegetables'})
        self.assertEqual(by_course['Dessert'], {'New York Cheesecake'})
        # One dish is deliberately un-coursed — the booking renders it "On the table".
        self.assertEqual(by_course[None], {'Dinner Rolls'})

    def test_courses_are_per_org_and_not_duplicated_on_reseed(self):
        org = seed('Reseed Co')
        call_command('seed_starter_catalog', '--org', 'Reseed Co', verbosity=0)
        coursed = MenuTemplate.objects.get(organisation=org, name='Wedding Reception Dinner')
        self.assertEqual(coursed.courses.count(), 3)

    def test_backfills_courses_onto_a_template_seeded_before_they_existed(self):
        """An org seeded before courses existed keeps a course-less template
        forever, because `created` is False on every re-seed. Without a backfill
        the coursed shape would only ever reach brand-new orgs."""
        org = seed('Legacy Co')
        coursed = MenuTemplate.objects.get(organisation=org, name='Wedding Reception Dinner')
        # Simulate the pre-courses state.
        coursed.portions.update(course=None)
        coursed.courses.all().delete()
        self.assertEqual(coursed.courses.count(), 0)

        call_command('seed_starter_catalog', '--org', 'Legacy Co', verbosity=0)

        self.assertEqual(
            list(coursed.courses.values_list('name', flat=True)),
            ['Starter', 'Main', 'Dessert'],
        )
        placed = {p.dish.name: (p.course.name if p.course else None)
                  for p in coursed.portions.select_related('dish', 'course')}
        self.assertEqual(placed['Roast Beef'], 'Main')
        self.assertEqual(placed['New York Cheesecake'], 'Dessert')
        self.assertIsNone(placed['Dinner Rolls'])

    def test_backfill_never_overrides_an_orgs_own_grouping(self):
        """If the org has already grouped this menu its own way, that is theirs."""
        org = seed('Curated Courses Co')
        coursed = MenuTemplate.objects.get(organisation=org, name='Wedding Reception Dinner')
        coursed.courses.all().delete()
        from menus.models import MenuCourse
        mine = MenuCourse.objects.create(menu=coursed, name='Our own course', sort_order=0)
        coursed.portions.update(course=mine)

        call_command('seed_starter_catalog', '--org', 'Curated Courses Co', verbosity=0)

        self.assertEqual(list(coursed.courses.values_list('name', flat=True)), ['Our own course'])
