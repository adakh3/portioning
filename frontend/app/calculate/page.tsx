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
} from "@/lib/api";
import DishSelector from "@/components/DishSelector";
import GuestMixForm from "@/components/GuestMixForm";
import PortionsEditor from "@/components/PortionsEditor";
import WarningsBanner from "@/components/WarningsBanner";
import ValidationBanner from "@/components/ValidationBanner";

export default function CalculatePage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Loading...</p>}>
      <CalculatePageInner />
    </Suspense>
  );
}

function CalculatePageInner() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get("template");

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

  // Loading states
  const [calculating, setCalculating] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Track whether we've already loaded the URL template
  const urlTemplateLoaded = useRef(false);

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

  // Auto-calculate when dishes or guests change for custom menus (no template)
  const prevSelectionRef = useRef<string>("");
  useEffect(() => {
    const key = `${Array.from(selectedDishIds).sort().join(",")}-${guests.gents}-${guests.ladies}-${bigEaters}-${bigEatersPercentage}`;
    if (key === prevSelectionRef.current) return;
    prevSelectionRef.current = key;

    if (selectedDishIds.size > 0 && !activeTemplateId) {
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
    return <p className="text-gray-500">Loading...</p>;
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
      <h1 className="text-2xl font-bold text-gray-900">Portioning</h1>

      {/* ── SETUP SECTION ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Start from template (optional)
        </label>
        <select
          onChange={handleTemplateChange}
          defaultValue={templateId || ""}
          className="border border-gray-300 rounded px-3 py-2 text-sm w-full max-w-xs"
        >
          <option value="">— Select a template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.dish_count} dishes)
            </option>
          ))}
        </select>
      </div>

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

      {/* ── TOOLBAR ── */}
      {selectedDishIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {portionsDifferFromEngine && (
            <button
              onClick={applyEngineValues}
              className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Apply Engine Values
            </button>
          )}
          {calculating && (
            <span className="text-sm text-gray-500">Calculating...</span>
          )}
        </div>
      )}

      {/* ── ENGINE WARNINGS ── */}
      {(engineWarnings.length > 0 || engineAdjustments.length > 0) && (
        <WarningsBanner warnings={engineWarnings} adjustments={engineAdjustments} />
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* ── PORTIONS TABLE ── */}
      <PortionsEditor
        dishes={dishes}
        categories={categories}
        selectedDishIds={selectedDishIds}
        portions={portions}
        engineRecs={engineRecs}
        onPortionChange={handlePortionChange}
      />

      {/* ── VALIDATION ── */}
      {selectedDishIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={validate}
            disabled={checkLoading}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {checkLoading ? "Validating..." : "Validate"}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      )}

      {checkResult && <ValidationBanner result={checkResult} />}
    </div>
  );
}
