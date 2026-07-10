"use client";

import BillingPanel from "@/components/BillingPanel";

// Standalone billing page. This route is the Stripe Checkout return target
// (/billing?status=success) and the paywall redirect target for locked-out
// orgs, so it must keep working on its own — it only calls billing endpoints,
// which the subscription gate exempts. The in-app entry point is the Billing
// tab in Settings (which renders the same BillingPanel).
export default function BillingPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription to the app.
        </p>
      </div>
      <BillingPanel />
    </div>
  );
}
