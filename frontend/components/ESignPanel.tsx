"use client";

import { useState } from "react";
import { api, BookingSignatureInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  kind: "quote" | "event";
  id: number;
  publicToken: string | null;
  signature: BookingSignatureInfo | null;
}

/** Staff-side control: mint the client sign link and show its signed status.
 * For v1 the staff copies the link to send it (WhatsApp/email send comes later). */
export default function ESignPanel({ kind, id, publicToken, signature }: Props) {
  const [token, setToken] = useState<string | null>(publicToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const signUrl = token ? `${origin}/b/${token}` : null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res =
        kind === "quote" ? await api.sendQuoteForSignature(id) : await api.sendEventForSignature(id);
      setToken(res.public_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the sign link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!signUrl) return;
    try {
      await navigator.clipboard.writeText(signUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is still visible to copy manually */
    }
  }

  if (signature) {
    return (
      <div className="mt-4 p-3 bg-success/10 border border-success/20 rounded">
        <span className="text-success text-sm font-medium">
          Signed by {signature.signer_name}
          {signature.signed_at ? ` on ${new Date(signature.signed_at).toLocaleDateString()}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4 p-3 border border-border rounded">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Client e-signature</p>
          <p className="text-xs text-muted-foreground">
            {signUrl
              ? "Share this link with your client to accept and sign."
              : "Create a secure link your client can open to accept and sign."}
          </p>
        </div>
        {!signUrl && (
          <Button onClick={send} disabled={busy}>
            {busy ? "…" : "Send for signature"}
          </Button>
        )}
      </div>

      {signUrl && (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={signUrl}
            aria-label="Client sign link"
            onFocus={(e) => e.target.select()}
            className="flex-1 rounded border border-border bg-muted/30 px-2 py-1 text-xs text-foreground"
          />
          <Button variant="outline" onClick={copy}>
            {copied ? "Copied!" : "Copy link"}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
