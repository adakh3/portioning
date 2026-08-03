"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { api, collectErrorMessages, MenuTemplateDetail, CourseData, MenuChoices, PriceTier, PriceCheckResult, PriceCheckBreakdownItem, PriceEstimateResult } from "@/lib/api";
import { useDishes, useCategories, useMenus } from "@/lib/hooks";
import { formatCurrency } from "@/lib/utils";
import DietaryTagPills from "@/components/DietaryTagPills";
import DishPickerInline from "@/components/DishPickerInline";
import {
  DndContext, DragOverlay, PointerSensor, closestCenter,
  useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  assignDish, courseWarning, menuSections, moveDish, removeCourse, toggleChoice,
} from "@/lib/menuStructure";

/** A course (or the unassigned section) as a drop target. While a dish is in the
 * air every section outlines itself, and the one under the cursor fills in — the
 * marker is the course you'd land in, because landing in a course is the only thing
 * a drop decides. Order within a course isn't part of the save payload, so there is
 * no insertion point to point at. */
function DropSection({
  courseIndex, dragging, children,
}: {
  courseIndex: number | null;
  dragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `section-${courseIndex ?? "unassigned"}` });
  return (
    <div
      ref={setNodeRef}
      data-testid={`drop-section-${courseIndex ?? "unassigned"}`}
      data-over={isOver ? "true" : undefined}
      className={`border-b border-border py-3 rounded-md transition-colors ${
        dragging ? "outline-dashed outline-1 outline-offset-2 outline-border" : ""
      } ${isOver ? "bg-primary/5 outline-primary outline-2" : ""}`}
    >
      {children}
    </div>
  );
}

/** One dish row, draggable by its handle. The handle (not the whole row) carries the
 * listeners so the choice chip and the ✕ stay clickable.
 *
 * ↑/↓ on the focused handle move the dish to the previous/next course. That is a hand
 * -rolled key handler rather than dnd-kit's KeyboardSensor, for the reason
 * BookingTimelineField gives: the sensor's drag-and-measure loop needs layout, so it
 * can't be driven in jsdom and is flaky in Playwright. This is the same move, it is
 * testable, and it means removing the ↑↓ BUTTONS didn't remove non-mouse access. */
function DragRow({
  dishId, dishName, draggable, indent, onKeyMove, children,
}: {
  dishId: number;
  dishName: string;
  draggable: boolean;
  indent: boolean;
  onKeyMove: (dishId: number, direction: -1 | 1) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(dishId), disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-2 py-1 ${indent ? "pl-3" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {draggable && (
        <button
          type="button"
          aria-label={`Move ${dishName} to another course — drag, or use the arrow keys`}
          {...attributes}
          {...listeners}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            e.stopPropagation();
            onKeyMove(dishId, e.key === "ArrowUp" ? -1 : 1);
          }}
          className="cursor-grab select-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60 focus:opacity-60"
        >
          ⠿
        </button>
      )}
      {children}
    </div>
  );
}

interface CalculatedPrice {
  price: number;
  source: "tier" | "template_adjusted" | "computed";
  tierLabel?: string;
  breakdown?: PriceCheckBreakdownItem[];
  totalAdjustment?: number;
  hasUnpriced: boolean;
}

function roundToStep(value: number, step: number): number {
  if (step <= 1) return value;
  return Math.round(value / step) * step;
}

/** Readable message for a thrown API error. The api layer throws an Error with
 * an already-sanitized message; fall back to flattening a raw DRF payload. */
function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return collectErrorMessages(e).join(" ");
}

