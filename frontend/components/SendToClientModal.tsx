"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ChannelAvailability,
  ChannelBlockedReason,
  ClientChannel,
  ClientMessageKind,
  ClientMessageParent,
  WhatsAppMessage,
} from "@/lib/api";
import { waLink } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** The AI marker. Type, not an icon — and it appears ONLY where a model was
 * actually involved, so it never claims work that didn't happen. */
function AiMark({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`text-primary ${className}`}>✦</span>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which record we're messaging about — decides the endpoint, nothing else. */
  parent: ClientMessageParent;
  parentId: number;
  kind: ClientMessageKind;
  /** Header line: "Q-12 — Nadia Okonjo, 14 Mar 2026". */
  subtitle?: string;
  availability?: ChannelAvailability;
  /** Reopen with existing wording instead of drafting — used to retry a failed
   * send, or to action a `to_send` task, without asking a model to rewrite
   * something a human already approved. */
  prefill?: { channel: ClientChannel; subject: string; body: string } | null;
  onSent?: (message: WhatsAppMessage, note: string) => void;
}

const TITLES: Record<ClientMessageKind, string> = {
  sign_link: "Send to client",
  signed_copy: "Send signed copy",
  compose: "Compose message",
};

/** Why the email option is off, and what the caterer can actually do about it.
 * The three causes have three different fixes; collapsing them sends people to
 * the wrong screen, so they stay separate all the way to the copy. */
function emailBlockedHint(reason: ChannelBlockedReason | null): {
  text: string; link: boolean;
} | null {
  if (reason === "no_mailbox") {
    return { text: "Connect your email in Settings to send emails.", link: true };
  }
  if (reason === "mailbox_needs_reconnect") {
    // NOT "connect" — they already did that, and the platform lost the grant.
    return { text: "Your email connection needs renewing in Settings.", link: true };
  }
  if (reason === "no_email_address") {
    // An org-level link would be useless here: the fix is on the customer.
    return { text: "This client has no email address on file. Add one on their customer record.", link: false };
  }
  return null;
}

function channelHint(
  channel: ClientChannel, availability: ChannelAvailability | undefined,
): string {
  if (channel === "email") {
    const from = availability?.email.mailbox;
    return from ? `Sends from ${from}; replies reach your inbox` : "Sends from your connected mailbox";
  }
  if (availability?.whatsapp.mechanism === "platform") {
    return `Sent from ${availability.whatsapp.number}; delivery tracked`;
  }
  return "Opens WhatsApp on your phone; delivery not confirmed";
}

