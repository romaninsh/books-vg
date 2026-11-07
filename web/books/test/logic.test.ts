import { describe, expect, it } from "vitest";
import { humanError } from "@/shell/toast";
import { draftTotals, deltas, lineNet, lineVat } from "@/editor/totals";
import { parseDate, showDate } from "@/editor/fields";
import { fitCols, type Col } from "@/lists/DataList";
import { toSegment, fromSegment, draftPath } from "@/editor/routes";
import type { Draft, Line } from "@/editor/store";
import { stateClass } from "@/lists/draftRows";

// The pure rules behind the screens: money, dates, errors, layout, addresses.

const line = (p: Partial<Line>): Line => ({
  key: "k", description: "", nominal: "n", nominalPath: "", quantity: 1, price: 0, vat_rate: 20, vat: null, vatManual: false, ...p,
});
const draft = (lines: Line[], extra: Partial<Draft> = {}): Draft => ({
  key: "new:1", kind: "sale", createdAt: 0, dirty: false, status: "editing",
  header: { date: "2026-11-05", number: "", reference: "", due_date: "", contact: "", contactName: "", newContact: null },
  lines, ...extra,
});

describe("money", () => {
  it("rounds each line's net to pence, as the server does", () => {
    expect(lineNet(line({ quantity: 3, price: 0.335 }))).toBe(1.01);
  });
  it("takes VAT from the rate unless it was typed by hand", () => {
    expect(lineVat(line({ quantity: 1, price: 100, vat_rate: 20 }))).toBe(20);
    expect(lineVat(line({ quantity: 1, price: 100, vat_rate: 20, vat: 0, vatManual: true }))).toBe(0);
  });
  it("adds up an invoice and what an edit changes", () => {
    const d = draft([line({ price: 100 }), line({ price: 50, vat_rate: 0 })], {
      base: { net: 100, vat: 20, gross: 120, paid: 120, amount_due: 0 },
    });
    expect(draftTotals(d)).toEqual({ net: 150, vat: 20, gross: 170, paid: 120, amount_due: 50 });
    expect(deltas(d)).toMatchObject({ net: 50, gross: 50, amount_due: 50 });
  });
});

describe("dates", () => {
  it("reads what a bookkeeper types", () => {
    expect(parseDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDate("5.11.26")).toBe("2026-11-05");
    expect(parseDate("+30", "2026-11-05")).toBe("2026-12-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("")).toBe("");
    expect(showDate("2026-11-05")).toBe("05/11/2026");
  });
});

describe("errors", () => {
  it("keeps the database rule's own words", () => {
    const raw = 'actions.delete_nominal: Runtime error: SurrealDB query failed (query_error: "Error while processing event nominal_delete: An error occurred: “Sales” is a primary nominal (41000) and can\'t be deleted", error_type: "query_execution") (line 1, column 17)';
    expect(humanError(raw)).toBe("“Sales” is a primary nominal (41000) and can't be deleted");
  });
  it("drops the script position from an action's own message", () => {
    expect(humanError("actions.delete_doc: Runtime error: This invoice has 2 payments against it (line 9, column 5)"))
      .toBe("This invoice has 2 payments against it");
  });
});

describe("columns", () => {
  const cols: Col[] = [
    { key: "a", label: "A", width: 100 },
    { key: "b", label: "B", width: 100, drop: 2 },
    { key: "c", label: "C", width: 100, drop: 1 },
  ];
  it("drops columns in their order until the rest fit", () => {
    expect(fitCols(cols, 300).map((c) => c.key)).toEqual(["a", "b", "c"]);
    expect(fitCols(cols, 250).map((c) => c.key)).toEqual(["a", "b"]);
    expect(fitCols(cols, 120).map((c) => c.key)).toEqual(["a"]);
    expect(fitCols(cols, 50).map((c) => c.key)).toEqual(["a"]); // never the ones without `drop`
  });
});

describe("record state", () => {
  it("has one look per step: draft → saving → saved (held) → failed", () => {
    expect(stateClass(draft([], { dirty: true }))).toBe("row-dirty");
    expect(stateClass(draft([], { dirty: true, status: "saving" }))).toBe("row-saving");
    expect(stateClass(draft([], { status: "saved" }))).toBe("row-held");
    expect(stateClass(draft([], { dirty: true, status: "failed" }))).toBe("row-failed");
    expect(stateClass(undefined)).toBe("");
  });
});

describe("addresses", () => {
  it("round-trips record keys through the URL", () => {
    expect(toSegment("invoice:s00397")).toBe("s00397");
    expect(fromSegment("s00397")).toBe("invoice:s00397");
    expect(fromSegment(toSegment("new:abc"))).toBe("new:abc");
    expect(fromSegment("r00328", "payment")).toBe("payment:r00328");
  });
  it("opens a payment drawn on an invoice's card on that invoice", () => {
    expect(draftPath(draft([], { kind: "lodgement", key: "flip:payment:invoice:s1", flipOf: "invoice:s1" }))).toBe("/sales/invoices/s1");
    expect(draftPath(draft([], { kind: "misc", key: "new:9" }))).toBe("/accounts/misc/new-9");
  });
});
