import type { Draft } from "./store";

// The open record lives in the URL, so Back reopens one closed by accident.
// "invoice:s00397" ⇄ "s00397", "payment:r00328" ⇄ "r00328"; a new draft "new:<uuid>" ⇄ "new-<uuid>".
export const toSegment = (key: string) => (key.startsWith("new:") ? `new-${key.slice(4)}` : key.replace(/^\w+:/, ""));
export const fromSegment = (seg: string, table = "invoice") => (seg.startsWith("new-") ? `new:${seg.slice(4)}` : `${table}:${seg}`);

const lists: Record<Draft["kind"], string> = {
  sale: "/sales/invoices", purchase: "/purchases/invoices",
  lodgement: "/sales/payments", payment: "/purchases/payments",
  client: "/sales/customers", supplier: "/purchases/suppliers", misc: "/accounts/misc",
};
export const listPath = (kind: Draft["kind"]) => lists[kind];

/** Where a draft opens: a payment flipped from an invoice opens on that invoice. */
export const draftPath = (d: Draft) =>
  d.flipOf ? `${lists[d.kind === "lodgement" ? "sale" : d.kind === "payment" ? "purchase" : d.kind]}/${toSegment(d.flipOf)}`
    : `${listPath(d.kind)}/${toSegment(d.key)}`;