export default function SendToClientModal({
  open, onClose, parent, parentId, kind, subtitle, availability, prefill, onSent,
}: Props) {
  const [channel, setChannel] = useState<ClientChannel>("whatsapp");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  // Reopened wording is neither an AI draft nor a template; saying either would
  // be a small lie in the one place this feature is meant to be honest.
  const [fromPrefill, setFromPrefill] = useState(false);
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [attachment, setAttachment] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  // Guards against a slow first draft landing after a newer one — otherwise
  // switching channel twice quickly can leave the wrong text in the box.
  const requestId = useRef(0);

  const emailAvailable = availability?.email.available ?? false;
  const whatsappAvailable = availability?.whatsapp.available ?? false;
  const noChannel = !emailAvailable && !whatsappAvailable;
  const shortcut = channel === "whatsapp" && availability?.whatsapp.mechanism !== "platform";
  const attaches = kind !== "compose" && channel === "email" && !!attachment;

  const draft = useCallback(async (ch: ClientChannel) => {
    const mine = ++requestId.current;
    setLoading(true);
    setFromPrefill(false);
    setError("");
    try {
      const res = await api.draftClientMessage(parent, parentId, { kind, channel: ch });
      if (mine !== requestId.current) return;   // superseded
      setSubject(res.subject);
      setBody(res.body);
      setUsedFallback(res.used_fallback);
      setLlmAvailable(res.llm_available);
      setAttachment(res.attachment_filename);
    } catch (err) {
      if (mine !== requestId.current) return;
      // Drafting failing must never block sending — leave the box empty and
      // editable rather than trapping the rep behind an error.
      setSubject("");
      setBody("");
      setUsedFallback(true);
      setError(err instanceof Error ? err.message : "Could not draft a message.");
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [parent, parentId, kind]);

  // Opening picks the channel the backend resolved (contact > org > fallback),
  // degrading away from a channel that isn't usable.
  useEffect(() => {
    if (!open) return;
    setSending(false);
    if (prefill) {
      setChannel(prefill.channel);
      return;
    }
    if (!availability) return;
    const preferred = availability.default_channel;
    const usable = preferred === "email" ? emailAvailable : whatsappAvailable;
    setChannel(usable ? preferred : (emailAvailable ? "email" : "whatsapp"));
  }, [open, availability, emailAvailable, whatsappAvailable, prefill]);

  useEffect(() => {
    if (!open) return;
    if (prefill) {
      // Reopening wording a human already approved — nothing to draft.
      requestId.current++;
      setSubject(prefill.subject);
      setBody(prefill.body);
      setUsedFallback(false);
      setFromPrefill(true);
      setLoading(false);
      return;
    }
    draft(channel);
    // Any in-flight draft is abandoned on unmount by the request-id guard.
    return () => { requestId.current++; };
  }, [open, channel, kind, draft, prefill]);

  if (!open) return null;

  const hint = emailBlockedHint(availability?.email.reason ?? null);
  const cta = channel === "email"
    ? "Send email"
    : shortcut ? "Open in WhatsApp" : "Send WhatsApp message";

  async function handleSend() {
    setSending(true);
    setError("");
    // The wa.me tab must open in the click's own gesture — opening it after an
    // await gets it swallowed by the popup blocker.
    if (shortcut) {
      const phone = availability?.whatsapp.address;
      if (phone) window.open(waLink(phone, body), "_blank");
    }
    try {
      const msg = await api.sendClientMessage(parent, parentId, {
        kind, channel, subject: channel === "email" ? subject : undefined, body,
      });
      onSent?.(msg, shortcut
        ? "Opened in WhatsApp — send it there and it stays logged here."
        : channel === "email" ? "Email sent." : "WhatsApp message sent.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[kind]}
        className="absolute left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 grid gap-4 max-h-[88vh] overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{TITLES[kind]}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="opacity-70 hover:opacity-100">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {noChannel && (
          <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
            This client has no email address and no WhatsApp number on file. Add one on
            the customer record first.
          </p>
        )}

        <div className="grid grid-cols-[1fr_auto] items-end gap-4">
          <div>
            <label htmlFor="send-to" className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
            <Input
              id="send-to"
              readOnly
              value={(channel === "email" ? availability?.email.address : availability?.whatsapp.address) || ""}
            />
          </div>
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Channel
              <span
                role="img"
                aria-label={channelHint(channel, availability)}
                title={channelHint(channel, availability)}
                className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-border text-[9px] font-semibold italic leading-none"
              >i</span>
            </span>
            <div className="flex w-fit overflow-hidden rounded-md border border-input">
              {([
                { value: "email" as const, label: "Email", enabled: emailAvailable },
                { value: "whatsapp" as const, label: "WhatsApp", enabled: whatsappAvailable },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!opt.enabled}
                  aria-pressed={channel === opt.value}
                  onClick={() => setChannel(opt.value)}
                  className={`h-[34px] px-3.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    channel === opt.value
                      ? "bg-primary font-medium text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Only shown here, at the moment the rep reaches for email — never on
            the booking page itself. */}
        {!emailAvailable && hint && (
          <p className="rounded border border-border bg-muted/40 px-3 py-2.5 text-sm">
            {hint.link ? (
              <>
                <a href="/settings?tab=integrations" className="text-primary underline">
                  {hint.text.replace(/\.$/, "")}
                </a>
              </>
            ) : hint.text}
          </p>
        )}

        {attaches && (
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Attached</span>
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">PDF</span>
              <span className="font-medium">{attachment}</span>
            </span>
          </div>
        )}

        {usedFallback && !fromPrefill && !loading && !error && (
          <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
            AI drafting is unavailable — standard wording used.
          </p>
        )}

        {loading ? (
          <div className="grid gap-2 py-3" data-testid="draft-skeleton">
            <p className="text-xs text-muted-foreground">
              {llmAvailable && <AiMark className="mr-1" />}Drafting from this booking…
            </p>
            {["62%", "94%", "88%", "71%", "40%"].map((w, i) => (
              <span key={i} className="block h-2.5 rounded bg-muted" style={{ width: w }} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {channel === "email" && (
              <div>
                <label htmlFor="send-subject" className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
                <Input id="send-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            )}
            <div>
              <label htmlFor="send-body" className="mb-1 block text-xs font-medium text-muted-foreground">Message</label>
              <Textarea
                id="send-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className={channel === "email" ? "min-h-[220px]" : "min-h-[120px]"}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {fromPrefill
                  ? "Previous wording"
                  : usedFallback
                    ? "Standard template"
                    : <><AiMark className="mr-1" />AI draft</>}
              </span>
              <Button size="sm" variant="outline" onClick={() => draft(channel)} disabled={sending}>
                {!usedFallback && llmAvailable && <AiMark className="mr-1.5" />}Regenerate
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={loading || sending || noChannel || !body.trim()}>
            {sending ? (shortcut ? "Opening…" : "Sending…") : cta}
          </Button>
        </div>
      </div>
    </div>
  );
}
