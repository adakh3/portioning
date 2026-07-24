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
   body — especially *Execution notes*, *Steps*, *Verify*, *Safety*, the numbered
   **acceptance criteria** — **and its comment thread** (late owner/planning notes land
   there). **The body is the single living spec and wins on contradiction.** But a
   decision sitting in a comment that isn't reflected in the body is **unprocessed** —
   before you start, **fold it into the body** (read current description, merge into the
   right section + add a `## Change log` line, write back via `save_issue`) or, if it
   genuinely conflicts with the body, **flag it to the owner** rather than guessing which
   is live. Check it isn't blocked by an open ticket; if it is, stop and tell the owner.
   **Re-read the comment thread again immediately before pushing** — a correction may
   have arrived while you worked; fold it in the same way.
2. **Set it In Progress** (`save_issue`).
3. **Set up where the ticket says:** enter the named existing worktree (EnterWorktree
   with `path`), or create the branch it specifies off **fresh origin/main**
   (`git fetch origin` first — local main may be stale). Never work on main directly.
4. **Execute the Steps section in order.** The ticket's exact file names, migration
   numbers, and commands win over your own guesses. If reality contradicts the ticket
   (file moved, number taken, approach impossible), don't improvise a big deviation
   silently — small mechanical adaptations are fine (note them for the report); real
   scope changes go back to the owner.
5. **Repo rules always apply.** Before each commit that adds/changes behavior, apply
   the **`writing-tests`** skill (cover the matrix — surfaces × states — not the one
   path you touched). Then: backend + frontend tests for any feature/fix; the
   pre-commit hook runs them (worktree-aware — commit normally); pre-push Playwright
   e2e for UI/persistence changes; regenerate `seed.json` on seed changes; doc-sync
   rules (PORTIONING_LOGIC ↔ help page, totals trio per CALCULATION_PARITY); keep the
   ticket's **User story & manual test cases** section accurate if scope shifts (stories
   live in the ticket now, not `docs/user-stories/` — that's a frozen archive).
6. **Run everything in the ticket's Verify section** and say plainly what passed/failed.
   If the ticket added/changed a **new user-facing feature**, also run the
   **`manual-test-before-push`** skill — a one-off drive of that feature in real Chrome
   (not a regression sweep) — and share the GIF.
7. **Get an independent review of the diff before pushing** — always, but scrutinise
   money/totals, data migrations, and auth/permission changes hardest. Spawn a fresh
   subagent (Agent tool, `general-purpose`) whose only job is to review
   `git diff origin/main...HEAD` **adversarially** — verify, don't trust the author;
   hunt correctness bugs, existing-row/migration safety, front-end↔back-end wiring
   gaps (the "unit test passes, real payload is wrong" class), and missing test
   coverage — and report findings by severity with a concrete failure scenario each.
   Fix anything real **and add the regression test that would have caught it**; state
   plainly what you deliberately defer and why. This ad-hoc pass is the one you run
   yourself every time; the billed `/code-review ultra` is the **owner's** to trigger,
   not yours (you cannot launch it).

   **Add these conditional passes when the diff warrants them** (these skills exist —
   they're just not in the default loop):
   - diff touches **auth, org-scoping, or public/unauthenticated endpoints** → run
     **`/security-review`** on the branch;
   - diff **adds or changes a list endpoint or serializer** → apply the
     **`avoid-n-plus-one-queries`** skill's checklist to it;
   - diff changes **money/total math** (the totals trio, quote/event PDFs) → flag it in
     your report and **recommend the owner trigger `/code-review ultra`** on the PR.
8. **Ask the owner before any push** (prod auto-deploys from main). Then PR → merge
   per their instruction.
9. **Report back on the ticket** (`save_comment` + `save_issue`) — **keep the body the
   living spec**:
   - **Any deviation that changes the agreed spec** (a step done differently, an AC
     revised, scope cut/added) is **folded into the description** + a `## Change log`
     line — not left only in a comment, which would immediately make the body stale.
   - comment: a thin, dated progress/audit note — what changed (commits/PR link),
     Verify + AC-trace + review results, a pointer to the spec edits you made, and
     anything the planning session should know (discoveries, follow-ups, stale
     assumptions in the epic);
   - state: **In Review** when the PR is up, **Done** once merged.
10. Tell the owner it's done and that the planning session can pick the thread back up.
