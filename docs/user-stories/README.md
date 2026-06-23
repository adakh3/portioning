# User Stories & Manual Test Cases

One markdown file per feature. Each captures the **user story** (who/what/why), the
**acceptance criteria**, and **manual test cases** the user can walk through to verify
the feature end-to-end (beyond the automated suite).

**Convention:** whenever a new feature or significant change ships, add or update a file
here. Keep it test-focused — numbered cases with concrete steps and expected results.

## Index

| Feature | File | Status |
|---|---|---|
| Org-customizable lead statuses | [lead-statuses.md](lead-statuses.md) | Built — awaiting manual sign-off |
| Multi-tenant admin org visibility | [admin-org-visibility.md](admin-org-visibility.md) | Built — awaiting manual sign-off |
| Superuser org-switcher | [superuser-org-switcher.md](superuser-org-switcher.md) | Built — awaiting manual sign-off |
| Org choice-lists in Settings | [org-choice-lists.md](org-choice-lists.md) | Built — awaiting manual sign-off |

## Template

```markdown
# <Feature name>

## User story
As a <role>, I want <capability>, so that <benefit>.

## Acceptance criteria
- [ ] ...

## Manual test cases

### TC1 — <short title>
**Steps:**
1. ...
**Expected:** ...
```
