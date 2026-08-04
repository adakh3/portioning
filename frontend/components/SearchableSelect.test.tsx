import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

import SearchableSelect, { SearchableOption } from "./SearchableSelect";

// A select you can type into, for lists that grow with the business. A native
// <select> holding every open lead an org has meant a screen-height scroll to
// hunt for a name.

const LEADS: SearchableOption[] = [
  { value: "1", label: "Hamza", hint: "Mehndi · 12 Nov 2026" },
  { value: "2", label: "Sara Saud", hint: "Mehndi · 01 Mar 2027" },
  { value: "3", label: "Rimsha Kiyani", hint: "other · 01 Oct 2026" },
  { value: "4", label: "Hamza", hint: "Wedding · 26 Dec 2026" },
];

const NONE = "-- No lead (standalone quote) --";

function Harness({ onChange = vi.fn(), initial = "" }: { onChange?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchableSelect
      ariaLabel="Link to Lead"
      emptyLabel={NONE}
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
      options={LEADS}
    />
  );
}

const open = () => fireEvent.click(screen.getByLabelText("Link to Lead"));
const rows = () => within(screen.getByRole("listbox")).getAllByRole("option")
  .map((b) => b.textContent);

describe("SearchableSelect", () => {
  it("shows the empty label until something is chosen, then the chosen label", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent(NONE);
    open();
    fireEvent.click(screen.getByText("Rimsha Kiyani"));
    expect(onChange).toHaveBeenCalledWith("3");
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent("Rimsha Kiyani");
    // Choosing closes it, like a native select.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters on the label", () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByLabelText("Search link to lead"), { target: { value: "rimsha" } });
    expect(rows().some((r) => r?.includes("Rimsha Kiyani"))).toBe(true);
    expect(rows().some((r) => r?.includes("Sara Saud"))).toBe(false);
  });

  it("filters on the hint too, so a date or type finds the lead", () => {
    // The hint is what tells two leads with the SAME contact name apart, so it
    // has to be searchable or those two are indistinguishable.
    render(<Harness />);
    open();
    fireEvent.change(screen.getByLabelText("Search link to lead"), { target: { value: "wedding" } });
    const listed = rows().filter((r) => r !== NONE);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain("26 Dec 2026");
  });

  it("always offers the empty row, so a choice can be cleared", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="2" />);
    expect(screen.getByLabelText("Link to Lead")).toHaveTextContent("Sara Saud");
    open();
    // Survives filtering — otherwise a search would hide the way back.
    fireEvent.change(screen.getByLabelText("Search link to lead"), { target: { value: "zzzz" } });
    expect(rows()).toEqual([NONE]);
    fireEvent.click(screen.getByText(NONE));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByLabelText("Search link to lead"), { target: { value: "zzzz" } });
    // The empty row is the only thing left, and the message explains the rest.
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("is drivable from the keyboard", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    const search = screen.getByLabelText("Search link to lead");
    fireEvent.keyDown(search, { key: "ArrowDown" });   // off the empty row onto Hamza
    fireEvent.keyDown(search, { key: "ArrowDown" });   // Sara Saud
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("closes on Escape without choosing anything", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    fireEvent.keyDown(screen.getByLabelText("Search link to lead"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the search box out of the way when reopened", () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByLabelText("Search link to lead"), { target: { value: "rimsha" } });
    fireEvent.click(screen.getByText("Rimsha Kiyani"));
    open();
    // A stale term would hide every other lead on the next open.
    expect(screen.getByLabelText("Search link to lead")).toHaveValue("");
    expect(rows().length).toBe(LEADS.length + 1);
  });
});
