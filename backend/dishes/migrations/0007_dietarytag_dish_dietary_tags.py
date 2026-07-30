from django.db import migrations, models


# (slug, label, short_label, kind, sort_order) — the fixed vocabulary.
# Seeded HERE rather than in seed.json because seed.json is dev-only and prod
# needs these rows too. Keyed on `slug`, so re-running never duplicates and an
# org's existing links survive.
DIETARY_TAGS = [
    ('vegetarian', 'Vegetarian', 'V', 'dietary', 0),
    ('vegan', 'Vegan', 'VG', 'dietary', 1),
    ('gluten_free', 'Gluten-free', 'GF', 'dietary', 2),
    ('dairy_free', 'Dairy-free', 'DF', 'dietary', 3),
    ('halal', 'Halal', 'HAL', 'dietary', 4),
    ('kosher', 'Kosher', 'K', 'dietary', 5),
    # The FDA's 9 major allergens.
    ('milk', 'Milk', 'MLK', 'allergen', 0),
    ('eggs', 'Eggs', 'EGG', 'allergen', 1),
    ('fish', 'Fish', 'FSH', 'allergen', 2),
    ('shellfish', 'Shellfish', 'SHL', 'allergen', 3),
    ('tree_nuts', 'Tree nuts', 'NUT', 'allergen', 4),
    ('peanuts', 'Peanuts', 'PNT', 'allergen', 5),
    ('wheat', 'Wheat', 'WHT', 'allergen', 6),
    ('soy', 'Soy', 'SOY', 'allergen', 7),
    ('sesame', 'Sesame', 'SES', 'allergen', 8),
]


def seed_dietary_tags(apps, schema_editor):
    DietaryTag = apps.get_model('dishes', 'DietaryTag')
    for slug, label, short_label, kind, sort_order in DIETARY_TAGS:
        DietaryTag.objects.get_or_create(
            slug=slug,
            defaults={
                'label': label, 'short_label': short_label,
                'kind': kind, 'sort_order': sort_order,
            },
        )


def unseed_dietary_tags(apps, schema_editor):
    # Reversible for local dev. Only removes the rows this migration introduced;
    # the M2M links go with them by cascade.
    DietaryTag = apps.get_model('dishes', 'DietaryTag')
    DietaryTag.objects.filter(slug__in=[row[0] for row in DIETARY_TAGS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('dishes', '0006_alter_dish_protein_type_alter_dishcategory_name_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='DietaryTag',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=30, unique=True)),
                ('label', models.CharField(max_length=50)),
                ('short_label', models.CharField(blank=True, help_text='Compact badge text, e.g. "GF". Blank falls back to the label.', max_length=8)),
                ('kind', models.CharField(choices=[('dietary', 'Dietary'), ('allergen', 'Allergen')], default='dietary', help_text='Dietary tags read as "is" (vegan); allergens read as "contains".', max_length=10)),
                ('sort_order', models.IntegerField(default=0)),
            ],
            options={
                'ordering': ['-kind', 'sort_order', 'slug'],
            },
        ),
        migrations.AddField(
            model_name='dish',
            name='dietary_tags',
            field=models.ManyToManyField(blank=True, related_name='dishes', to='dishes.dietarytag'),
        ),
        migrations.RunPython(seed_dietary_tags, unseed_dietary_tags),
    ]
