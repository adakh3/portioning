---
name: implement-ticket
description: Implementation-session workflow (Opus). Execute a Linear ticket raised by a planning session, end-to-end - worktree, code, tests, PR - and report back on the ticket. Invoke with the ticket ID, e.g. /implement-ticket REL-408. Use when the user asks to implement/execute/pick up a Linear ticket.
---

# Implement a Linear ticket

**The split:** a Fable planning session wrote this ticket to be self-contained; this
session (intended to run on **Opus** — if the session is on another model, say so once
and continue unless the owner objects) executes it and reports back. The owner returns
to the planning session afterwards, so the ticket is also the **report channel**.

## Steps

1. **Fetch the ticket** (Linear MCP `get_issue`, include relations). Read the whole
   body — especially *Execution notes*, *Steps*, *Verify*, *Safety* — **and its comment
   thread** (late owner/planning notes land there). Check it isn't blocked by an open
   ticket; if it is, stop and tell the owner. **Re-read the comment thread again
   immediately before pushing** — a correction may have arrived while you worked.
2. **Set it In Progress** (`save_issue`).
3. **Set up where the ticket says:** enter the named existing worktree (EnterWorktree
   with `path`), or create the branch it specifies off **fresh origin/main**
   (`git fetch origin` first — local main may be stale). Never work on main directly.
4. **Execute the Steps section in order.** The ticket's exact file names, migration
   numbers, and commands win over your own guesses. If reality contradicts the ticket
   (file moved, number taken, approach impossible), don't improvise a big deviation
   silently — small mechanical adaptations are fine (note them for the report); real
   scope changes go back to the owner.
5. **Repo rules always apply:** backend + frontend tests for any feature/fix; the
   pre-commit hook runs them (worktree-aware — commit normally); pre-push Playwright
   e2e for UI/persistence changes; regenerate `seed.json` on seed changes; doc-sync
   rules (PORTIONING_LOGIC ↔ help page, totals trio per CALCULATION_PARITY); keep the
   ticket's **User story & manual test cases** section accurate if scope shifts (stories
   live in the ticket now, not `docs/user-stories/` — that's a frozen archive).
6. **Run everything in the ticket's Verify section** and say plainly what passed/failed.
   If the ticket added/changed a **new user-facing feature**, also run the
   **`manual-test-before-push`** skill — a one-off drive of that feature in real Chrome
   (not a regression sweep) — and share the GIF.
7. **Ask the owner before any push** (prod auto-deploys from main). Then PR → merge
   per their instruction.
8. **Report back on the ticket** (`save_comment` + `save_issue`):
   - comment: what changed (commits/PR link), Verify results, any deviations from the
     ticket and why, and anything the planning session should know (discoveries,
     follow-ups, stale assumptions in the epic);
   - state: **In Review** when the PR is up, **Done** once merged.
9. Tell the owner it's done and that the planning session can pick the thread back up.
