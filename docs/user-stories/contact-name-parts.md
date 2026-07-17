# Contact names split into first + last (leads & customers)

**As a** salesperson, **I want** contacts stored with a separate first name and
last name (plus title), **so that** messages address people properly ("Hello Ms
Rizvi") instead of guessing from a single name blob.

## How it works
- `Lead` gains `contact_first_name` / `contact_last_name`; `Contact` (customer)
  gains `first_name` / `last_name`. The single display name stays stored and is
  **composed automatically** from the parts on save — lists, search, and sorting
  are unchanged.
- Every name input in the app is now two fields (First name required, Last name
  optional): lead create form, lead detail page, leads quick-add row, and the
  account page's contact form. The AI drafter receives the parts explicitly.
- **One splitting rule everywhere** (data migration + save): the last word is
  the surname, everything before it the first name ("Batool Rizvi Khan" →
  first "Batool Rizvi", last "Khan"); a single word is a first name with no
  surname. Existing rows were backfilled by migration `bookings.0062` with the
  same rule.

## Acceptance criteria
- [ ] Creating a lead with First "Batool" + Last "Rizvi" shows "Batool Rizvi"
      everywhere the name displays; the parts round-trip on the detail page.
- [ ] Quick-add requires First name; Last name optional.
- [ ] Legacy names were split (last word = surname); one-word names became a
      first name with no surname (display still correct).
- [ ] AI drafts greet with "Hello <Title> <Surname>," when title+surname exist.

## Manual test cases
1. **Create + display:** add a lead via quick-add (First/Last), check list,
   kanban, and detail header show the full name.
2. **Legacy 3-word name:** find one post-migration — display intact, first/last
   empty on the detail page; typing parts updates the display name.
3. **Customer form:** add a contact on an account with first/last — saved name
   composes.
4. **Draft greeting:** set Title + parts on a stale lead, generate a follow-up —
   greeting is "Hello Ms Rizvi,".

## Automated coverage
- Backend: `bookings.test_names` (split/compose rules, save-sync on Lead and
  Contact, migration backfill incl. the 3-word no-split case).
- Frontend: `app/leads/[id]/page.create.test.tsx` asserts the create payload
  carries `contact_first_name`/`contact_last_name` + title.
