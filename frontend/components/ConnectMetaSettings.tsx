"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, MetaAvailablePage } from "@/lib/api";
import { useMetaStatus } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Meta redirects back to /settings?tab=integrations with one of these opaque
// codes; turn them into plain English (mirrors the mailbox card).
const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled before granting access. Nothing was changed.",
  expired: "That took a little too long — please try connecting again.",
  invalid_state: "We couldn't verify that sign-in came from this browser. Please try again.",
  invalid_request: "Meta sent back an incomplete response. Please try again.",
  exchange_failed: "Meta refused the connection. Please try again.",
};

export default function ConnectMetaSettings() {
  const { data, isLoading, mutate } = useMetaStatus();
  const searchParams = useSearchParams();

  const [available, setAvailable] = useState<MetaAvailablePage[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Feedback from the round trip through Meta.
  useEffect(() => {
    if (searchParams.get("meta") === "connected") {
      setSuccess("Facebook is connected — choose the Pages to bring in.");
    }
    const failed = searchParams.get("meta_error");
    if (failed) {
      setError(ERROR_MESSAGES[failed] || "We couldn't connect Meta. Please try again.");
    }
  }, [searchParams]);

  const authorized = data?.authorized ?? false;
  const connectedPages = data?.pages ?? [];

  // Once authorised, load the Pages the admin can pick from.
  useEffect(() => {
    if (!authorized) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    api
      .getMetaPages()
      .then((list) => {
        if (!cancelled) setAvailable(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load your Pages.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authorized, data?.pages]);

  async function handleConnect() {
    setBusy("connect");
    setError("");
    setSuccess("");
    try {
      const { auth_url } = await api.startMetaConnect();
      // Full navigation, not a popup: Meta will redirect us back.
      window.location.href = auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in");
      setBusy(null);
    }
  }

  async function handleConnectPages() {
    setBusy("connect-pages");
    setError("");
    setSuccess("");
    try {
      const result = await api.connectMetaPages([...selected]);
      await mutate();
      setSelected(new Set());
      if (result.errors.length > 0) {
        setError(`Some Pages couldn't be connected: ${result.errors.map((e) => e.page_id).join(", ")}.`);
      } else {
        setSuccess("Your Pages are connected.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect those Pages");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(pageId: string) {
    setBusy(`disconnect-${pageId}`);
    setError("");
    setSuccess("");
    try {
      await api.disconnectMetaPage(pageId);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect that Page");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnectAccount() {
    setBusy("disconnect-account");
    setError("");
    setSuccess("");
    try {
      await api.disconnectMetaAccount();
      setSelected(new Set());
      setAvailable(null);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect the Meta account");
    } finally {
      setBusy(null);
    }
  }

  function toggle(pageId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  const statusBadge =
    connectedPages.length > 0 ? (
      <Badge variant="success">Connected</Badge>
    ) : (
      <Badge variant="secondary">Not connected</Badge>
    );

  const pickable = (available ?? []).filter((p) => !p.connected);

  return (
    <Card data-testid="settings-meta-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Facebook &amp; Instagram</CardTitle>
          {statusBadge}
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-3 text-sm">{error}</p>}
        {success && <p className="text-success mb-3 text-sm">{success}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your Facebook Page and linked Instagram account so lead-form
              submissions and direct messages flow straight into your CRM.
            </p>

            {/* Already-connected Pages, each disconnectable. */}
            {connectedPages.length > 0 && (
              <ul className="space-y-2">
                {connectedPages.map((page) => (
                  <li
                    key={page.page_id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-foreground">{page.page_name}</span>
                      {page.instagram_username && (
                        <span className="text-muted-foreground">
                          {" · "}@{page.instagram_username}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleDisconnect(page.page_id)}
                      disabled={busy !== null}
                    >
                      {busy === `disconnect-${page.page_id}` ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {!authorized ? (
              <Button onClick={handleConnect} disabled={busy !== null}>
                {busy === "connect" ? "Redirecting…" : "Connect Facebook & Instagram"}
              </Button>
            ) : (
              <div className="space-y-3">
                {pickable.length > 0 ? (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      Choose Pages to connect
                    </p>
                    <ul className="space-y-2">
                      {pickable.map((page) => (
                        <li key={page.page_id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`meta-page-${page.page_id}`}
                            checked={selected.has(page.page_id)}
                            onChange={() => toggle(page.page_id)}
                          />
                          <label htmlFor={`meta-page-${page.page_id}`} className="text-sm">
                            {page.page_name}
                            {page.instagram_username && (
                              <span className="text-muted-foreground">
                                {" · "}@{page.instagram_username}
                              </span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <Button
                      onClick={handleConnectPages}
                      disabled={busy !== null || selected.size === 0}
                    >
                      {busy === "connect-pages" ? "Connecting…" : "Connect selected Pages"}
                    </Button>
                  </>
                ) : (
                  available !== null &&
                  connectedPages.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      All of your Pages are connected.
                    </p>
                  )
                )}

                {/* The way out of the "authorised but no Pages" state, and a full
                    reset: drops the account token and every Page. */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleDisconnectAccount}
                    disabled={busy !== null}
                    className="text-sm text-destructive hover:underline disabled:opacity-50"
                  >
                    {busy === "disconnect-account"
                      ? "Disconnecting…"
                      : "Disconnect Facebook account"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
