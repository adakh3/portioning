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
