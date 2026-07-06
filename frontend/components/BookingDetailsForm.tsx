"use client";

import { ChoiceOption, ProductLine } from "@/lib/api";
import CustomerSelect from "@/components/CustomerSelect";
import BusinessSelect from "@/components/BusinessSelect";
import VenueField from "@/components/VenueField";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** The booking-detail fields shared by the Quote and Event editors: customer
 * (+ B2B business), venue, the event/meal/service-style selects, booking date,
 * and optional notes. Controlled and presentational — it owns no entity state,
 * no save logic, and (deliberately) none of the totals inputs (price-per-head /
 * guest count / tax), so it can never alter totals math. Guest count and the
 * menu live in separate cards in both editors and stay there. */
export interface BookingDetailsValue {
  contact: string;        // primary_contact id ("" = none)
  is_b2b: boolean;
  account: string;        // account id ("" = none)
  venue: string;          // venue id ("" = none)
  venue_address: string;
  event_type: string;
  meal_type: string;
  service_style: string;
  booking_date: string;
  product: string;        // product line id ("" = none)
  notes: string;
}

export interface BookingDetailsFormProps {
  value: BookingDetailsValue;
  onChange: (patch: Partial<BookingDetailsValue>) => void;
  eventTypes: ChoiceOption[];
  mealTypes: ChoiceOption[];
  serviceStyles: ChoiceOption[];
  /** Active product lines; the product select is hidden when the org has none. */
  productLines?: ProductLine[];
  /** Set false to render Product elsewhere (e.g. the event header) instead of here. */
  showProduct?: boolean;
  /** The selected customer's address, offered as a one-click venue prefill. */
  customerAddress?: string;
  /** Render notes here (Event groups it in this block; Quote groups it elsewhere). */
  showNotes?: boolean;
  /** Quote injects its required Event Date field; Event has no date in this block. */
  eventDateSlot?: React.ReactNode;
}

export default function BookingDetailsForm({
  value,
  onChange,
  eventTypes,
  mealTypes,
  serviceStyles,
  productLines = [],
  showProduct = true,
  customerAddress,
  showNotes = false,
  eventDateSlot,
}: BookingDetailsFormProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Customer *</label>
        <CustomerSelect required value={value.contact} onChange={(v) => onChange({ contact: v })} />
      </div>
      <div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" checked={value.is_b2b} onChange={(e) => onChange({ is_b2b: e.target.checked })} />
          Business booking (B2B)
        </label>
        {value.is_b2b && (
          <div className="mt-2">
            <label className="block text-sm font-medium text-foreground mb-1">Business *</label>
            <BusinessSelect required value={value.account} onChange={(v) => onChange({ account: v })} />
          </div>
        )}
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-foreground mb-1">Venue</label>
        <VenueField
          venue={value.venue}
          address={value.venue_address}
          customerAddress={customerAddress}
          onVenue={(v) => onChange({ venue: v })}
          onAddress={(v) => onChange({ venue_address: v })}
        />
      </div>

      {eventDateSlot}

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
        <select value={value.event_type} onChange={(e) => onChange({ event_type: e.target.value })} className={selectClass}>
          <option value="">-- Select --</option>
          {eventTypes.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Meal Type</label>
        <select value={value.meal_type} onChange={(e) => onChange({ meal_type: e.target.value })} className={selectClass}>
          <option value="">-- Select --</option>
          {mealTypes.map((mt) => <option key={mt.value} value={mt.value}>{mt.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
        <select value={value.service_style} onChange={(e) => onChange({ service_style: e.target.value })} className={selectClass}>
          <option value="">-- Select --</option>
          {serviceStyles.map((ss) => <option key={ss.value} value={ss.value}>{ss.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Booking Date</label>
        <ValidatedInput type="date" value={value.booking_date} onChange={(e) => onChange({ booking_date: e.target.value })} />
      </div>
      {showProduct && productLines.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Product</label>
          <select value={value.product} onChange={(e) => onChange({ product: e.target.value })} className={selectClass} aria-label="Product line">
            <option value="">-- Select --</option>
            {productLines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {showNotes && (
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
          <Textarea value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} rows={2} maxLength={2000} />
        </div>
      )}
    </div>
  );
}
