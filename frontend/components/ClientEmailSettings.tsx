"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, MailboxProvider } from "@/lib/api";
import { useConnectedMailbox } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PROVIDER_LABELS: Record<MailboxProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

// The provider sends the browser back to /settings?tab=integrations with one of
// these; they're deliberately opaque codes, so turn them into plain English.
const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled before granting access. Nothing was changed.",
  expired: "That took a little too long — please try connecting again.",
  invalid_state: "We couldn't verify that sign-in came from this browser. Please try again.",
  invalid_request: "The provider sent back an incomplete response. Please try again.",
  exchange_failed: "The provider refused the connection. Please try again.",
  no_address: "We couldn't read your email address from that account.",
};

export default function ClientEmailSettings() {
  const { data, isLoading, mutate } = useConnectedMailbox();
  const searchParams = useSearchParams();

  const [busy, setBusy] = useState<MailboxProvider | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Feedback from the round trip through the provider.
  useEffect(() => {
    if (searchParams.get("email") === "connected") {
      setSuccess("Your email is connected.");
    }
    const failed = searchParams.get("email_error");
    if (failed) {
      setError(ERROR_MESSAGES[failed] || "We couldn't connect that account. Please try again.");
    }
  }, [searchParams]);

  const mailbox = data?.mailbox ?? null;
  const providers = data?.providers_available ?? ["google", "microsoft"];
  const needsReconnect = mailbox?.status === "needs_reconnect";

  async function handleConnect(provider: MailboxProvider) {
    setBusy(provider);
    setError("");
    setSuccess("");
    try {
      const { auth_url } = await api.startMailboxConnect(provider);
      // Full navigation, not a popup: the provider will redirect us back.
      window.location.href = auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in");
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    setError("");
    setSuccess("");
    try {
      await api.disconnectMailbox();
      await mutate();
      setSuccess("Your email has been disconnected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Client email</CardTitle>
          {mailbox ? (
            needsReconnect ? (
              <Badge variant="warning">Needs reconnect</Badge>
            ) : (
              <Badge variant="success">Connected</Badge>
            )
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}
        {success && <p className="text-success mb-3 text-sm">{success}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mailbox ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Connected:{" "}
              <span className="font-medium text-foreground">{mailbox.email_address}</span>
              {" · "}
              {mailbox.provider_display}
            </div>

            {needsReconnect ? (
              <p className="text-sm text-muted-foreground">
                We can no longer send from this account — access was removed or expired.
                Reconnect it to start sending again.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Emails to your clients are sent from this address, and a copy lands in your
                Sent folder. Replies come straight back to you.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {/* Offered regardless of providers_available: if the deployment
                  has dropped this provider the reconnect will fail with a clear
                  message, which beats a card beyond repair with no button. */}
              {needsReconnect && (
                <Button
                  onClick={() => handleConnect(mailbox.provider)}
                  disabled={busy !== null}
                >
                  {busy === mailbox.provider ? "Redirecting…" : "Reconnect"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={busy !== null}
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your email so quotes, contracts and messages reach your clients from
              your own address — not from us. We can only send; we can never read your inbox.
            </p>
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Email sending isn&apos;t switched on for this installation yet. Please
                contact support.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {providers.map((provider) => (
                  <Button
                    key={provider}
                    onClick={() => handleConnect(provider)}
                    disabled={busy !== null}
                  >
                    {busy === provider
                      ? "Redirecting…"
                      : `Connect ${PROVIDER_LABELS[provider]}`}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
