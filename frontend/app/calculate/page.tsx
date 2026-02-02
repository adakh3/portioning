"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  Dish,
  DishCategory,
  MenuTemplate,
  GuestMix,
  CalculationResult,
  CheckResult,
} from "@/lib/api";
import DishSelector from "@/components/DishSelector";
import GuestMixForm from "@/components/GuestMixForm";
import ResultsTable from "@/components/ResultsTable";
import WarningsBanner from "@/components/WarningsBanner";
import UserPortionInput from "@/components/UserPortionInput";
import CheckResultsDisplay from "@/components/CheckResultsDisplay";

type Mode = "calculate" | "check";

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

  const [dishes, setDishes] = useState<Dish[]>([]);
  const [categories, setCategories] = useState<DishCategory[]>([]);
  const [templates, setTemplates] = useState<MenuTemplate[]>([]);
  const [selectedDishIds, setSelectedDishIds] = useState<Set<number>>(new Set());
  const [guests, setGuests] = useState<GuestMix>({ gents: 50, ladies: 50 });
  const [bigEaters, setBigEaters] = useState(false);
  const [bigEatersPercentage, setBigEatersPercentage] = useState(20);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [activeTemplateId, setActiveTemplateId] = useState<number | null>(null);
  const [templateModified, setTemplateModified] = useState(false);
  const [portionOverrides, setPortionOverrides] = useState<Map<number, number>>(new Map());

  // Check mode state
  const [mode, setMode] = useState<Mode>("calculate");
  const [userPortions, setUserPortions] = useState<Map<number, number>>(new Map());
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);

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
      setTemplateModified(false);
      setResult(preview);
      setPortionOverrides(new Map());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load template preview");
    }
  };

  const handleTemplateChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) {
      setSelectedDishIds(new Set());
      setActiveTemplateId(null);
      setTemplateModified(false);
      setResult(null);
      return;
    }
    loadTemplate(parseInt(id));
  }, []);

  const toggleDish = useCallback((id: number) => {
    setSelectedDishIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (activeTemplateId) {
      setTemplateModified(true);
    }
    setResult(null);
    setCheckResult(null);
  }, [activeTemplateId]);

  const handleGuestsChange = useCallback((newGuests: GuestMix) => {
    setGuests(newGuests);
    if (activeTemplateId) {
      setTemplateModified(true);
    }
    setResult(null);
    setCheckResult(null);
  }, [activeTemplateId]);

  const handlePortionEdit = useCallback((dishId: number, newGrams: number) => {
    setPortionOverrides((prev) => {
      const next = new Map(prev);
      next.set(dishId, newGrams);
      return next;
    });
    setCheckResult(null);
  }, []);

  const handleResetDish = useCallback((dishId: number) => {
    setPortionOverrides((prev) => {
      const next = new Map(prev);
      next.delete(dishId);
      return next;
    });
    setCheckResult(null);
  }, []);

  const handleResetAll = useCallback(() => {
    setPortionOverrides(new Map());
    setCheckResult(null);
  }, []);

  const handleUserPortionChange = useCallback((dishId: number, grams: number) => {
    setUserPortions((prev) => {
      const next = new Map(prev);
      next.set(dishId, grams);
      return next;
    });
  }, []);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    setError(null);
  }, []);

  const calculate = async () => {
    if (selectedDishIds.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.calculate({
        dish_ids: Array.from(selectedDishIds),
        guests,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
      });
      setResult(res);
      setPortionOverrides(new Map());
      setCheckResult(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Calculation failed");
    } finally {
      setLoading(false);
    }
  };

  const checkPortions = async () => {
    if (selectedDishIds.size === 0) return;
    setCheckLoading(true);
    setError(null);
    try {
      const dishIds = Array.from(selectedDishIds);
      const portions = dishIds.map((id) => ({
        dish_id: id,
        grams_per_person: userPortions.get(id) ?? 0,
      }));
      const res = await api.checkPortions({
        dish_ids: dishIds,
        guests,
        user_portions: portions,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
      });
      setCheckResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setCheckLoading(false);
    }
  };

  const checkEdits = async () => {
    if (!result || portionOverrides.size === 0) return;
    setCheckLoading(true);
    setError(null);
    try {
      const dishIds = Array.from(selectedDishIds);
      const portions = result.portions.map((p) => ({
        dish_id: p.dish_id,
        grams_per_person: portionOverrides.has(p.dish_id)
          ? portionOverrides.get(p.dish_id)!
          : p.grams_per_person,
      }));
      const res = await api.checkPortions({
        dish_ids: dishIds,
        guests,
        user_portions: portions,
        big_eaters: bigEaters,
        big_eaters_percentage: bigEatersPercentage,
      });
      setCheckResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Check failed");
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

  const showCalculateButton = !activeTemplateId || templateModified;
  const isTemplateResult = result?.source === "template";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Calculate Portions</h1>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => handleModeChange("calculate")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === "calculate"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Calculate
        </button>
        <button
          onClick={() => handleModeChange("check")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === "check"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Check My Portions
        </button>
      </div>

      {/* Template selector */}
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

      {/* Dish selector */}
      <DishSelector
        dishes={dishes}
        categories={categories}
        selectedIds={selectedDishIds}
        onToggle={toggleDish}
      />

      {/* Guest mix */}
      <GuestMixForm
        guests={guests}
        onChange={handleGuestsChange}
        bigEaters={bigEaters}
        onBigEatersChange={setBigEaters}
        bigEatersPercentage={bigEatersPercentage}
        onBigEatersPercentageChange={setBigEatersPercentage}
      />

      {/* ── CALCULATE MODE ── */}
      {mode === "calculate" && (
        <>
          {/* Calculate button */}
          {showCalculateButton && (
            <button
              onClick={calculate}
              disabled={loading || selectedDishIds.size === 0}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Calculating..." : `Calculate (${selectedDishIds.size} dishes)`}
            </button>
          )}

          {/* Recalculate with Engine button when showing template results */}
          {isTemplateResult && (
            <button
              onClick={calculate}
              disabled={loading}
              className="bg-gray-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Calculating..." : "Recalculate with Engine"}
            </button>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          {/* Results */}
          {result && (
            <>
              {/* Template results indicator */}
              {isTemplateResult && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
                  Showing stored template portions. Edit the menu or click
                  &ldquo;Recalculate with Engine&rdquo; to run the calculation engine.
                </div>
              )}
              <button
                onClick={handleExportPDF}
                disabled={exporting}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {exporting ? "Exporting..." : "Export PDF"}
              </button>
              <WarningsBanner
                warnings={result.warnings}
                adjustments={result.adjustments_applied}
              />
              <ResultsTable
                result={result}
                overrides={portionOverrides}
                onPortionEdit={handlePortionEdit}
                onResetDish={handleResetDish}
                onResetAll={handleResetAll}
              />

              {/* Check My Edits — visible when chef has overrides */}
              {portionOverrides.size > 0 && (
                <button
                  onClick={checkEdits}
                  disabled={checkLoading}
                  className="bg-amber-500 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {checkLoading ? "Checking..." : "Check My Edits"}
                </button>
              )}

              {checkResult && <CheckResultsDisplay result={checkResult} />}
            </>
          )}
        </>
      )}

      {/* ── CHECK MODE ── */}
      {mode === "check" && (
        <>
          <UserPortionInput
            selectedDishIds={selectedDishIds}
            dishes={dishes}
            categories={categories}
            userPortions={userPortions}
            onPortionChange={handleUserPortionChange}
          />

          <button
            onClick={checkPortions}
            disabled={checkLoading || selectedDishIds.size === 0}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {checkLoading ? "Checking..." : `Check Portions (${selectedDishIds.size} dishes)`}
          </button>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          {checkResult && <CheckResultsDisplay result={checkResult} />}
        </>
      )}
    </div>
  );
}
