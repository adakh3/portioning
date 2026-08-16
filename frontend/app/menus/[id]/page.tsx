"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ManagedMenu } from "@/lib/api";
import { useDishes, revalidate } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MENU_TYPES = [
  { value: "custom", label: "Custom" },
  { value: "barat", label: "Barat / Walima" },
  { value: "mehndi", label: "Mehndi / Mayon" },
];

type DishRow = { dish_id: number; course: number | null };
type Tier = { min_guests: string; price_per_head: string };

const inputClass = "h-9 rounded border border-input bg-transparent px-2 text-sm";

export default function MenuEditorPage() {
  const params = useParams();
  const router = useRouter();
  const idParam = String(params.id);
  const isNew = idParam === "new";
  const { user } = useAuth();
  const canManage = user?.role === "owner" || user?.role === "admin" || !!user?.is_superuser;

  const { data: catalog = [] } = useDishes();
  const dishById = useMemo(() => new Map(catalog.map((d) => [d.id, d])), [catalog]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dishSearch, setDishSearch] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [menuType, setMenuType] = useState("custom");
  const [gents, setGents] = useState(50);
  const [ladies, setLadies] = useState(50);
  const [isActive, setIsActive] = useState(true);
  const [courses, setCourses] = useState<string[]>([]);
  const [dishes, setDishes] = useState<DishRow[]>([]);
  // A brand-new menu starts with one blank tier so there's always a price-per-head
  // to fill in (a menu with no tier has no volume price and dead-ends the pricer).
  // It's just a starting row — leaving the price blank saves nothing, and it can
  // be removed. Existing menus load their own tiers below.
  const [tiers, setTiers] = useState<Tier[]>(isNew ? [{ min_guests: "1", price_per_head: "" }] : []);

  useEffect(() => {
    if (isNew) return;
    let live = true;
    api.getManagedMenu(Number(idParam))
      .then((m: ManagedMenu) => {
        if (!live) return;
        setName(m.name); setDescription(m.description || ""); setMenuType(m.menu_type);
        setGents(m.default_gents); setLadies(m.default_ladies); setIsActive(m.is_active);
        setCourses(m.courses.map((c) => c.name));
        setDishes(m.dishes.map((d) => ({ dish_id: d.dish_id, course: d.course })));
        setTiers(m.price_tiers.map((t) => ({ min_guests: String(t.min_guests), price_per_head: t.price_per_head })));
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [idParam, isNew]);

  const addedIds = new Set(dishes.map((d) => d.dish_id));
  const pickable = catalog
    .filter((d) => !addedIds.has(d.id))
    .filter((d) => !dishSearch.trim() || d.name.toLowerCase().includes(dishSearch.trim().toLowerCase()));

  const addDish = (dishId: number) => setDishes((ds) => [...ds, { dish_id: dishId, course: null }]);
  const removeDish = (dishId: number) => setDishes((ds) => ds.filter((d) => d.dish_id !== dishId));
  const setDishCourse = (dishId: number, course: number | null) =>
    setDishes((ds) => ds.map((d) => (d.dish_id === dishId ? { ...d, course } : d)));

  const addCourse = () => setCourses((cs) => [...cs, `Course ${cs.length + 1}`]);
  const renameCourse = (i: number, v: string) => setCourses((cs) => cs.map((c, j) => (j === i ? v : c)));
  const removeCourse = (i: number) => {
    setCourses((cs) => cs.filter((_, j) => j !== i));
    // Reindex dish course refs: drop the removed course, shift higher ones down.
    setDishes((ds) => ds.map((d) => {
      if (d.course === null) return d;
      if (d.course === i) return { ...d, course: null };
      return d.course > i ? { ...d, course: d.course - 1 } : d;
    }));
  };
  const moveCourse = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= courses.length) return;
    setCourses((cs) => { const next = [...cs]; [next[i], next[j]] = [next[j], next[i]]; return next; });
    setDishes((ds) => ds.map((d) => {
      if (d.course === i) return { ...d, course: j };
      if (d.course === j) return { ...d, course: i };
      return d;
    }));
  };

  const addTier = () => setTiers((t) => [...t, { min_guests: "", price_per_head: "" }]);
  const setTier = (i: number, patch: Partial<Tier>) =>
    setTiers((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeTier = (i: number) => setTiers((t) => t.filter((_, j) => j !== i));

  async function save() {
    if (!name.trim()) { setError("Give the menu a name."); return; }
    setSaving(true); setError("");
    const payload: Partial<ManagedMenu> = {
      name: name.trim(), description, menu_type: menuType,
      default_gents: Number(gents), default_ladies: Number(ladies), is_active: isActive,
      courses: courses.map((n, i) => ({ name: n, sort_order: i })),
      dishes: dishes.map((d) => ({ dish_id: d.dish_id, course: d.course })),
      price_tiers: tiers
        .filter((t) => t.min_guests !== "" && t.price_per_head !== "")
        .map((t) => ({ min_guests: Number(t.min_guests), price_per_head: t.price_per_head })),
    };
    try {
      if (isNew) await api.createMenu(payload);
      else await api.updateMenu(Number(idParam), payload);
      revalidate("menus", "managed-menus");
      router.push("/menus");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    setSaving(true); setError("");
    try {
      await api.deleteMenu(Number(idParam));
      revalidate("menus", "managed-menus");
      router.push("/menus");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
      setSaving(false);
    }
  }

  if (!canManage) return <p className="text-muted-foreground">You don&rsquo;t have access to edit menus.</p>;
  if (loading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{isNew ? "New menu" : "Edit menu"}</h1>
        <Button variant="link" asChild className="p-0 h-auto"><Link href="/menus">&larr; Menus</Link></Button>
      </div>
      {error && <p className="text-destructive text-sm" role="alert">{error}</p>}

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm flex-1 min-w-[200px]">
              Name
              <Input aria-label="Menu name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Type
              <select aria-label="Menu type" value={menuType} onChange={(e) => setMenuType(e.target.value)} className={inputClass}>
                {MENU_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Description
            <textarea aria-label="Menu description" value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} className="rounded border border-input bg-transparent px-2 py-1 text-sm" />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Default gents %
              <input type="number" min="0" aria-label="Default gents" value={gents}
                onChange={(e) => setGents(Number(e.target.value))} className={`${inputClass} w-28`} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Default ladies %
              <input type="number" min="0" aria-label="Default ladies" value={ladies}
                onChange={(e) => setLadies(Number(e.target.value))} className={`${inputClass} w-28`} />
            </label>
            <label className="flex items-center gap-2 text-sm h-9">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Courses</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Group the menu into courses (e.g. Starters, Mains, Dessert). Dishes are assigned to a course below.</p>
          {courses.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`Course ${i + 1} name`} value={c} onChange={(e) => renameCourse(i, e.target.value)}
                className={`${inputClass} flex-1`} />
              <button type="button" aria-label={`Move course ${i + 1} up`} disabled={i === 0} onClick={() => moveCourse(i, -1)}
                className="text-xs px-2 py-1 border border-input rounded disabled:opacity-40">▲</button>
              <button type="button" aria-label={`Move course ${i + 1} down`} disabled={i === courses.length - 1} onClick={() => moveCourse(i, 1)}
                className="text-xs px-2 py-1 border border-input rounded disabled:opacity-40">▼</button>
              <button type="button" aria-label={`Remove course ${i + 1}`} onClick={() => removeCourse(i)}
                className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addCourse}>+ Add course</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Dishes ({dishes.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {dishes.length === 0 && <p className="text-sm text-muted-foreground">No dishes yet — add some below.</p>}
          {dishes.map((d) => {
            const dish = dishById.get(d.dish_id);
            return (
              <div key={d.dish_id} className="flex items-center gap-2 flex-wrap border-b border-border pb-2">
                <span className="flex-1 min-w-[160px] text-sm font-medium">
                  {dish?.name ?? `Dish #${d.dish_id}`}
                  {dish && <span className="ml-2 text-xs text-muted-foreground">{dish.category_name}</span>}
                </span>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  Course
                  <select
                    aria-label={`Course for ${dish?.name ?? d.dish_id}`}
                    value={d.course === null ? "" : String(d.course)}
                    onChange={(e) => setDishCourse(d.dish_id, e.target.value === "" ? null : Number(e.target.value))}
                    className={inputClass}
                  >
                    <option value="">— none —</option>
                    {courses.map((c, i) => <option key={i} value={i}>{c}</option>)}
                  </select>
                </label>
                <button type="button" aria-label={`Remove ${dish?.name ?? d.dish_id}`} onClick={() => removeDish(d.dish_id)}
                  className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
              </div>
            );
          })}

          <div className="pt-2">
            <Input placeholder="Search dishes to add…" value={dishSearch} onChange={(e) => setDishSearch(e.target.value)}
              className="h-8 max-w-xs mb-2" aria-label="Search dishes to add" />
            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
              {pickable.slice(0, 40).map((d) => (
                <button key={d.id} type="button" onClick={() => addDish(d.id)}
                  aria-label={`Add ${d.name}`}
                  className="text-xs px-2 py-1 rounded border border-input hover:bg-accent">
                  + {d.name}
                </button>
              ))}
              {pickable.length === 0 && <span className="text-xs text-muted-foreground">No dishes match.</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Price tiers (optional)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">A fixed price-per-head above a guest-count threshold.</p>
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="number" min="0" aria-label={`Tier ${i + 1} minimum guests`} placeholder="Min guests"
                value={t.min_guests} onChange={(e) => setTier(i, { min_guests: e.target.value })} className={`${inputClass} w-32`} />
              <input type="number" min="0" step="0.01" aria-label={`Tier ${i + 1} price per head`} placeholder="Price / head"
                value={t.price_per_head} onChange={(e) => setTier(i, { price_per_head: e.target.value })} className={`${inputClass} w-32`} />
              <button type="button" aria-label={`Remove tier ${i + 1}`} onClick={() => removeTier(i)}
                className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addTier}>+ Add tier</Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : isNew ? "Create menu" : "Save changes"}</Button>
        <Button type="button" variant="outline" asChild><Link href="/menus">Cancel</Link></Button>
        {!isNew && (
          <button type="button" onClick={remove} disabled={saving}
            className="ml-auto text-destructive hover:text-destructive/80 text-sm">Delete menu</button>
        )}
      </div>
    </div>
  );
}
