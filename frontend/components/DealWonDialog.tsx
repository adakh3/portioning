"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";
import CountUp from "react-countup";
import { motion } from "framer-motion";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Celebration shown when an event is confirmed — the "deal won" moment. */
export default function DealWonDialog({
  open,
  onClose,
  eventName,
  repName,
  revenue,
  currencySymbol = "£",
}: {
  open: boolean;
  onClose: () => void;
  eventName: string;
  repName?: string | null;
  revenue: string | number;
  currencySymbol?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const fire = () => confetti({ particleCount: 120, spread: 75, origin: { y: 0.55 } });
    fire();
    const t = setTimeout(fire, 280);
    return () => clearTimeout(t);
  }, [open]);

  const amount = typeof revenue === "string" ? parseFloat(revenue) || 0 : revenue;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="sr-only">Deal won</DialogTitle>
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="flex flex-col items-center gap-2 py-4 text-center"
        >
          <div className="text-6xl" aria-hidden>🎉</div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-success">Deal won</p>
          <p className="text-xl font-bold text-foreground">{eventName}</p>
          {repName && <p className="text-sm text-muted-foreground">{repName}</p>}

          <div className="my-3 w-full rounded-xl bg-primary/10 px-6 py-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Booked</p>
            <p className="text-4xl font-bold tabular-nums text-primary">
              <CountUp end={amount} duration={1.2} separator="," prefix={currencySymbol} />
            </p>
          </div>

          <Button onClick={onClose} className="mt-1 w-full">Claim &amp; continue</Button>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
