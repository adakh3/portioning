"""Splitting and composing person names.

The single display name ('Batool Rizvi') stays the stored, searchable,
sortable column; first/last are the structured parts used for addressing
people properly (greetings, titles). One rule, used by the data migration
and by model save() alike: only an exactly-two-word name is split — anything
else is left for a human to structure.
"""


def split_full_name(full):
    """'Batool Rizvi' -> ('Batool', 'Rizvi'); anything else -> ('', '')."""
    parts = (full or '').strip().split()
    if len(parts) == 2:
        return parts[0], parts[1]
    return '', ''


def compose_full_name(first, last):
    """Join non-empty parts: ('Batool', 'Rizvi') -> 'Batool Rizvi'."""
    return ' '.join(p.strip() for p in (first or '', last or '') if p and p.strip())
