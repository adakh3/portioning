---
name: raise-ticket
description: Planning-session handoff (Fable). Turn a finished planning discussion into a self-contained Linear ticket that a separate Opus implementation session can execute with zero context from this conversation. Use when planning is done and work is ready to hand off, or when the user says "raise a ticket" / "hand this off".
---

# Raise an implementation ticket

**The split:** planning sessions (Fable) think, review, architect, and raise tickets.
Implementation happens in a **separate session on Opus** that runs `/implement-ticket <ID>`.
A planning session never switches worktrees to write feature code itself.

## The bar for the ticket

The implementing session has **none of this conversation's context**. Everything it
needs must be in the ticket body. Reference ticket: REL-408.

Required sections (adapt headings as needed):

1. **Context** — what & why in 2–4 sentences; link the parent epic and any reference
   doc (e.g. `plan.md` on a worktree, `docs/…`).
2. **Execution notes** — the environment facts the implementer can't guess:
   - which worktree/branch to work in (existing worktree path under
     `.claude/worktrees/…`, or "new branch off fresh origin/main");
   - `git fetch origin` first — compare against **origin/main**, local main may be stale;
   - known gotchas (migration-number collisions with exact renumbering, conflict
     hot-spots, hook behaviour);
   - **ask the owner before pushing** (prod auto-deploys from main).
3. **Steps** — concrete and ordered. Name files, commands, and exact migration numbers.
4. **Verify** — how to prove it worked (tests, e2e, manual checks, invariants like
   "existing-org output byte-identical").
5. **Safety** — existing-org / data-migration constraints that must not be violated
   (default-vs-backfill, no batch recompute of stored totals, additive-only schema).
6. **User story & manual test cases** (feature tickets) — the user story (who/what/why)
   plus numbered manual test cases with expected results. This lives in the ticket now,
   not a `docs/user-stories/` file (that directory is a frozen archive).

## Mechanics

- Create/update via the Linear MCP (`save_issue`): set the correct **parent**,
  **priority**, `blocks`/`blockedBy` relations, and state **Todo** when ready.
- Repo rules travel with the ticket where relevant: tests required, `seed.json`
  regeneration, doc-sync (PORTIONING_LOGIC ↔ help page; totals trio per
  CALCULATION_PARITY).
- After raising it, tell the owner: *"REL-xxx is ready — open a new session, switch to
  Opus (`/model opus`), and run `/implement-ticket REL-xxx`."*
- Do **not** start implementing here, even partially. If the owner asks for code in a
  planning session, point at this workflow and offer to raise/refine the ticket instead.