interface Props {
  selectedDishIds: number[];
  basedOnTemplate: number | null;
  guestCount?: number;
  onSave?: (data: { dish_ids: number[]; based_on_template: number | null }) => Promise<void>;
  onChange?: (data: { dish_ids: number[]; based_on_template: number | null }) => void;
  /** REL-417: when a template with courses is loaded, its course structure is
   * surfaced so the booking can carry it over (AC6). */
  onLoadCourses?: (courses: CourseData[], dishCourses: Record<string, number>) => void;
  /** The menu's structure (REL-451). Courses contain dishes, and on a plated booking
   * a dish inside a course can be marked as one of the guest's options — one card,
   * one thought. Owned by the page (it goes in the single save payload); this
   * component reads it and reports edits through `onStructureChange`. */
  courses?: CourseData[];
  dishCourses?: Record<string, number>;
  menuChoices?: MenuChoices;
  /** Choice affordances are plated-only; buffet/family style keep the flags but
   * never show them (AC8). */
  plated?: boolean;
  /** "Plated dinner", "Buffet", … — the header subtitle's first word. */
  serviceStyleLabel?: string;
  onStructureChange?: (v: {
    courses: CourseData[];
    dishCourses: Record<string, number>;
    menuChoices: MenuChoices;
  }) => void;
  pricePerHead?: string;
  onPricePerHeadChange?: (value: string) => void;
  currencySymbol?: string;
  disabled?: boolean;
  priceRoundingStep?: number;
}

