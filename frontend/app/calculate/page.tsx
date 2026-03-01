"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  Dish,
  DishCategory,
  MenuTemplate,
  GuestMix,
  CheckResult,
  EventDishComment,
} from "@/lib/api";
import DishSelector from "@/components/DishSelector";
import GuestMixForm from "@/components/GuestMixForm";
import PortionsEditor from "@/components/PortionsEditor";
import WarningsBanner from "@/components/WarningsBanner";
import ValidationBanner from "@/components/ValidationBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export default function CalculatePage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
      <CalculatePageInner />
    </Suspense>
  );
}

function CalculatePageInner() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get("template");
  const eventId = searchParams.get("event");

  // Reference data
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [categories, setCategories] = useState<DishCategory[]>([]);
  const [templates, setTemplates] = useState<MenuTemplate[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup
  const [selectedDishIds, setSelectedDishIds] = useState<Set<number>>(new Set());
  const [guests, setGuests] = useState<GuestMix>({ gents: 50, ladies: 50 });
  const [bigEaters, setBigEaters] = useState(false);
  const [bigEatersPercentage, setBigEatersPercentage] = useState(20);

  // Portions — single source of truth
  const [portions, setPortions] = useState<Map<number, number>>(new Map());
  const [engineRecs, setEngineRecs] = useState<Map<number, number> | null>(null);

  // Engine warnings (from calculate API)
  const [engineWarnings, setEngineWarnings] = useState<string[]>([]);
  const [engineAdjustments, setEngineAdjustments] = useState<string[]>([]);

  // Validation
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);

  // Template tracking
  const [activeTemplateId, setActiveTemplateId] = useState<number | null>(null);

  // Save event
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventNotes, setEventNotes] = useState("");
  const [dishComments, setDishComments] = useState<Map<number, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  // Loading states
  const [calculating, setCalculating] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Track whether we've already loaded the URL template/event
  const urlTemplateLoaded = useRef(false);
  const urlEventLoaded = useRef(false);
  const eventLoadComplete = useRef(!eventId);  // true if no event to load

  // Load initial data
  useEffect(() => {
    Promise.all([api.getDishes(), api.getCategories(), api.getMenus()])
      .then(([d, c, m]) => {
        setDishes(d);
        setCategories(c);
        setTemplates(m);
      })
      .catch((e) => setError(e.message))
      .finally(() => setDataLoading(false));
  }, []);

  // Load template from URL param
  useEffect(() => {
    if (templateId && !dataLoading && !urlTemplateLoaded.current) {
      urlTemplateLoaded.current = true;
      loadTemplate(parseInt(templateId));
    }
  }, [templateId, dataLoading]);

  // Load event from URL param
  useEffect(() => {
    if (eventId && !dataLoading && !urlEventLoaded.current) {
      urlEventLoaded.current = true;
      loadEvent(parseInt(eventId));
    }
  }, [eventId, dataLoading]);

  const loadEvent = async (id: number) => {
    try {
      const event = await api.getEvent(id);
      setEditingEventId(event.id);
      setSelectedDishIds(new Set(event.dishes));
      setGuests({ gents: event.gents, ladies: event.ladies });
      setBigEaters(event.big_eaters);
      setBigEatersPercentage(event.big_eaters_percentage);
      setEventName(event.name);
      setEventDate(event.date);
      setEventNotes(event.notes || "");
      setSaveOpen(true);

      // Load dish comments and portions from saved snapshot
      const commentMap = new Map<number, string>();
      const portionMap = new Map<number, number>();
      if (event.dish_comments) {
        for (const dc of event.dish_comments) {
          if (dc.comment) commentMap.set(dc.dish_id, dc.comment);
          if (dc.portion_grams != null) portionMap.set(dc.dish_id, dc.portion_grams);
        }
      }
      setDishComments(commentMap);
      setPortions(portionMap);

      // Fetch engine recs for reference
      const engineResult = await api.calculate({
        dish_ids: event.dishes,
        guests: { gents: event.gents, ladies: event.ladies },
        big_eaters: event.big_eaters,
        big_eaters_percentage: event.big_eaters_percentage,
      });
      const recs = new Map<number, number>();
      for (const p of engineResult.portions) {
        recs.set(p.dish_id, p.grams_per_person);
      }
      setEngineRecs(recs);
      setEngineWarnings(engineResult.warnings);
      setEngineAdjustments(engineResult.adjustments_applied);

      // Fill in portions for any dishes that didn't have a snapshot
      setPortions((prev) => {
        const next = new Map(prev);
        for (const dishId of event.dishes) {
          if (!next.has(dishId)) next.set(dishId, 0);
        }
        return next;
      });

      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load event");
    } finally {
      eventLoadComplete.current = true;
    }
  };

  // Auto-calculate when dishes or guests change for custom menus (no template)
  const prevSelectionRef = useRef<string>("");
  useEffect(() => {
    const key = `${Array.from(selectedDishIds).sort().join(",")}-${guests.gents}-${guests.ladies}-${bigEaters}-${bigEatersPercentage}`;
    if (key === prevSelectionRef.current) return;
    prevSelectionRef.current = key;

    if (selectedDishIds.size > 0 && !activeTemplateId && eventLoadComplete.current) {
      autoCalculate();
    }
  }, [selectedDishIds, guests, bigEaters, bigEatersPercentage, activeTemplateId]);

  const autoCalculate = async () => {
    if (selectedDishIds.size === 0) return;
    setCalculating(true);
    try {
      const res = await api.calculate({
        dish_ids: Array.from(selectedDishIds),
        guests,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
      });
      const newRecs = new Map<number, number>();
      for (const p of res.portions) {
        newRecs.set(p.dish_id, p.grams_per_person);
      }
      // Preserve existing user portions; new dishes start at 0
      setPortions((prev) => {
        const next = new Map<number, number>();
        for (const p of res.portions) {
          next.set(p.dish_id, prev.has(p.dish_id) ? (prev.get(p.dish_id) ?? 0) : 0);
        }
        return next;
      });
      setEngineRecs(newRecs);
      setEngineWarnings(res.warnings);
      setEngineAdjustments(res.adjustments_applied);
      setCheckResult(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  const loadTemplate = async (id: number) => {
    try {
      const [t, preview] = await Promise.all([
        api.getMenu(id),
        api.getMenuPreview(id),
      ]);
      const ids = new Set(t.portions.map((p) => p.dish_id));
      setSelectedDishIds(ids);
      setGuests({ gents: t.default_gents, ladies: t.default_ladies });
      setActiveTemplateId(id);

      // Template stored portions go into editable column
      const templatePortions = new Map<number, number>();
      for (const p of preview.portions) {
        templatePortions.set(p.dish_id, p.grams_per_person);
      }
      setPortions(templatePortions);

      // Fetch engine recs for reference
      const engineResult = await api.calculate({
        dish_ids: Array.from(ids),
        guests: { gents: t.default_gents, ladies: t.default_ladies },
      });
      const recs = new Map<number, number>();
      for (const p of engineResult.portions) {
        recs.set(p.dish_id, p.grams_per_person);
      }
      setEngineRecs(recs);
      setEngineWarnings(preview.warnings);
      setEngineAdjustments(preview.adjustments_applied);
      setCheckResult(null);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load template");
    }
  };

  const handleTemplateChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) {
      setSelectedDishIds(new Set());
      setActiveTemplateId(null);
      setPortions(new Map());
      setEngineRecs(null);
      setCheckResult(null);
      setEngineWarnings([]);
      setEngineAdjustments([]);
      return;
    }
    loadTemplate(parseInt(id));
  }, []);

  const toggleDish = useCallback((id: number) => {
    setSelectedDishIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Clean up portions for removed dish
        setPortions((p) => {
          const np = new Map(p);
          np.delete(id);
          return np;
        });
      } else {
        next.add(id);
      }
      return next;
    });
    setCheckResult(null);
    if (activeTemplateId) {
      setActiveTemplateId(null);
    }
  }, [activeTemplateId]);

  const handleGuestsChange = useCallback((newGuests: GuestMix) => {
    setGuests(newGuests);
    setCheckResult(null);
    if (activeTemplateId) {
      setActiveTemplateId(null);
    }
  }, [activeTemplateId]);

  const handlePortionChange = useCallback((dishId: number, grams: number) => {
    setPortions((prev) => {
      const next = new Map(prev);
      next.set(dishId, grams);
      return next;
    });
    setCheckResult(null);
  }, []);

  const applyEngineValues = useCallback(() => {
    if (!engineRecs) return;
    setPortions(new Map(engineRecs));
    setCheckResult(null);
  }, [engineRecs]);

  const validate = async () => {
    if (selectedDishIds.size === 0) return;
    setCheckLoading(true);
    setError(null);
    try {
      const dishIds = Array.from(selectedDishIds);
      const userPortions = dishIds.map((id) => ({
        dish_id: id,
        grams_per_person: portions.get(id) ?? 0,
      }));
      const res = await api.checkPortions({
        dish_ids: dishIds,
        guests,
        user_portions: userPortions,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
      });
      setCheckResult(res);

      // Update engine recs from comparison data
      if (res.comparison && res.comparison.length > 0) {
        const recs = new Map<number, number>();
        for (const row of res.comparison) {
          recs.set(row.dish_id, row.engine_grams);
        }
        setEngineRecs(recs);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setCheckLoading(false);
    }
  };

  const handleDishCommentChange = useCallback((dishId: number, comment: string) => {
    setDishComments((prev) => {
      const next = new Map(prev);
      next.set(dishId, comment);
      return next;
    });
  }, []);

  const handleSaveEvent = async () => {
    if (!eventName.trim() || !eventDate) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(null);
    try {
      const dishIds = Array.from(selectedDishIds);
      const comments: EventDishComment[] = dishIds
        .map((id) => ({
          dish_id: id,
          comment: dishComments.get(id) ?? "",
          portion_grams: portions.get(id) ?? 0,
        }));
      const payload = {
        name: eventName.trim(),
        date: eventDate,
        gents: guests.gents,
        ladies: guests.ladies,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
        dish_ids: dishIds,
        notes: eventNotes,
        dish_comments: comments,
      };
      if (editingEventId) {
        await api.updateEvent(editingEventId, payload);
        setSaveSuccess(`Event "${eventName.trim()}" updated.`);
      } else {
        await api.createEvent(payload);
        setSaveSuccess(`Event "${eventName.trim()}" saved.`);
        setEventName("");
        setEventDate("");
        setEventNotes("");
        setSaveOpen(false);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const activeTemplate = templates.find((t) => t.id === activeTemplateId);
      const blob = await api.exportPDF({
        dish_ids: Array.from(selectedDishIds),
        guests,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
        menu_name: activeTemplate?.name || "Custom Menu",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "portioning-sheet.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  };

  if (dataLoading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const portionsDifferFromEngine =
    engineRecs &&
    Array.from(selectedDishIds).some((id) => {
      const p = portions.get(id) ?? 0;
      const e = engineRecs.get(id) ?? 0;
      return Math.abs(p - e) > 0.01;
    });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">
        {editingEventId ? `Editing: ${eventName}` : "Portioning"}
      </h1>

      {/* ── SETUP SECTION ── */}
      <Card>
        <CardContent className="pt-4">
          <label className="block text-sm font-medium text-foreground mb-1">
            Start from template (optional)
          </label>
          <select
            onChange={handleTemplateChange}
            defaultValue={templateId || ""}
            className="border border-input rounded-md px-3 py-2 text-sm w-full max-w-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">— Select a template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.dish_count} dishes)
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <DishSelector
        dishes={dishes}
        categories={categories}
        selectedIds={selectedDishIds}
        onToggle={toggleDish}
      />

      <GuestMixForm
        guests={guests}
        onChange={handleGuestsChange}
        bigEaters={bigEaters}
        onBigEatersChange={setBigEaters}
        bigEatersPercentage={bigEatersPercentage}
        onBigEatersPercentageChange={setBigEatersPercentage}
      />

      {/* ── ENGINE WARNINGS ── */}
      {(engineWarnings.length > 0 || engineAdjustments.length > 0) && (
        <WarningsBanner warnings={engineWarnings} adjustments={engineAdjustments} />
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {calculating && (
        <span className="text-sm text-muted-foreground">Calculating...</span>
      )}

      {/* ── PORTIONS TABLE ── */}
      <PortionsEditor
        dishes={dishes}
        categories={categories}
        selectedDishIds={selectedDishIds}
        portions={portions}
        engineRecs={engineRecs}
        onPortionChange={handlePortionChange}
        dishComments={dishComments}
        onDishCommentChange={handleDishCommentChange}
      />

      {/* ── ACTIONS ── */}
      {selectedDishIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={validate}
            disabled={checkLoading}
            size="lg"
          >
            {checkLoading ? "Validating..." : "Validate"}
          </Button>
          {portionsDifferFromEngine && (
            <Button
              onClick={applyEngineValues}
              variant="secondary"
            >
              Apply Engine Values
            </Button>
          )}
          <Button
            onClick={handleExportPDF}
            disabled={exporting}
            variant="outline"
          >
            {exporting ? "Exporting..." : "Export PDF"}
          </Button>
        </div>
      )}

      {checkResult && <ValidationBanner result={checkResult} />}

      {/* ── SAVE EVENT ── */}
      {saveSuccess && (
        <p className="text-success text-sm font-medium">{saveSuccess}</p>
      )}
      {selectedDishIds.size > 0 && (
        <Card>
          <button
            type="button"
            onClick={() => setSaveOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-foreground hover:bg-muted transition-colors rounded-t-lg"
          >
            <span>{editingEventId ? "Update Event" : "Save as Event"}</span>
            <span className="text-muted-foreground text-sm">{saveOpen ? "▲" : "▼"}</span>
          </button>
          {saveOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Event Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="text"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder="e.g. Wedding Reception"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Date <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Event Notes
                </label>
                <Textarea
                  value={eventNotes}
                  onChange={(e) => setEventNotes(e.target.value)}
                  placeholder="Overall notes about this event..."
                  rows={2}
                />
              </div>
              <Button
                onClick={handleSaveEvent}
                disabled={saving || !eventName.trim() || !eventDate}
                variant="success"
              >
                {saving ? "Saving..." : editingEventId ? "Update Event" : "Save Event"}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
