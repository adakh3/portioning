---
name: deploy
description: Release to production by tagging main and pushing the tag (the tag-triggered DigitalOcean deploy). Use when the owner asks to deploy / release / ship it / push to prod / cut a release / "go live". Computes the next version tag, confirms with the owner, tags origin/main, pushes, and watches the deploy + smoke probe to completion. Invoke with an optional level or version, e.g. /deploy, /deploy minor, /deploy v2.0.0.
---

# Deploy — cut a production release

Deploys are **tag-triggered**. DigitalOcean App Platform autodeploy is **OFF**, so
merging to `main` does **not** deploy. Pushing a `v*` tag runs
`.github/workflows/deploy.yml` → `doctl apps create-deployment --wait` → then
`.github/workflows/post-deploy-smoke.yml` probes prod `/api/health/` + `/login`.
See CLAUDE.md **Deployment**. Needs `gh` authenticated.

**This ships to production. Never push the tag without the owner's explicit OK.**

## Steps (when asked to deploy / release / ship)

1. **Sync tags + find the current version.**
   - `git fetch origin --tags --quiet`
   - Latest: `git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1`
   - If there are **no** version tags yet, the first release is **`v1.0.0`**.

2. **Compute the next version** (semver `vMAJOR.MINOR.PATCH`):
   - No arg → bump **patch** (`v1.2.3` → `v1.2.4`).
   - `patch` / `minor` / `major` arg → bump that field, zeroing the lower ones
     (`v1.2.3` minor → `v1.3.0`; major → `v2.0.0`).
   - An explicit `vX.Y.Z` arg → use it verbatim. It **must not already exist**
     (check the tag list); if it does, stop and ask.

3. **Show the plan and get an explicit OK — do not skip, this deploys to prod.**
   State, and wait for confirmation:
   - the last version and the new tag;
   - the exact commit it will tag: `git rev-parse --short origin/main` + its subject
     (`git log -1 --format='%s' origin/main`);
   - "This deploys `origin/main` to **production**."

4. **Tag `origin/main`'s tip and push it** (tag the true main tip so the released
   code == what actually deploys — DO deploys main's tip, not the tag's commit; and
   this works regardless of which branch is checked out locally):
   ```bash
   git tag <vX.Y.Z> origin/main
   git push origin <vX.Y.Z>
   ```
   Never move or force-push an existing tag — if the name is taken, pick the next number.

5. **Watch it to completion** and report plainly:
   - Deploy: poll `gh run list --workflow=deploy.yml --limit 1` until `completed`.
   - Smoke probe (auto-triggered after a successful deploy): poll
     `gh run list --workflow=post-deploy-smoke.yml --limit 1` until `completed`.
   - On **failure**, dump the failing job's log (`gh run view <id> --log-failed`) and
     say what broke. The tag stays (that's fine) — fix forward and cut the next patch;
     do not delete/re-use the tag.

6. **Confirm** the new version is live (deploy + smoke both green) and note the version.

## Quick unversioned alternative

If the owner wants a fast deploy without minting a version, trigger the workflow
directly (deploys current `main`, no tag): `gh workflow run deploy.yml`. Still confirm
first — it deploys to prod. The version-tag path is preferred because it leaves a
labelled release history.
