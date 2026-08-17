"use client";

import { useEffect, useRef, useState } from "react";

import { api, type ProposalDraft, type ProposalQuestion } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The AI Proposal Builder smart form (REL-413). Starts a proposal run for the
 * lead, renders the agent's 3-6 clarifying questions pre-filled with its
 * suggestions, and on submit resumes the run and hands back the drafted quote id.
 * Nothing here composes the proposal — it only collects answers.
 */
export function ProposalFormModal({
  leadId,
  onClose,
  onDrafted,
}: {
  leadId: number;
  onClose: () => void;
  onDrafted: (quoteId: number) => void;
}) {
  const [draft, setDraft] = useState<ProposalDraft | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"starting" | "questions" | "drafting">("starting");
  const [error, setError] = useState("");

  // Start the run on open → parks at the clarifying form. Guard against a
  // double-start: React StrictMode double-invokes effects in dev (and a stray
  // re-render could too), and each start_proposal mints a new run — so two rapid
  // calls race on the unique thread key and one 500s. Start exactly once.
  // NB: no cancel-on-cleanup flag here — with the once-guard, StrictMode's
  // mount→unmount→remount would set cancelled=true on the first run and the guard
  // would block a second fetch, discarding the only result (stuck "Starting…").
  // The single fetch always applies its result; a late setState after a real
  // unmount is a harmless no-op in React 18.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const d = await api.draftProposal(leadId);
        if (d.status === "questions_pending") {
          setDraft(d);
          setAnswers(prefill(d.questions));
          setPhase("questions");
        } else {
          setError(d.error || "The proposal agent could not start.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start the proposal.");
      }
    })();
  }, [leadId]);

  async function submit() {
    if (!draft) return;
    // Honour the required (*) marker on high-impact questions — don't submit with
    // one blank, since the agent would otherwise fall back / assume for it.
    const missing = draft.questions.find(
      (q) => q.impact === "high" && !String(answers[q.id] ?? "").trim(),
    );
    if (missing) {
      setError(`Please answer: ${missing.text}`);
      return;
    }
    setPhase("drafting");
    setError("");
    try {
      const done = await api.answerProposal(draft.id, answers);
      if (done.status === "drafted" && done.quote_id) {
        onDrafted(done.quote_id);
      } else {
        setError(done.error || "The agent could not draft a proposal. Please try again.");
        setPhase("questions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft the proposal.");
      setPhase("questions");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-lg mx-4 border border-border max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-foreground mb-1">Draft a proposal</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Confirm a few details and the AI will draft a full proposal — menu, plan, pricing and copy — for you to review.
        </p>

        {error && (
          <div className="mb-4 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
        )}

        {phase === "starting" && <p className="text-sm text-muted-foreground">Starting the assistant…</p>}

        {phase !== "starting" && draft && (
          <div className="space-y-4">
            {draft.questions.map((q) => (
              <div key={q.id}>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {q.text}
                  {q.impact === "high" && <span className="text-destructive"> *</span>}
                </label>
                <QuestionInput
                  q={q}
                  value={answers[q.id] ?? ""}
                  onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onClose} disabled={phase === "drafting"}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={phase !== "questions"}>
            {phase === "drafting" ? "Drafting…" : "Draft proposal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionInput({
  q,
  value,
  onChange,
}: {
  q: ProposalQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  if (q.kind === "choice" && q.options?.length) {
    return (
      <select
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {q.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const type = q.kind === "number" ? "number" : q.kind === "date" ? "date" : "text";
  return <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function prefill(questions: ProposalQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    out[q.id] = q.suggested == null ? "" : String(q.suggested);
  }
  return out;
}
