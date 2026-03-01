# Design System

Built on **shadcn/ui** — Radix UI primitives + Tailwind CSS + class-variance-authority.

## Setup

All dependencies are in `package.json`. Run `npm install` to set up.

Config: `components.json` (shadcn), `globals.css` (design tokens).

## Design Tokens (CSS Variables)

Defined in `app/globals.css` using HSL values. All Tailwind classes reference these tokens.

### Core Colors

| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--background` | `bg-background` | Page background |
| `--foreground` | `text-foreground` | Primary text |
| `--primary` | `bg-primary`, `text-primary` | Brand/action color (blue) |
| `--primary-foreground` | `text-primary-foreground` | Text on primary backgrounds |
| `--muted` | `bg-muted` | Subtle backgrounds (table headers, empty states) |
| `--muted-foreground` | `text-muted-foreground` | Secondary/helper text |
| `--accent` | `bg-accent` | Hover states, active tabs |
| `--accent-foreground` | `text-accent-foreground` | Text on accent backgrounds |
| `--destructive` | `bg-destructive`, `text-destructive` | Errors, delete actions |
| `--border` | `border-border` | Default borders |
| `--input` | `border-input` | Form input borders |
| `--ring` | `ring-ring` | Focus ring color |
| `--card` | `bg-card` | Card backgrounds |

### Sidebar Tokens

| Token | Class | Value |
|-------|-------|-------|
| `--sidebar` | `bg-sidebar` | Dark blue-gray (220 20% 10%) |
| `--sidebar-foreground` | `text-sidebar-foreground` | Light text on sidebar |
| `--sidebar-accent` | `bg-sidebar-accent` | Active item highlight |
| `--sidebar-border` | `border-sidebar-border` | Sidebar dividers |

## Components (`components/ui/`)

### Button

```tsx
import { Button } from "@/components/ui/button";

<Button>Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon"><Icon /></Button>

// As link
<Button asChild><Link href="/path">Navigate</Link></Button>

// Green submit buttons (no variant — use className)
<Button className="bg-emerald-600 hover:bg-emerald-700">Save</Button>
```

### Badge

```tsx
import { Badge } from "@/components/ui/badge";

<Badge>Default</Badge>
<Badge variant="secondary">Draft</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="success">Active</Badge>     // emerald
<Badge variant="warning">Pending</Badge>    // amber
<Badge variant="info">In Progress</Badge>   // blue
```

### Card

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>Footer</CardFooter>
</Card>
```

### Input / Textarea

```tsx
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

<Input type="text" placeholder="Enter name..." />
<Textarea placeholder="Notes..." />
```

### Dialog

```tsx
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

<Dialog>
  <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    {/* content */}
    <DialogFooter>
      <Button>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Select (Radix)

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

<Select value={val} onValueChange={setVal}>
  <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
  </SelectContent>
</Select>
```

> **Note:** Most pages still use native `<select>` elements styled with `border-input focus-visible:ring-1 focus-visible:ring-ring` classes. Both are acceptable.

## Status Color Mapping

Use Badge variants for status indicators:

| Status | Badge Variant |
|--------|--------------|
| Draft / Backlog | `secondary` |
| Sent / In Progress | `info` |
| Pending / Review | `warning` |
| Active / Confirmed / Paid | `success` |
| Cancelled / Overdue / Error | `destructive` |
| Archived / Void | `outline` |

## Utility: `cn()`

```tsx
import { cn } from "@/lib/utils";

// Merge conditional classes safely
<div className={cn("base-class", isActive && "bg-accent", className)} />
```

Combines `clsx` (conditional classes) + `tailwind-merge` (deduplication).

## Conventions

1. **Use design tokens** — never hardcode `gray-500`, `gray-200`, etc. Use `text-muted-foreground`, `border-border`, `bg-muted`.
2. **Semantic green** — for save/confirm buttons, use `className="bg-emerald-600 hover:bg-emerald-700"` (no green Button variant).
3. **Native selects OK** — use Radix `<Select>` for new code, but native `<select>` with matching styles is fine for existing forms.
4. **Native checkboxes OK** — no Radix checkbox needed; style with `border-input rounded`.
5. **Card for containers** — replace `bg-white border border-gray-200 rounded-lg` patterns with `<Card>`.
6. **Button asChild for links** — wrap `<Link>` in `<Button asChild>` for navigation that looks like a button.

## Typography

- Font: Geist Sans (loaded via `next/font/google`, applied as CSS variable `--font-geist-sans`)
- Monospace: Geist Mono (`--font-geist-mono`)
- Base text: `text-sm` (14px) for most UI, `text-xs` for labels/badges
- Headings: `text-2xl font-bold` (page), `text-lg font-semibold` (section)
