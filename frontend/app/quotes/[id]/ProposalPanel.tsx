"use client";

import { useState } from "react";

import { api, type Quote } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shows the AI-drafted proposal prose + the assumptions the agent made, and (until
 * the quote is first sent) a Regenerate button that runs a fresh draft (REL-413).
 * Only rendered when a quote actually carries proposal prose — a hand-built quote
 * looks exactly as it always did.
 */
export function ProposalPanel({
  quote,
  onRegenerated,
}: {
  quote: Quote;
  onRegenerated: (newQuoteId: number) => void;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");

  const prose = quote.proposal_prose;
  const assumptions = quote.proposal_assumptions || [];
  if (!prose && assumptions.length === 0) return null;

  const canRegenerate = !quote.sent_at && !!quote.proposal_draft_id;

  async function regenerate() {
    if (!quote.proposal_draft_id) return;
    setRegenerating(true);
    setError("");
    try {
      const next = await api.regenerateProposal(quote.proposal_draft_id);
      if (next.status === "drafted" && next.quote_id) {
        onRegenerated(next.quote_id);
      } else {
        setError(next.error || "Could not regenerate the proposal.");
        setRegenerating(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not regenerate the proposal.");
      setRegenerating(false);
    }
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">AI proposal</h3>
          {canRegenerate && (
            <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
              {regenerating ? "Regenerating…" : "Regenerate"}
            </Button>
          )}
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
        )}

        {assumptions.length > 0 && (
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Assumptions the AI made</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {assumptions.map((a, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{a.field}:</span> {a.value} — {a.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {prose?.intro && <Section title="Introduction">{prose.intro}</Section>}
        {prose?.section_descriptions && Object.keys(prose.section_descriptions).length > 0 && (
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Menu sections</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {Object.entries(prose.section_descriptions).map(([name, desc]) => (
                <li key={name}>
                  <span className="font-medium text-foreground">{name}:</span> {desc}
                </li>
              ))}
            </ul>
          </div>
        )}
        {prose?.whats_included && prose.whats_included.length > 0 && (
          <div>
            <p className="text-sm font-medium text-foreground mb-1">What&apos;s included</p>
            <ul className="text-sm text-muted-foreground list-disc pl-5">
              {prose.whats_included.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {prose?.day_of_outline && <Section title="Day-of outline">{prose.day_of_outline}</Section>}
        {prose?.closing && <Section title="Closing">{prose.closing}</Section>}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      <p className="text-sm text-muted-foreground whitespace-pre-line">{children}</p>
    </div>
  );
}
