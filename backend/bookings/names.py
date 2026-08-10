"""Splitting and composing person names.

The single display name ('Batool Rizvi') stays the stored, searchable,
sortable column; first/last are the structured parts used for addressing
people properly (greetings, titles). One rule, used by the data migration
and by model save() alike: the last word is the surname, everything before
it is the first name; a single word is a first name with no surname.
"""


# How we may address someone, when they've told us. Shared by Lead and Contact
# so a lead converting into a customer keeps the same vocabulary — and so the
# frontend has one list to mirror (frontend/lib/titles.ts).
TITLE_CHOICES = [
    ('Mr', 'Mr'), ('Mrs', 'Mrs'), ('Ms', 'Ms'), ('Miss', 'Miss'),
    ('Dr', 'Dr'), ('Prof', 'Prof'),
]


def split_full_name(full):
    """Last word is the surname, everything before it the first name.

    'Batool Rizvi'      -> ('Batool', 'Rizvi')
    'Batool Rizvi Khan' -> ('Batool Rizvi', 'Khan')
    'Batool'            -> ('Batool', '')
    """
    parts = (full or '').strip().split()
    if not parts:
        return '', ''
    if len(parts) == 1:
        return parts[0], ''
    return ' '.join(parts[:-1]), parts[-1]


def compose_full_name(first, last):
    """Join non-empty parts: ('Batool', 'Rizvi') -> 'Batool Rizvi'."""
    return ' '.join(p.strip() for p in (first or '', last or '') if p and p.strip())
