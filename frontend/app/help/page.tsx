"use client";

import { useState } from "react";

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <span className="text-gray-400 text-xl">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-5 pb-5 space-y-3 text-gray-700">{children}</div>}
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">How Portioning Works</h1>
        <p className="text-gray-600 mt-1">
          A guide to how the calculator determines how much food to prepare per person.
        </p>
      </div>

      <Section title="How Portions Are Calculated" defaultOpen={true}>
        <p>
          The calculator takes your menu (dishes, guest count, and male/female split) and
          outputs how many grams or pieces of each dish to prepare per person.
        </p>
        <p>
          Every dish belongs to a <strong>category</strong> (e.g. Curry, BBQ, Rice), and each
          category belongs to one of four independent <strong>pools</strong>. The calculator
          works out the budget for each pool separately, then splits it among dishes.
        </p>
        <p>
          All defaults are calibrated from real catering data — the goal is to match what
          experienced caterers actually serve, avoiding both waste and shortages.
        </p>
      </Section>

      <Section title="The Four Food Groups (Pools)">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900">Protein — the main courses</h3>
            <p>
              Includes <strong>Curry</strong> (meat), <strong>Dry / Barbecue (BBQ)</strong>,
              and <strong>Rice</strong> (all types). These categories compete for a shared
              budget. Adding more dish categories increases the total — up to a hard ceiling.
              Rice stays in this pool regardless of whether it&apos;s meat or veg rice.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Accompaniment — veg sides</h3>
            <p>
              Includes <strong>Veg Curry</strong> (Daal, Palak Paneer, etc.) and{" "}
              <strong>Sides</strong> (Bhagaray Baingan, Bhindi Fry, etc.). These are
              accompaniments to the main courses with their own independent budget.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Dessert</h3>
            <p>
              Allocated independently. Multiple desserts split the budget among themselves.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Service — fixed items</h3>
            <p>
              <strong>Salad, Condiment (Raita), Bread (Naan), Tea</strong> — every guest gets
              the same fixed amount regardless of the rest of the menu.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Category Defaults">
        <p>
          Each category has a <strong>baseline budget</strong> (the standard total for one
          dish) and a <strong>minimum per dish</strong> (the smallest viable portion). These
          are all configurable in the admin panel.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Pool</th>
                <th className="text-right px-3 py-2 font-medium">Baseline</th>
                <th className="text-right px-3 py-2 font-medium">Min / Dish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr><td className="px-3 py-2">Curry (meat)</td><td className="px-3 py-2">Protein</td><td className="px-3 py-2 text-right">160g</td><td className="px-3 py-2 text-right">70g</td></tr>
              <tr><td className="px-3 py-2">Dry / Barbecue</td><td className="px-3 py-2">Protein</td><td className="px-3 py-2 text-right">180g</td><td className="px-3 py-2 text-right">100g</td></tr>
              <tr><td className="px-3 py-2">Rice</td><td className="px-3 py-2">Protein</td><td className="px-3 py-2 text-right">100g</td><td className="px-3 py-2 text-right">70g</td></tr>
              <tr><td className="px-3 py-2">Veg Curry</td><td className="px-3 py-2">Accompaniment</td><td className="px-3 py-2 text-right">80g</td><td className="px-3 py-2 text-right">30g</td></tr>
              <tr><td className="px-3 py-2">Sides</td><td className="px-3 py-2">Accompaniment</td><td className="px-3 py-2 text-right">60g</td><td className="px-3 py-2 text-right">30g</td></tr>
              <tr><td className="px-3 py-2">Dessert</td><td className="px-3 py-2">Dessert</td><td className="px-3 py-2 text-right">80g</td><td className="px-3 py-2 text-right">40g</td></tr>
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="min-w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Service Item</th>
                <th className="text-right px-3 py-2 font-medium">Per Person</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr><td className="px-3 py-2">Salad</td><td className="px-3 py-2 text-right">50g</td></tr>
              <tr><td className="px-3 py-2">Raita</td><td className="px-3 py-2 text-right">40g</td></tr>
              <tr><td className="px-3 py-2">Naan</td><td className="px-3 py-2 text-right">1 piece</td></tr>
              <tr><td className="px-3 py-2">Green Tea</td><td className="px-3 py-2 text-right">1 cup</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="How More Dishes Affect Portions">
        <p>
          When you add more dishes to a category, the total budget for that category
          <strong> grows</strong> — but each individual dish gets a smaller share.
        </p>
        <p>
          For example, one curry gets the full 160g budget. Two curries share a larger
          budget (~224g), so each gets ~112g. Three curries share ~288g, so each gets
          ~96g.
        </p>
        <p>
          Each extra dish adds roughly <strong>40%</strong> of the baseline to the category
          budget. This growth rate is configurable.
        </p>
        <p>
          There&apos;s also a <strong>minimum floor</strong>: if you add so many dishes that
          the grown budget can&apos;t give each dish its minimum viable portion, the budget
          expands further to ensure every dish is worth including.
        </p>
      </Section>

      <Section title="Missing Categories (Protein Redistribution)">
        <p>
          When a protein category is absent from the menu, a portion of its budget gets
          redistributed to the protein categories that <em>are</em> present. By default,{" "}
          <strong>70%</strong> of the absent budget is redistributed proportionally.
        </p>
        <p>
          For example, a menu with just curry and rice (no BBQ) will give more curry and
          rice per person — the absent BBQ budget doesn&apos;t vanish, most of it flows into
          what&apos;s actually on the menu.
        </p>
        <p>
          This only applies to the <strong>protein pool</strong>. Accompaniment and dessert
          categories don&apos;t redistribute — if you skip veg curry, sides don&apos;t get
          bigger.
        </p>
      </Section>

      <Section title="Ceilings & Safety Limits">
        <p>
          Each pool has a <strong>ceiling</strong> — the maximum total grams across all
          categories in that pool:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Protein:</strong> 590g (raised to 700g for large menus with Curry + BBQ + Rice + Dessert)</li>
          <li><strong>Accompaniment:</strong> 150g</li>
          <li><strong>Dessert:</strong> 150g</li>
        </ul>
        <p>
          If a pool&apos;s total exceeds its ceiling, all portions in that pool are scaled
          down proportionally.
        </p>
        <p className="font-medium mt-2">Global safety caps (rarely triggered):</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Max total food:</strong> 1,000g per person (protein + accompaniment + dessert)</li>
          <li><strong>Max dietary protein:</strong> 120g per person (actual protein content, not food weight)</li>
          <li><strong>Min portion per dish:</strong> 30g — below this, you&apos;ll see a warning to remove a dish</li>
        </ul>
      </Section>

      <Section title="Popularity Weighting">
        <p>
          Each dish has a <strong>popularity</strong> score (default 1.0). When a category
          has multiple dishes, more popular dishes get slightly larger portions.
        </p>
        <p>
          The split blends equal portions with popularity-weighted portions. By default
          it&apos;s <strong>70% equal, 30% popularity</strong> — so popularity nudges the
          portions but doesn&apos;t dominate.
        </p>
        <p>
          No dish will ever drop below its minimum viable portion due to low popularity.
        </p>
      </Section>

      <Section title="Guest Mix & Big Eaters">
        <p>
          All portions are calculated for an <strong>adult male (gent)</strong> as the
          baseline. The system then adjusts for the guest mix:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Ladies</strong> receive 100% of the gent portion by default (configurable
            in admin)
          </li>
          <li>
            <strong>Big eaters</strong> — if enabled, all portions increase by 20%
          </li>
        </ul>
        <p>
          The total amount to prepare is calculated by multiplying per-person portions by the
          number of gents and ladies respectively.
        </p>
      </Section>

      <Section title="Service Items">
        <p>
          Service items get a <strong>fixed portion</strong> per person regardless of the
          rest of the menu. These are not part of the calculation engine — they&apos;re
          always the same.
        </p>
        <p>
          However, category constraints can still apply. For example, salad has a{" "}
          <strong>category cap of 100g</strong> — so two salads get 50g each (100g total),
          but three salads would be scaled down to ~33g each.
        </p>
      </Section>

      <Section title='Validation ("Check My Portions")'>
        <p>
          The &quot;Check My Portions&quot; feature lets you enter your own gram values and
          validates them against the same rules the engine uses. It does <strong>not</strong>{" "}
          recalculate — it only checks what you entered.
        </p>
        <p className="font-medium mt-2">What gets checked:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <strong>Pool ceilings</strong> — are your totals within each pool&apos;s limit?
          </li>
          <li>
            <strong>Category constraints</strong> — is each dish above its minimum? Is the
            category total within its cap?
          </li>
          <li>
            <strong>Global caps</strong> — total food under 1,000g? Dietary protein under
            120g?
          </li>
        </ol>
        <p>
          After validating, it also runs the standard calculator and shows a side-by-side
          comparison — your portions vs. the recommended portions, with the difference for
          each dish.
        </p>
      </Section>
    </div>
  );
}
