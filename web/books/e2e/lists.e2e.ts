import { expect, open, rows, test } from "./fixtures";

// Every list page loads rows from the server, filters and sorts on the server, and opens a
// record in place with the keyboard. Read-only: nothing here saves.

const pages: [string, string][] = [
  ["/sales/invoices", "invoices"],
  ["/purchases/invoices", "invoices"],
  ["/sales/payments", "payments"],
  ["/purchases/payments", "payments"],
  ["/sales/customers", "customers"],
  ["/purchases/suppliers", "suppliers"],
  ["/accounts/misc", "misc payments"],
  ["/accounts/banks", "accounts"],
];

for (const [path, noun] of pages) {
  test(`${path} loads its rows`, async ({ page }) => {
    await open(page, path);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`\\d+\\+? ${noun}`))).toBeVisible();
  });
}

test("the invoice filter and chips ask the server", async ({ page }) => {
  await open(page, "/sales/invoices");
  await expect(rows(page).first()).toBeVisible();
  await page.getByRole("button", { name: "Paid", exact: true }).click();
  await expect(rows(page).first()).toContainText("Paid");
  await page.getByPlaceholder(/Filter: customer name/).fill("Brightwave Digital");
  await expect(rows(page).first()).toContainText("Brightwave Digital");
  await expect(page.locator("[role=grid] [role=row][data-pin]").filter({ hasNotText: "Brightwave Digital" })).toHaveCount(0);
});

test("sorting by a column header reverses the order", async ({ page }) => {
  await open(page, "/sales/customers");
  const first = rows(page).first();
  await expect(first).toContainText("Bank Interest");
  await page.getByRole("columnheader", { name: "Name" }).click();
  await expect(first).not.toContainText("Bank Interest");
});

test("the keyboard opens and closes an invoice, and the URL follows", async ({ page }) => {
  await open(page, "/sales/invoices");
  await expect(rows(page).first()).toBeVisible();
  const grid = page.getByRole("grid");
  await grid.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sales\/invoices\/.+/);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/sales\/invoices$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/sales\/invoices\/.+/); // Back reopens it
});

test("the record being edited stays on screen while the list scrolls", async ({ page }) => {
  await open(page, "/sales/invoices");
  await expect(rows(page).first()).toBeVisible();
  await page.getByRole("button", { name: /New invoice/ }).click();
  const key = decodeURIComponent(page.url().split("/").pop()!).replace(/^new-/, "new:");
  const record = page.locator(`[data-dock="${key}"]`);
  const grid = page.getByRole("grid");
  const inView = async () => {
    const [r, g] = [await record.boundingBox(), await grid.boundingBox()];
    return !!r && !!g && r.y >= g.y && r.y + r.height <= g.y + g.height + 1;
  };
  for (const top of [400, 2500, 6000]) {
    await grid.evaluate((el, t) => { el.scrollTop = t; }, top);
    await expect.poll(inView).toBe(true);
  }
  await expect(record.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); // an untouched draft goes away
});

test("the nominal tree shows the chart of accounts", async ({ page }) => {
  await open(page, "/accounts/nominals");
  await expect(page.getByRole("treeitem").filter({ hasText: "14000" })).toContainText("Debtors");
  expect(await page.getByRole("treeitem").count()).toBeGreaterThan(20);
});
