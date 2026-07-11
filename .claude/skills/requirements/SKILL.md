---
name: requirements
description: Requirement-gathering and planning interview. Use whenever the user starts describing a NEW feature or asks to build something new — BEFORE writing any plan or code. Quizzes the user in structured rounds until every material detail is pinned down, then writes the user story + manual test cases and an implementation plan, and gets sign-off before implementation begins.
---

# Feature Requirements Interview

You are about to start work on a new feature. Do NOT plan or write code yet.
First interview the user until you could hand this feature to another developer
with no open questions. Talk plainly — no jargon, no acronyms without spelling
them out.

## How to run the interview

- Ask in **rounds of 2–4 questions max**, not one giant questionnaire.
- Use the AskUserQuestion tool when the answer is a choice between concrete
  options (give your recommended option first); use free-form questions for
  open-ended ones.
- After each round, say back what you understood in one or two sentences, then
  ask the next round. Dig into anything vague — "manage", "track", "handle"
  are not answers; ask what the user actually sees and clicks.
- Skip questions the user already answered in their request. Never re-ask.
- Keep going until there are **no material unknowns**. Three rounds is
  typical; stop earlier only if the feature is genuinely tiny.
- If the user says "you decide", record the decision you made and why.

## What must be pinned down (checklist)

Work through these areas; skip any that clearly don't apply, and say you're
skipping them:

1. **Problem & goal** — Who is this for (owner / admin / manager / chef /
   salesperson / the customer)? What goes wrong today without it? How will we
   know it worked?
2. **Scope** — What's the smallest version worth shipping? What is explicitly
   OUT of scope for now? Anything that looks in-scope but isn't, name it.
3. **Roles & permissions** — Which roles can see it, which can change it?
   Anything owner-only or admin-only? (Settings are gated by IsAdminOrOwner.)
4. **Data** — New models or fields? Is it per-organisation (almost everything
   is)? Configured where: in-app Settings, Django admin, or fixed? Does seed
   data change (then `seed.json` must be regenerated) or `seed_demo`?
5. **Where it lives in the UI** — Which page(s)? New page or a section on an
   existing one? List, table, kanban, or detail view? What does the empty
   state look like? Status labels follow the pill style (tinted background,
   darker matching text, rounded).
6. **Money & calculations** — Does it touch prices, totals, tax, discounts or
   portions? If totals: all three sources must change together
   (`backend/bookings/services/totals.py`, `frontend/lib/quoteTotals.ts`,
   `docs/calculation-golden-cases.json`). If portions: `PORTIONING_LOGIC.md`
   and the help page must be updated.
7. **The booking lifecycle** — Does it exist on leads, quotes, events, or all
   of them? What happens to it when a lead becomes a quote and a quote is
   accepted into an event? (Conversions must carry ALL details across —
   losing data on conversion has bitten us before.)
8. **Edge cases** — Empty/zero values, very large events, B2B vs individual
   customers, multiple orgs, deleted/archived records, timezone or currency
   differences (US + UAE are the target markets).
9. **Documents & messages** — Does it appear on the quote PDF, event/kitchen
   PDF, invoices, or WhatsApp messages?
10. **Verification** — How will the user manually check it works? Which flows
    need a real-browser (Playwright) test because mocked tests can't catch
    them (native date/time/file inputs, save-then-reload)?

## When the interview is done

1. **Summarize the agreed requirements** in plain language and ask the user to
   confirm or correct. Do not proceed on silence.
2. **Write `docs/user-stories/<feature>.md`** — user story + numbered manual
   test cases (follow `docs/user-stories/README.md`).
3. **Present a short implementation plan** — models/migrations, API changes,
   UI changes, tests (backend, frontend page-level integration, e2e if
   needed), and any docs that must change per CLAUDE.md.
4. **Get explicit sign-off on the plan**, then start implementing.
