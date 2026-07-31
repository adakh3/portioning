import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import DietaryTagPills, { dietaryTagsDescription } from "./DietaryTagPills";
import DishSelector from "./DishSelector";
import { DietaryTag, Dish, DishCategory } from "@/lib/api";

const gf: DietaryTag = { id: 1, slug: "gluten_free", label: "Gluten-free", short_label: "GF", kind: "dietary" };
const milk: DietaryTag = { id: 2, slug: "milk", label: "Milk", short_label: "MLK", kind: "allergen" };

describe("DietaryTagPills", () => {
  it("renders nothing for an untagged dish", () => {
    const { container } = render(<DietaryTagPills tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when tags are absent entirely", () => {
    const { container } = render(<DietaryTagPills />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the short label for each tag", () => {
    render(<DietaryTagPills tags={[gf, milk]} />);
    expect(screen.getByText("GF")).toBeInTheDocument();
    expect(screen.getByText("MLK")).toBeInTheDocument();
  });

  it("phrases an allergen as 'contains' and a dietary tag as itself", () => {
    render(<DietaryTagPills tags={[gf, milk]} />);
    expect(screen.getByText("GF")).toHaveAttribute("title", "Gluten-free");
    expect(screen.getByText("MLK")).toHaveAttribute("title", "Contains milk");
  });

  it("falls back to the full label when a tag has no short label", () => {
    render(<DietaryTagPills tags={[{ ...gf, short_label: "" }]} />);
    expect(screen.getByText("Gluten-free")).toBeInTheDocument();
  });
});

// ── The surface a caterer actually sees the tags on ──

const category: DishCategory = {
  id: 1, name: "entrees", display_name: "Entrées", display_order: 0,
  pool: "protein", unit: "kg", addition_surcharge: "0", removal_discount: "0",
};

const dish = (over: Partial<Dish>): Dish => ({
  id: 1, name: "Chicken Tikka", category: 1, category_name: "Entrées",
  protein_type: "chicken", default_portion_grams: 100, popularity: 1,
  cost_per_gram: 0.01, selling_price_per_gram: null, selling_price_override: false,
  margin_percent: null, is_vegetarian: false, notes: "", ...over,
});

describe("dietaryTagsDescription", () => {
  it("spells the tags out for a screen reader", () => {
    expect(dietaryTagsDescription([gf, milk])).toBe("gluten-free; contains milk");
  });

  it("is empty for an untagged dish", () => {
    expect(dietaryTagsDescription([])).toBe("");
    expect(dietaryTagsDescription()).toBe("");
  });
});

describe("DishSelector dietary tags", () => {
  it("keeps the dish name findable by role, tags spelled out not abbreviated", () => {
    // Regression: the pills render INSIDE the dish button, so its accessible
    // name became "Grilled Chicken Breast GF MLK" and an exact-name lookup
    // stopped matching (caught by e2e/calculate.spec.ts). The pills are now
    // aria-hidden visual shorthand and the button says it properly.
    render(
      <DishSelector
        dishes={[dish({ name: "Grilled Chicken Breast", dietary_tags: [gf, milk] })]}
        categories={[category]}
        selectedIds={new Set()}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Grilled Chicken Breast — gluten-free; contains milk" }),
    ).toBeInTheDocument();
    // The abbreviations stay visible, but out of the accessibility tree.
    expect(screen.getByText("GF")).toHaveAttribute("title", "Gluten-free");
  });

  it("shows a tagged dish's pills", () => {
    render(
      <DishSelector
        dishes={[dish({ dietary_tags: [gf, milk] })]}
        categories={[category]}
        selectedIds={new Set()}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("GF")).toBeInTheDocument();
    expect(screen.getByText("MLK")).toBeInTheDocument();
  });

  it("leaves an untagged dish exactly as it was — bare name, legacy V only", () => {
    render(
      <DishSelector
        dishes={[dish({ name: "Garden Salad", is_vegetarian: true })]}
        categories={[category]}
        selectedIds={new Set()}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Garden Salad")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
    expect(screen.queryByText("GF")).not.toBeInTheDocument();
  });

  it("drops the legacy V once the dish has real dietary tags", () => {
    render(
      <DishSelector
        dishes={[dish({ name: "Garden Salad", is_vegetarian: true, dietary_tags: [gf] })]}
        categories={[category]}
        selectedIds={new Set()}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("GF")).toBeInTheDocument();
    expect(screen.queryByText("V")).not.toBeInTheDocument();
  });
});
