# `agents/` — the REL-412 agent foundation

This app is the shared substrate every Relogue portioning agent is built on. It is
deliberately small: a node library, a checkpointer, an org-scoped audit record,
and a walking-skeleton graph that proves the mechanics. REL-413 (proposal builder)
and later agents add their own nodes/graphs on top — they do **not** re-invent any
of the below.

> Not to be confused with the separate **Relogue Finance** agent (REL-494/495,
> repo `fin_new`). Patterns transfer; code does not. Where they differ, **this
> repo's rules win**.

## The conventions (these are the rules)

**1. Nodes are plain functions.** A node takes the typed state dict in and returns
a *partial* update (LangGraph merges it). No Django view, no HTTP, no LangChain —
just functions a graph wires together. They live in `agents/nodes/` and are unit
tested as pure functions. State types are `TypedDict`s (`agents/state.py`).

**2. LLM nodes propose, deterministic nodes dispose.** An LLM node's only job is to
produce a schema-validated structured value. It never writes to the DB, sends
anything, or decides control flow. Deterministic nodes do that — they load facts
(`load_org_context`), route, and persist results. This split is what keeps runs
predictable and testable: the non-deterministic surface is one function returning
one validated dict.

**3. Every LLM call goes through `portioning/llm.py`.** No LangChain chat-model
wrappers, anywhere. The generic helper is `nodes.ask_structured` — prompt + JSON
schema → validated dict, via `llm.py`, with a bounded retry (default 2 retries =
3 attempts) on unparseable/off-schema responses. A misconfiguration
(`LLMNotConfigured`) is *not* retried. Which model a task uses is a one-env-var
change (`LLM_AGENT_*`, e.g. `LLM_AGENT_SKELETON`). LangGraph is adopted for
graphs / typed state / interrupts / checkpoints **only** — not a wider ecosystem.
Structured output is schema-validated by `agents/schema.py`, a small dependency-free
validator (we don't pull in `jsonschema`).

**4. Checkpointer + thread keys.** LangGraph persists state at every super-step to
a *checkpointer*, which is what makes interrupt/resume — and resume in a brand-new
process — work. `agents/checkpointer.py` picks the saver from the live DB engine:
`SqliteSaver` in dev (a dedicated `agent_checkpoints.sqlite3`, gitignored),
`PostgresSaver` in prod (over `DATABASE_URL`). The selection is a pure function
(`checkpointer_kind`) so it is unit-tested without a real Postgres. Thread-key
convention: **`"{agent}:{org_id}:{record_id}"`** (`checkpointer.thread_key`).

**5. Org-scoping everywhere.** `AgentThread` (the generic run/audit record) has a
direct `organisation` FK, uses the tenant manager (`.for_org(org)`), and mixes in
`OrgScopedModel`. Runs are addressed and resumed *scoped to an org* — one org can
never advance another org's run (`runner.resume_run`). Real agents FK `AgentThread`
or follow its pattern.

**6. Per-org opt-in flags for real agents.** The skeleton has no flag (it does
nothing unless a management command invokes it). The first *real* agent gets a
per-org opt-in flag before it can touch a tenant's data, per the epic's principles.

## What's here

```
agents/
  state.py            SkeletonState (TypedDict) — the typed graph state
  schema.py           validate_structured() — dependency-free JSON-schema subset
  checkpointer.py     make_checkpointer() + checkpointer_kind() + thread_key()
  models.py           AgentThread — org-scoped run/audit record
  nodes/
    context.py        load_org_context (deterministic)
    llm_node.py       ask_structured (LLM helper: propose + validate + retry)
  graphs/
    skeleton.py       build_skeleton_graph() — the reference wiring
  runner.py           start_run / resume_run — status mapping + org boundary
  management/commands/
    run_skeleton_agent.py     start (parks at the interrupt)
    resume_skeleton_agent.py  resume (a new process; org-scoped)
```

## The walking skeleton

```
load_org_context ─▶ generate_question ─▶ (error?) ─▶ fail ─▶ END
                                         └▶ await_answer ─▶ finalize ─▶ END
```

Try it (dev, needs an org and a configured `LLM_AGENT_SKELETON` provider key):

```bash
python manage.py run_skeleton_agent --org <id|slug|name> --record-id 7
# ... prints the generated question; the process exits, state checkpointed ...
python manage.py resume_skeleton_agent --org <id|slug|name> --record-id 7 --answer "150 guests"
# ... a brand-new process resumes from the checkpoint and completes ...
```

## No HTTP endpoints (yet)

This foundation ships **no** endpoints — it's invoked only via management commands.
REL-413 adds the real endpoints with the standard org-scoping mixins.

## Tracing (LangSmith) — dev/eval only, opt-in (REL-511)

LangGraph auto-traces to LangSmith when the LangChain tracing env is set. We keep
it **off by default**: LangSmith is a third-party SaaS and agent traces carry org
customer data (lead names, message content).

**Prod stance (owner decision, 2026-08-17):** tracing is **dev/eval only for now** —
default OFF everywhere, enabled only by an explicit env var, and **not set in
DigitalOcean prod or CI**. Revisit (redaction, or self-hosted Langfuse) before any
prod enablement.

Enable in dev by exporting (never commit these):

```bash
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=ls-...
export LANGSMITH_PROJECT=relogue-agents   # optional; defaults to relogue-agents
```

`agents/tracing.py` gates it: `is_tracing_enabled()` is true **only** when the flag
*and* a key are both present; `configure_tracing()` (called by the runner before
every graph invoke) exports the LangChain env when enabled. When disabled it is
**authoritative — off means off**: it actively forces `LANGCHAIN_TRACING_V2` /
`LANGSMITH_TRACING` to `false`, so agent runs never trace even if a developer has
LangSmith exported globally for another project. Our flag is the single source of
truth; no LangSmith network call is attempted unless *we* enable it.

## Evals (REL-511)

Prompt/model changes are gated by measured results, not eyeballing. The harness
(`agents/evals/`) runs a dataset of **synthetic** catering inquiries through an
agent *target*, grades each output, and exits non-zero on a regression.

```bash
python manage.py run_agent_evals --org <id|slug|name> --agent inquiry_extraction
python manage.py run_agent_evals --org <slug> --agent skeleton
python manage.py run_agent_evals --org <slug> --dataset path/to/dataset.json
```

Real runs call the real provider (needs keys, costs money) — so evals are **not** a
required CI check. The evaluator *mechanics* are covered by the normal suite with
the fake provider (`test_evals.py`).

**Pieces:**
- `evals/targets.py` — the systems under test (`skeleton`, `inquiry_extraction`,
  and `proposal_menu` = the REL-413 proposal composer, graded on staying in the org
  catalog), each paired with its output schema. A target is `(case, org) -> dict`,
  going through `ask_structured` (so, `llm.py` only).
- `evals/evaluators.py` — **deterministic assertions first** (`schema_valid`,
  `catalog_subset` = proposed dishes ⊆ org catalog, `date_not_invented`,
  `headcount_echoed`) plus `llm_judge` for prose/tone only.
- `evals/runner.py` — `run_evals(dataset, org) -> EvalReport`; `regressed` is true
  if any assertion fails (v1 baseline = all-pass). No CLI/exit concerns here.
- `evals/datasets/*.json` — versioned, synthetic-only cases.

**Add a case:** append to the relevant `datasets/<agent>_vN.json` with an `id`,
`target`, `input`, `expected` ground truth (null = not stated → must not be
invented), and the `constraints` (evaluator names) to apply. **Add an evaluator:**
add the function to `evals/evaluators.py` and register it in `EVALUATORS`; totals
parity (via `bookings.services.totals.compute_booking_totals`) arrives with
REL-413's proposal output, which is the first target that produces line totals.
