"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, SubscriptionStatus } from "@/lib/api";
import { useSubscription } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type BadgeVariant = "success" | "warning" | "info" | "secondary";

const STATUS_META: Record<SubscriptionStatus, { label: string; variant: BadgeVariant }> = {
  none: { label: "No plan", variant: "secondary" },
  trialing: { label: "Free trial", variant: "info" },
  active: { label: "Active", variant: "success" },
  past_due: { label: "Past due", variant: "warning" },
  unpaid: { label: "Unpaid", variant: "warning" },
  canceled: { label: "Canceled", variant: "secondary" },
  incomplete: { label: "Incomplete", variant: "secondary" },
  incomplete_expired: { label: "Incomplete", variant: "secondary" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Subscription status + checkout/portal actions. Rendered both on the
 *  standalone /billing page (the paywall + Stripe return target) and as the
 *  Billing tab inside Settings. Hosts provide the outer page wrapper. */
export default function BillingPanel() {
  const { user } = useAuth();
  const { data: sub, isLoading } = useSubscription();
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("status"); // "success" | "cancelled"
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState("");

  const isOwner = user?.role === "owner" || !!user?.is_superuser;

  async function redirectTo(action: "checkout" | "portal") {
    setError("");
    setBusy(action);
    try {
      const { url } =
        action === "checkout"
          ? await api.startCheckout()
          : await api.openBillingPortal();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  }

  if (isLoading || !sub) {
    return <p className="text-muted-foreground">Loading billing…</p>;
  }

  const meta = STATUS_META[sub.status] ?? STATUS_META.none;
  const trialExpired = sub.status === "trialing" && !sub.is_trialing;
  const needsPlan = !sub.has_access; // expired trial, none, canceled, unpaid…

  return (
    <div className="space-y-4">
      {checkoutResult === "success" && (
        <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          You&apos;re all set — your subscription is being set up. It may take a
          moment to update.
        </div>
      )}
      {checkoutResult === "cancelled" && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Checkout was cancelled — you have not been charged.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Current plan</CardTitle>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
          <CardDescription>
            {sub.plan_name ? sub.plan_name : "No active paid plan yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trial state */}
          {sub.is_trialing && (
            <p className="text-sm">
              You have{" "}
              <span className="font-semibold">
                {sub.trial_days_remaining}{" "}
                {sub.trial_days_remaining === 1 ? "day" : "days"}
              </span>{" "}
              left in your free trial (ends {formatDate(sub.trial_ends_at)}).
            </p>
          )}
          {sub.is_trialing && sub.has_billing_account && (
            <p className="text-sm text-muted-foreground">
              Your card will be charged when the trial ends, unless you cancel
              before then.
            </p>
          )}
          {trialExpired && (
            <p className="text-sm text-warning">
              Your free trial has ended. Subscribe to keep using the app.
            </p>
          )}

          {/* No plan yet — invite them to start the card-required trial */}
          {needsPlan && !sub.has_billing_account && !sub.is_trialing && (
            <p className="text-sm">
              Start your free trial to use the app — no charge until it ends, and
              you can cancel anytime.
            </p>
          )}

          {/* Paid state */}
          {(sub.status === "active" || sub.status === "past_due") && (
            <p className="text-sm text-muted-foreground">
              {sub.cancel_at_period_end
                ? `Your plan is set to cancel on ${formatDate(sub.current_period_end)}.`
                : `Renews on ${formatDate(sub.current_period_end)}.`}
            </p>
          )}
          {sub.status === "past_due" && (
            <p className="text-sm text-warning">
              Your last payment failed. Update your card to avoid losing access.
            </p>
          )}

          {/* Actions — owner only */}
          {isOwner ? (
            <div className="flex flex-wrap gap-3">
              {needsPlan && (
                <Button
                  onClick={() => redirectTo("checkout")}
                  disabled={busy !== null}
                >
                  {busy === "checkout"
                    ? "Redirecting…"
                    : sub.has_billing_account
                      ? "Subscribe"
                      : "Start your free trial"}
                </Button>
              )}
              {sub.has_billing_account && (
                <Button
                  variant="outline"
                  onClick={() => redirectTo("portal")}
                  disabled={busy !== null}
                >
                  {busy === "portal" ? "Redirecting…" : "Manage billing"}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only the account owner can manage billing.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
