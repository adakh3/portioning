"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useQuotes, useSiteSettings } from "@/lib/hooks";
import { useQueryState } from "@/lib/useQueryState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const STATUS_BADGE_VARIANT: Record<string, "secondary" | "info" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  sent: "info",
  accepted: "success",
  expired: "warning",
  declined: "destructive",
};

const STATUSES = ["all", "draft", "sent", "accepted", "expired", "declined"];

export default function QuotesPage() {
  return (
    <Suspense>
      <QuotesContent />
    </Suspense>
  );
}

function QuotesContent() {
  const [filter, setFilter] = useQueryState("status", "all");
  const { data: quotes = [], error: loadError, isLoading: loading } = useQuotes(filter);
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "£", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" };

  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Quotes</h1>
        <Button asChild>
          <Link href="/quotes/new">New Quote</Link>
        </Button>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {STATUSES.map((s) => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
            className={filter === s ? "bg-foreground text-background hover:bg-foreground/90" : "capitalize"}
          >
            <span className="capitalize">{s}</span>
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading quotes...</p>
      ) : quotes.length === 0 ? (
        <p className="text-muted-foreground">No quotes found.</p>
      ) : (
        <div className="space-y-3">
          {quotes.map((quote) => (
            <Link
              key={quote.id}
              href={`/quotes/${quote.id}`}
              className="block"
            >
              <Card className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">
                          Quote #{quote.id} v{quote.version}
                        </h3>
                        <Badge variant={STATUS_BADGE_VARIANT[quote.status] || "secondary"}>
                          {quote.status_display}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {quote.account_name} &middot; {quote.event_date} &middot; {quote.guest_count} guests
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">{settings.currency_symbol}{quote.total}</p>
                      <p className="text-xs text-muted-foreground">{new Date(quote.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
