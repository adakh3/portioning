"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, PublicBooking } from "@/lib/api";

export default function PublicBookingSignPage() {
  const { token } = useParams<{ token: string }>();
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .getPublicBooking(token)
      .then(setBooking)
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <Centered>Loading…</Centered>;
  }
  if (error || !booking) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">This link isn’t available</h1>
        <p className="mt-2 text-neutral-500">
          It may have expired or been withdrawn. Please contact your caterer for a new link.
        </p>
      </Centered>
    );
  }

  return <BookingView booking={booking} token={token} onSigned={setBooking} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}

function BookingView({
  booking,
  token,
  onSigned,
}: {
  booking: PublicBooking;
  token: string;
  onSigned: (b: PublicBooking) => void;
}) {
  const money = (v: string | null) => (v == null ? "" : `${booking.currency_symbol}${v}`);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      {/* Header */}
      <header className="mb-6">
        <p className="text-sm font-medium text-neutral-500">{booking.business_name}</p>
        <h1 className="mt-1 text-2xl font-semibold">{booking.reference}</h1>
        {booking.customer_name && (
          <p className="mt-1 text-neutral-600">Prepared for {booking.customer_name}</p>
        )}
      </header>

      {booking.is_signed && <SignedBanner booking={booking} token={token} />}

      {/* Event details */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Event details
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Detail label="Date" value={booking.event_date} />
          <Detail label="Guests" value={booking.guest_count ? String(booking.guest_count) : null} />
          <Detail label="Type" value={booking.event_type} />
          <Detail label="Service" value={booking.service_style} />
          <Detail label="Venue" value={booking.venue_name || booking.venue_address} />
          <Detail label="Meal" value={booking.meal_type} />
        </dl>
      </section>

      {/* Menu */}
      {booking.menu.length > 0 && (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Menu</h2>
          <div className="space-y-3">
            {booking.menu.map((group) => (
              <div key={group.category}>
                <h3 className="text-sm font-semibold text-neutral-700">{group.category}</h3>
                <ul className="mt-1 text-sm text-neutral-600">
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Charges */}
      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Charges</h2>
        {booking.price_per_head && (
          <Row label={`Food / menu (${money(booking.price_per_head)} pp)`} value="" />
        )}
        {booking.line_items.map((li, i) => (
          <Row key={i} label={`${li.description}`} value={money(li.line_total)} />
        ))}
        <div className="mt-3 space-y-1 border-t border-neutral-200 pt-3">
          <Row label="Subtotal" value={money(booking.subtotal)} />
          <Row label={booking.tax_label} value={money(booking.tax_amount)} />
          <Row label="Total" value={money(booking.total)} bold />
        </div>
      </section>

      {booking.notes && (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Notes</h2>
          <p className="whitespace-pre-line text-sm text-neutral-600">{booking.notes}</p>
        </section>
      )}

      {booking.terms && (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Terms</h2>
          <p className="whitespace-pre-line text-xs text-neutral-500">{booking.terms}</p>
        </section>
      )}

      {!booking.is_signed && booking.signable && (
        <SignForm booking={booking} token={token} onSigned={onSigned} />
      )}
      {!booking.is_signed && !booking.signable && (
        <p className="mt-6 text-center text-sm text-neutral-500">
          This {booking.kind} can no longer be accepted online. Please contact your caterer.
        </p>
      )}
    </div>
  );
}

function SignedBanner({ booking, token }: { booking: PublicBooking; token: string }) {
  return (
    <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
      <p className="font-semibold text-green-800">Accepted &amp; signed ✓</p>
      <p className="mt-1 text-sm text-green-700">
        Signed by {booking.signer_name}
        {booking.signed_at ? ` on ${new Date(booking.signed_at).toLocaleDateString()}` : ""}.
      </p>
      <a
        href={api.publicBookingPdfUrl(token)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-sm font-medium text-green-800 underline"
      >
        Download signed copy (PDF)
      </a>
    </div>
  );
}

function SignForm({
  booking,
  token,
  onSigned,
}: {
  booking: PublicBooking;
  token: string;
  onSigned: (b: PublicBooking) => void;
}) {
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const canSubmit = name.trim().length > 0 && consent && !submitting;

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const updated = await api.signPublicBooking(token, {
        signer_name: name.trim(),
        consent,
        signature_image: padRef.current?.toDataURL() || undefined,
      });
      onSigned(updated);
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        /* not available in some environments */
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not submit your signature.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-neutral-300 bg-white p-5">
      <h2 className="text-lg font-semibold">Accept &amp; sign</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Confirm your booking with {booking.business_name}.
      </p>

      <label className="mt-4 block text-sm font-medium">
        Full name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          aria-label="Full name"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-4">
        <p className="mb-1 text-sm font-medium">Signature (optional)</p>
        <SignaturePad ref={padRef} />
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          aria-label="I agree to the terms"
          className="mt-0.5"
        />
        <span>
          I confirm I have read and agree to the terms above, and I accept this {booking.kind}
          {booking.total ? ` for a total of ${booking.currency_symbol}${booking.total}` : ""}.
        </span>
      </label>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="mt-4 w-full rounded-lg bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {submitting ? "Submitting…" : "Accept & sign"}
      </button>
    </section>
  );
}

// ── minimal canvas signature pad ──
interface SignaturePadHandle {
  toDataURL: () => string | null;
}

const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useImperativeHandle(ref, () => ({
    toDataURL: () => (dirty.current && canvasRef.current ? canvasRef.current.toDataURL("image/png") : null),
  }));

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();
    dirty.current = true;
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    const c = canvasRef.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={500}
        height={120}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full touch-none rounded-lg border border-dashed border-neutral-300 bg-neutral-50"
      />
      <button type="button" onClick={clear} className="mt-1 text-xs text-neutral-400 underline">
        Clear
      </button>
    </div>
  );
});

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-neutral-800">{value}</dd>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? "font-semibold" : "text-neutral-600"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