export default function MenuBuilder({
  selectedDishIds,
  basedOnTemplate,
  guestCount,
  onSave,
  onChange,
  onLoadCourses,
  courses = [],
  dishCourses = {},
  menuChoices = {},
  plated = false,
  serviceStyleLabel,
  onStructureChange,
  pricePerHead,
  onPricePerHeadChange,
  currencySymbol = "",
  disabled = false,
  priceRoundingStep = 1,
}: Props) {
  const { data: dishes = [] } = useDishes();
  const { data: categories = [] } = useCategories();
  const { data: templates = [], isLoading: loading } = useMenus();

  const [selected, setSelected] = useState<Set<number>>(new Set(selectedDishIds));
  const [templateId, setTemplateId] = useState<number | null>(basedOnTemplate);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showSelector, setShowSelector] = useState(false);
  /** Which course the open picker adds into — `null` means the unassigned section
   * (or the whole menu when the booking has no courses). Scoping the picker is what
   * removes the old second step of assigning a dish after picking it (AC8b). */
  const [pickerCourse, setPickerCourse] = useState<number | null>(null);
  /** The dish being dragged, and the row it would land above — the insertion line. */
  const [dragging, setDragging] = useState<number | null>(null);

  // Track if changes have been made
  const [dirty, setDirty] = useState(false);

  // Template pricing state
  const [templatePriceTiers, setTemplatePriceTiers] = useState<PriceTier[]>([]);
  const [originalDishIds, setOriginalDishIds] = useState<Set<number>>(new Set());
  // Whether user has modified dishes since loading template
  const [dishesModified, setDishesModified] = useState(false);

  // Calculate Rate state
  const [calculatedPrice, setCalculatedPrice] = useState<CalculatedPrice | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  // Extra food % markup
  const [extraFoodPercent, setExtraFoodPercent] = useState(0);

  // Sync with external prop changes
  useEffect(() => {
    setSelected(new Set(selectedDishIds));
    setTemplateId(basedOnTemplate);
    setDirty(false);
  }, [selectedDishIds, basedOnTemplate]);

  // Client-side tier selection (no API) for unmodified template + guest count
  const tierPrice = useMemo(() => {
    if (!guestCount || !templateId || dishesModified || templatePriceTiers.length === 0) return null;
    const matching = templatePriceTiers
      .filter((t) => t.min_guests <= guestCount)
      .sort((a, b) => b.min_guests - a.min_guests);
    if (matching.length === 0) return null;
    const tier = matching[0];
    return {
      price: roundToStep(parseFloat(tier.price_per_head), priceRoundingStep),
      label: `${tier.min_guests}+ pax`,
    };
  }, [guestCount, templateId, dishesModified, templatePriceTiers, priceRoundingStep]);

  // Apply extra food % markup to a base price
  const applyExtra = (base: number) => {
    const marked = base * (1 + extraFoodPercent / 100);
    return roundToStep(marked, priceRoundingStep);
  };

  // Determine active price for parent notification
  const activePrice = useMemo(() => {
    if (tierPrice) return applyExtra(tierPrice.price);
    if (calculatedPrice) return applyExtra(calculatedPrice.price);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierPrice, calculatedPrice, extraFoodPercent]);

  // Esc closes the dish picker — one of its three ways out (AC8b).
  useEffect(() => {
    if (!showSelector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSelector(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSelector]);

  // Track last auto-filled price so we only overwrite when user hasn't manually edited
  const lastAutoFilledRef = useRef<string>("");

  // Auto-fill price/head when suggested price changes
  useEffect(() => {
    if (activePrice === null || !onPricePerHeadChange) return;
    const newVal = activePrice.toFixed(2);
    // Already showing this value — do nothing. Without this guard the parent's
    // onPricePerHeadChange (a fresh closure each render that always builds a new
    // state object) would re-fire this effect forever → "Maximum update depth".
    // Already showing this value — do nothing. Without this guard the parent's
    // onPricePerHeadChange (a fresh closure each render that always builds a new
    // state object) would re-fire this effect forever → "Maximum update depth".
    if (pricePerHead === newVal) {
      lastAutoFilledRef.current = newVal;
      return;
    }
    // Auto-fill if field is empty, or still matches the last auto-filled value
    if (!pricePerHead || pricePerHead === lastAutoFilledRef.current) {
      lastAutoFilledRef.current = newVal;
      onPricePerHeadChange(newVal);
    }
  }, [activePrice, onPricePerHeadChange, pricePerHead]);

  // Reset calculated price when dishes change
  const toggleDish = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
    setDirty(true);
    setDishesModified(true);
    setCalculatedPrice(null);
    setPriceError(null);
    // A dish leaving the menu takes its course assignment and choice flag with it —
    // otherwise a stale entry would point at a dish that isn't on the booking.
    if (!next.has(id) && onStructureChange) {
      const nextCourses = { ...dishCourses };
      delete nextCourses[id];
      const nextChoices = { ...menuChoices };
      delete nextChoices[id];
      onStructureChange({ courses, dishCourses: nextCourses, menuChoices: nextChoices });
    }
    onChange?.({ dish_ids: Array.from(next), based_on_template: templateId });
  };

  // ---- Menu structure (REL-451) ----
  const emit = (v: Partial<{
    courses: CourseData[];
    dishCourses: Record<string, number>;
    menuChoices: MenuChoices;
  }>) => {
    // Deliberately does NOT set `dirty`. That flag surfaces this card's own "Save
    // Menu" button, which posts `dish_ids` alone — structure rides in the page's
    // main save instead. Lighting it up here would show a Save that silently
    // dropped the course and choice edits it appeared to be saving.
    onStructureChange?.({ courses, dishCourses, menuChoices, ...v });
  };

  const dishIdsInOrder = selectedDishIds.filter((id) => selected.has(id))
    .concat(Array.from(selected).filter((id) => !selectedDishIds.includes(id)));
  const sections = menuSections(dishIdsInOrder, courses, dishCourses, menuChoices, plated);
  /** No courses at all → the card is a plain list (AC8): no headers, no scaffolding. */
  const isFlat = courses.length === 0;

  const addCourse = () =>
    emit({ courses: [...courses, { name: "", sort_order: courses.length }] });

  const renameCourse = (idx: number, name: string) =>
    emit({ courses: courses.map((c, i) => (i === idx ? { ...c, name } : c)) });

  const dropCourse = (idx: number) => emit(removeCourse(idx, courses, dishCourses, menuChoices));

  // Drag a dish into another course — the same @dnd-kit setup the leads kanban uses
  // to move a card between columns, which is the identical problem. PointerSensor
  // covers mouse and touch; KeyboardSensor makes the handle operable without either.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /** The keyboard path for the same move — see DragRow. */
  const moveRow = (dishId: number, direction: -1 | 1) =>
    emit(moveDish(dishId, direction, sections, dishCourses, menuChoices));

  const handleDragEnd = (e: DragEndEvent) => {
    const dishId = Number(e.active.id);
    setDragging(null);
    if (!e.over) return;
    const target = String(e.over.id).replace("section-", "");
    putInCourse(dishId, target === "unassigned" ? null : Number(target));
  };

  const putInCourse = (dishId: number, courseIndex: number | null) =>
    emit(assignDish(dishId, courseIndex, dishCourses, menuChoices));

  const markChoice = (dishId: number) =>
    emit({ menuChoices: toggleChoice(menuChoices, dishId) });

  /** Open the picker for a course, or close it if that course's trigger is clicked
   * again — the trigger reads "Done" while open, one of the three ways out (AC8b). */
  const openPickerFor = (courseIndex: number | null) => {
    if (showSelector && pickerCourse === courseIndex) {
      setShowSelector(false);
      return;
    }
    setPickerCourse(courseIndex);
    setShowSelector(true);
    setSearch("");
  };

  /** Add a dish straight into the course the picker was opened for. */
  const addDishToPickerCourse = (dishId: number) => {
    if (selected.has(dishId)) return;  // already on the menu — the row reads "on menu"
    const next = new Set(selected);
    next.add(dishId);
    setSelected(next);
    setDirty(true);
    setDishesModified(true);
    setCalculatedPrice(null);
    setPriceError(null);
    onChange?.({ dish_ids: Array.from(next), based_on_template: templateId });
    if (pickerCourse !== null) putInCourse(dishId, pickerCourse);
  };

  const handleLoadTemplate = async (tid: number) => {
    try {
      const detail: MenuTemplateDetail = await api.getMenu(tid);
      const dishIds = detail.portions.map((p) => p.dish_id);
      setSelected(new Set(dishIds));
      setTemplateId(tid);
      setDirty(true);
      setDishesModified(false);
      setTemplatePriceTiers(detail.price_tiers || []);
      setOriginalDishIds(new Set(dishIds));
      setCalculatedPrice(null);
      setPriceError(null);
      onChange?.({ dish_ids: dishIds, based_on_template: tid });
      // Carry the template's courses onto the booking (REL-417 AC6). Always fire —
      // a course-less template clears any stale courses from a previously-loaded one.
      onLoadCourses?.(detail.courses || [], detail.dish_courses || {});
      // A template rewrites which course every dish is in, so the flags cannot
      // survive it: the same rule as dragging a dish across courses (AC2). Keeping
      // them would leave a dish marked "guests choose" in a course the caterer never
      // declared a choice for — and often a lone option, warning about itself.
      onStructureChange?.({
        courses: detail.courses || [],
        dishCourses: detail.dish_courses || {},
        menuChoices: {},
      });
    } catch (e) {
      setPriceError(errorText(e) || "Couldn't load that template.");
    }
  };

  const handleClearMenu = () => {
    setSelected(new Set());
    setTemplateId(null);
    setDirty(true);
    setDishesModified(true);
    setTemplatePriceTiers([]);
    setOriginalDishIds(new Set());
    setCalculatedPrice(null);
    setPriceError(null);
    onChange?.({ dish_ids: [], based_on_template: null });
    // The structure goes with the dishes, for the same reason removing a single dish
    // clears its own: a course assignment or choice flag pointing at a dish that is
    // no longer on the booking is a stale key in the save payload.
    onStructureChange?.({ courses, dishCourses: {}, menuChoices: {} });
  };

  const handleCalculateRate = async () => {
    if (!guestCount || selected.size === 0) return;
    setPriceLoading(true);
    setPriceError(null);
    try {
      const dishIds = Array.from(selected);
      if (templateId && dishesModified) {
        // Template with modifications — use price-check endpoint
        const result: PriceCheckResult = await api.menuPriceCheck(templateId, {
          guest_count: guestCount,
          dish_ids: dishIds,
        });
        setCalculatedPrice({
          price: roundToStep(result.adjusted_price, priceRoundingStep),
          source: "template_adjusted",
          tierLabel: result.tier_label,
          breakdown: result.breakdown,
          totalAdjustment: result.total_adjustment,
          hasUnpriced: false,
        });
      } else {
        // Custom menu — use price-estimate endpoint
        const result: PriceEstimateResult = await api.priceEstimate({
          dish_ids: dishIds,
          guest_count: guestCount,
        });
        setCalculatedPrice({
          price: roundToStep(result.price_per_head, priceRoundingStep),
          source: "computed",
          hasUnpriced: result.has_unpriced,
        });
      }
    } catch (e) {
      setCalculatedPrice(null);
      setPriceError(
        errorText(e) || "Couldn't calculate the rate. Please try again."
      );
    } finally {
      setPriceLoading(false);
    }
  };

  // Auto-calculate a suggested per-head rate for custom menus (no matching
  // tier) so it appears without the user clicking "Calculate Rate".
  useEffect(() => {
    if (!guestCount || guestCount <= 0 || selected.size === 0) return;
    if (tierPrice || calculatedPrice) return;
    const t = setTimeout(() => {
      handleCalculateRate();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestCount, selected, tierPrice, calculatedPrice, templateId, dishesModified]);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        dish_ids: Array.from(selected),
        based_on_template: templateId,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // Get dish names for the current selection
  const selectedDishes = dishes.filter((d) => selected.has(d.id));
  const templateName = templates.find((t) => t.id === templateId)?.name;

  // Determine pricing bar state
  const hasDishes = selected.size > 0;
  const hasGuestCount = !!guestCount && guestCount > 0;
  const isTemplate = !!templateId;
  const showTierPrice = hasGuestCount && isTemplate && !dishesModified && tierPrice !== null;
  const showCalculateButton = hasGuestCount && hasDishes && !showTierPrice;

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading menu options...</p>;
  }

  return (
    <div className="space-y-4">
      {/* What this menu is being served as. It reads as context, but it's also the
          one thing that decides whether choices are offered at all (AC8) — so
          naming it here is what makes the card's plated-only behaviour legible. */}
      {(serviceStyleLabel || guestCount) && (
        <p data-testid="menu-service-line" className="-mt-2 text-sm text-muted-foreground">
          {[serviceStyleLabel, guestCount ? `${guestCount} guests` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {/* Template Picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <select
            aria-label="Load from template"
            value=""
            onChange={(e) => {
              if (e.target.value) handleLoadTemplate(Number(e.target.value));
            }}
            disabled={disabled}
            className="h-9 appearance-none rounded-md border border-input bg-background pl-3 pr-9 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Load from template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.dish_count} dishes)
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {/* No top-level "Pick Individual Dishes": the picker is course-scoped now
            (AC8b), so it opens from the "+ dish" inside the section it adds to. A
            global trigger had no course to belong to — with every dish assigned there
            was no unassigned section to render it in, and it did nothing at all. */}
        {selected.size > 0 && !disabled && (
          <button
            type="button"
            onClick={handleClearMenu}
            className="text-destructive text-sm hover:text-destructive/80"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Template indicator */}
      {templateName && (
        <p className="text-xs text-muted-foreground">
          Based on template: <span className="font-medium">{templateName}</span>
        </p>
      )}

      {/* The menu as one structure: courses containing dishes, with the guest
          choice marked inside the course (REL-451). A course-less booking is a plain
          list — no headers, no empty scaffolding. */}
      {selectedDishes.length === 0 && isFlat ? (
        <div>
          {/* Only when there is no structure at all. Courses without dishes still
              render their sections, so an outlined menu can be filled course by
              course from the "+ dish" trigger inside each one. */}
          <p className="text-sm text-muted-foreground">
            No dishes yet. Load a template or add dishes.
          </p>
          {/* Nothing on the menu means no section to anchor the picker to. */}
          {showSelector && !disabled && (
            <DishPickerInline
              dishes={dishes}
              categories={categories}
              onMenuDishIds={selected}
              onAdd={addDishToPickerCourse}
              onClose={() => setShowSelector(false)}
              courseName="the menu"
            />
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setDragging(Number(e.active.id))}
          onDragCancel={() => setDragging(null)}
          onDragEnd={handleDragEnd}
        >
        <div data-testid="menu-structure" className="border-t border-border">
          {sections.map((section) => {
            const warning = courseWarning(section);
            return (
              <DropSection
                key={section.courseIndex ?? "unassigned"}
                courseIndex={section.courseIndex}
                dragging={dragging !== null}
              >
                {!isFlat && (
                  <div className="flex items-center gap-3 mb-1.5">
                    {section.courseIndex === null ? (
                      <span className="text-sm font-semibold text-foreground">On the table</span>
                    ) : disabled ? (
                      <span className="text-sm font-semibold text-foreground">{section.name}</span>
                    ) : (
                      <input
                        type="text"
                        aria-label={`Course ${section.courseIndex + 1} name`}
                        placeholder="Course name"
                        value={courses[section.courseIndex].name}
                        onChange={(e) => renameCourse(section.courseIndex as number, e.target.value)}
                        className="text-sm font-semibold text-foreground bg-transparent border-b border-transparent hover:border-input focus:border-input focus:outline-none px-0.5 -ml-0.5 w-44"
                      />
                    )}
                    {/* Only the single-option state gets a line: it is the one thing
                        you can't read off the rows themselves (AC7). */}
                    <span className="flex-1 text-sm text-warning">
                      {warning}
                    </span>
                    {!disabled && section.courseIndex !== null && (
                      <button
                        type="button"
                        aria-label={`Remove course ${section.name}`}
                        onClick={() => dropCourse(section.courseIndex as number)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                )}

                {section.dishIds.map((id, i) => {
                  const dish = dishes.find((d) => d.id === id);
                  if (!dish) return null;
                  const offered = section.chosenIds.includes(id);
                  // The *or* sits between the options, so the pair reads as the
                  // either/or the caterer is declaring — never separated (AC5).
                  const showOr = offered && i > 0 && section.chosenIds.includes(section.dishIds[i - 1]);
                  return (
                    <div key={id}>
                      {showOr && (
                        <div className="text-xs text-muted-foreground italic pl-1 py-0.5">or</div>
                      )}
                      {/* `group` drives the hover affordances: the drag handle and
                          (on an unflagged dish) the choice chip only appear on hover.
                          `focus-within` keeps them reachable by keyboard — hover-only
                          must never mean mouse-only. */}
                      <DragRow
                        dishId={id}
                        dishName={dish.name}
                        draggable={!disabled && !isFlat}
                        indent={!isFlat}
                        onKeyMove={moveRow}
                      >
                        <span className="text-sm text-foreground">{dish.name}</span>
                        {/* The legacy flag only shows for dishes with no dietary tags —
                            otherwise the pills already say it, and say it better
                            (REL-416 AC3). */}
                        {dish.is_vegetarian && !dish.dietary_tags?.length && (
                          <span className="text-success text-xs">V</span>
                        )}
                        <DietaryTagPills tags={dish.dietary_tags} />
                        <span className="flex-1" />
                        {plated && section.courseIndex !== null && !disabled && (
                          <button
                            type="button"
                            aria-label={`${offered ? "Remove" : "Mark"} ${dish.name} as a guest choice`}
                            onClick={() => markChoice(id)}
                            className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                              offered
                                ? "bg-primary/10 text-primary border-primary/30"
                                : "bg-muted text-muted-foreground border-border opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            }`}
                          >
                            {offered ? "guests choose" : "make it a choice"}
                          </button>
                        )}
                        {!disabled && (
                          <button
                            type="button"
                            aria-label={`Remove ${dish.name}`}
                            onClick={() => toggleDish(id)}
                            className="text-muted-foreground hover:text-destructive px-1"
                          >
                            &times;
                          </button>
                        )}
                      </DragRow>
                    </div>
                  );
                })}

                {showSelector && pickerCourse === section.courseIndex && !disabled && (
                  <div className={isFlat ? "" : "pl-3"}>
                    <DishPickerInline
                      dishes={dishes}
                      categories={categories}
                      onMenuDishIds={selected}
                      onAdd={addDishToPickerCourse}
                      onClose={() => setShowSelector(false)}
                      courseName={section.courseIndex === null ? "the menu" : (section.name || "this course")}
                    />
                  </div>
                )}

                {!disabled && !isFlat && (
                  <button
                    type="button"
                    onClick={() => openPickerFor(section.courseIndex)}
                    className="text-sm text-primary hover:underline pl-3 mt-1"
                  >
                    {showSelector && pickerCourse === section.courseIndex ? "Done" : "+ dish"}
                  </button>
                )}
              </DropSection>
            );
          })}
        </div>
        {/* The dish travels with the cursor, so it's obvious what is being moved
            while the target course highlights underneath it. */}
        <DragOverlay dropAnimation={null}>
          {dragging !== null && (
            <div className="rounded-md border border-primary bg-background px-3 py-1 text-sm shadow-lg">
              {dishes.find((d) => d.id === dragging)?.name}
            </div>
          )}
        </DragOverlay>
        </DndContext>
      )}

      {/* Footer: add a course, or (flat) add a dish + the running count. */}
      {!disabled && (
        <div className="flex items-center gap-4">
          {isFlat ? (
            <>
              <button
                type="button"
                onClick={() => openPickerFor(null)}
                className="text-sm text-primary hover:underline"
              >
                {pickerCourse === null && showSelector ? "Done" : "+ Add dish"}
              </button>
              {selectedDishes.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedDishes.length} {selectedDishes.length === 1 ? "dish" : "dishes"}
                </span>
              )}
              {/* Same action and same words as the sectioned footer — an earlier
                  "Group into courses" only described what happens the FIRST time and
                  read as a different feature. Offered even on an empty menu: naming
                  the courses first and filling them after is how a caterer outlines a
                  dinner, and it is the only route to a course on a booking with no
                  dishes yet. */}
              <button
                type="button"
                onClick={addCourse}
                className="text-sm text-primary hover:underline"
              >
                + Add course
              </button>
            </>
          ) : (
            <button type="button" onClick={addCourse} className="text-sm text-primary hover:underline">
              + Add course
            </button>
          )}
        </div>
      )}

      {/* Price per head — always visible & clearable, not gated on dishes (so a
          no-menu booking can set or zero it; the dish-based helpers below only
          suggest a value). */}
      {onPricePerHeadChange && (
        <div className="flex items-center gap-3 bg-muted border border-border rounded-lg px-4 py-2.5">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Price/head</span>
            <span className="text-muted-foreground">{currencySymbol}</span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={pricePerHead || ""}
              onChange={(e) => onPricePerHeadChange(e.target.value)}
              placeholder="0.00"
              disabled={disabled}
              className="w-24 border border-input rounded px-2 py-1 text-sm text-right"
            />
          </label>
          {!hasDishes && (
            <span className="text-xs text-muted-foreground">No menu selected — set a price per head, or pick dishes for a suggestion.</span>
          )}
        </div>
      )}

      {/* Pricing Summary Bar */}
      {hasDishes && (
        <>
          {!hasGuestCount ? (
            /* No guest count */
            <div className="flex items-center gap-3 bg-muted border border-border rounded-lg px-4 py-2.5">
              <span className="text-sm text-muted-foreground">
                Enter guest count to see suggested pricing
              </span>
            </div>
          ) : showTierPrice && tierPrice ? (
            /* Template, unmodified, has tier */
            <div className="flex items-center gap-3 flex-wrap bg-success/10 border border-success/20 rounded-lg px-4 py-2.5">
              <span className="text-sm font-medium text-success">
                {formatCurrency(applyExtra(tierPrice.price), currencySymbol)}/head
              </span>
              <span className="text-xs text-success/80">
                ({tierPrice.label} tier)
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                Extra food
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={extraFoodPercent || ""}
                  onChange={(e) => setExtraFoodPercent(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-14 border border-input rounded px-1.5 py-0.5 text-xs text-center"
                />
                %
              </label>
            </div>
          ) : showCalculateButton ? (
            /* Need to calculate */
            <div className="flex items-center gap-3 flex-wrap bg-muted border border-border rounded-lg px-4 py-2.5">
              {calculatedPrice ? (
                <div className="flex flex-col gap-1.5 w-full">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-success">
                      {formatCurrency(applyExtra(calculatedPrice.price), currencySymbol)}/head
                    </span>
                    {calculatedPrice.hasUnpriced && (
                      <span className="inline-flex items-center bg-warning/15 text-warning text-xs font-medium px-2 py-0.5 rounded">
                        Some dishes unpriced
                      </span>
                    )}
                    {calculatedPrice.source === "template_adjusted" && (
                      <span className="text-xs text-success/80">
                        ({calculatedPrice.tierLabel} tier {calculatedPrice.totalAdjustment !== undefined && calculatedPrice.totalAdjustment >= 0 ? "+" : ""}{formatCurrency(calculatedPrice.totalAdjustment ?? 0, currencySymbol)})
                      </span>
                    )}
                    {calculatedPrice.source === "computed" && (
                      <span className="text-xs text-success/80">(computed from engine)</span>
                    )}
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      Extra food
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={extraFoodPercent || ""}
                        onChange={(e) => setExtraFoodPercent(Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-14 border border-input rounded px-1.5 py-0.5 text-xs text-center"
                      />
                      %
                    </label>
                  </div>
                  {calculatedPrice.breakdown && calculatedPrice.breakdown.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {calculatedPrice.breakdown.map((item, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded ${
                            item.type === "addition"
                              ? "bg-warning/10 text-warning border border-warning/20"
                              : "bg-info/10 text-info border border-info/20"
                          }`}
                        >
                          {item.amount >= 0 ? "+" : ""}{formatCurrency(item.amount, currencySymbol)} {item.dish}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCalculateRate}
                    disabled={priceLoading || disabled}
                    className="border border-primary/30 text-primary bg-background px-4 py-1.5 rounded text-sm font-medium hover:bg-primary/5 disabled:opacity-50"
                  >
                    {priceLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Calculating...
                      </span>
                    ) : (
                      "Calculate Rate"
                    )}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {isTemplate && dishesModified
                      ? "Menu modified — click to recalculate"
                      : "Click to compute price from engine"}
                  </span>
                </>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* Pricing error (engine/price-estimate failure) */}
      {priceError && (
        <div className="flex items-center justify-between gap-3 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2.5 text-sm text-destructive">
          <span>{priceError}</span>
          {hasGuestCount && hasDishes && (
            <button
              type="button"
              onClick={handleCalculateRate}
              disabled={priceLoading}
              className="font-medium underline hover:no-underline disabled:opacity-50 shrink-0"
            >
              {priceLoading ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}

      {/* Save button (only when onSave provided, not in onChange/creation mode) */}
      {dirty && !disabled && onSave && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Menu"}
          </button>
        </div>
      )}
    </div>
  );
}
