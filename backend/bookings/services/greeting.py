"""How a client gets addressed — one rule, shared by every drafter (REL-479).

Two different drafters write to clients: `followup_drafter` (leads) and
`message_drafter` (bookings). They had two different greeting rules, and the
weaker one shipped. A real production email opened `Hello some,` because the
booking-side rule trusted `first_name` unconditionally, and `first_name` is
derived by splitting whatever single name a rep typed.

So the rule lives here now and both import it. The prompt text is lifted
verbatim from the follow-up drafter, which had thought it through — moving it
must not change what leads already receive.
"""

# Kept as one bullet so either drafter can drop it into its own rule list.
GREETING_RULE = (
    "- Open with a proper greeting: 'Hello' followed by the contact's title and "
    "surname if a title is present in the contact record (Mr, Mrs, Ms, Miss, Dr, "
    "Prof — copy the title exactly as stored, never infer or choose one based on "
    "the name). If no title is present, greet by first name (e.g. 'Hello "
    "Batool,'). If neither a title nor a first name is available, use 'Hello,' "
    "with no name. Never address someone by their bare full name.\n"
)

# Deliberately only legal-entity suffixes. A wider net (Events, Catering, Group,
# Services…) would catch more companies and also start silently refusing to greet
# real people — "Hannah Group" is a person. Over-detection costs a client their
# name; under-detection is merely today's behaviour. So: narrow, and honest about
# what it misses.
ORGANISATION_MARKERS = frozenset({
    'ltd', 'ltda', 'limited', 'llc', 'llp', 'lp', 'inc', 'incorporated',
    'plc', 'corp', 'corporation', 'gmbh', 'ag', 'bv', 'nv', 'pty', 'sarl',
    'srl', 'spa', 'oy', 'ab', 'as', 'kk', 'sa',
})


def _tokens(name):
    return [t.strip('.,()').lower() for t in (name or '').split() if t.strip('.,()')]


def looks_like_organisation(name, *, account_name=''):
    """True when this 'person' is really a company someone typed into a name field.

    Two signals, both from data rather than guesswork:

    * the name ends in a legal-entity suffix (`Acme Events Ltd`), or
    * it is exactly the linked business's name, which means the contact record
      is standing in for the account rather than naming a human.
    """
    tokens = _tokens(name)
    if not tokens:
        return False
    if tokens[-1] in ORGANISATION_MARKERS:
        return True
    if account_name and ' '.join(tokens) == ' '.join(_tokens(account_name)):
        return True
    return False


def greeting_context_lines(*, name='', title='', first_name='', last_name='', account_name=''):
    """The name facts a drafter may use, as prompt context lines.

    Returns nothing at all when there is no name — the rule's own "Hello," branch
    then applies, which is what we want rather than inventing a placeholder.
    """
    name = (name or '').strip()
    if not name and not first_name:
        return []

    lines = []
    if name:
        lines.append(f"Client name: {name}")

    if looks_like_organisation(name, account_name=account_name):
        # Withhold the parts entirely. Telling the model "first name: Acme
        # Events" and hoping the prose rule saves us is exactly how `Hello some,`
        # happened — the parts are more persuasive than the instruction.
        lines.append(
            "This client record is a business name, not a person. There is no "
            "first name or surname to use; greet with 'Hello,' and no name."
        )
        return lines

    if title:
        lines.append(f"Client title: {title}")
    if first_name:
        lines.append(f"Client first name: {first_name}")
    if last_name:
        lines.append(f"Client surname: {last_name}")
    return lines
