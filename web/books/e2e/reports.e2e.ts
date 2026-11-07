import { expect, open, test } from "./fixtures";

// The reports add up: debits equal credits, the balance sheet balances, the ledger opens
// from the trial balance, and search finds a document.

test("the trial balance balances", async ({ page }) => {
  await open(page, "/reports/trial-balance");
  await expect(page.getByText("✓ Debits equal credits")).toBeVisible();
});

test("the balance sheet balances in every year", async ({ page }) => {
  await open(page, "/reports/balance-sheet");
  await expect(page.getByText("✓ Net assets equal capital and reserves in every year.")).toBeVisible();
});

test("profit and loss shows income by year", async ({ page }) => {
  await open(page, "/reports/pnl");
  await expect(page.getByRole("heading", { name: "Profit and loss" })).toBeVisible();
  await expect(page.getByText("Total income")).toBeVisible();
});

test("a nominal's ledger opens from the trial balance", async ({ page }) => {
  await open(page, "/reports/trial-balance");
  await page.locator("[role=grid] [role=row][data-pin]").filter({ hasText: "Debtors" }).first().dblclick();
  await expect(page).toHaveURL(/\/reports\/ledger\?nominal=14000/);
  await expect(page.getByText(/postings/).last()).toBeVisible();
});

test("the nominal ledger opens on every posting, and narrows to one nominal", async ({ page }) => {
  await open(page, "/reports/ledger");
  const rows = page.locator("[role=grid] [role=row][data-pin]");
  await expect(rows.first()).toBeVisible();
  await page.getByPlaceholder(/All nominals/).pressSequentially("Debtors");
  await page.getByRole("option", { name: /14000/ }).first().click();
  await expect(page).toHaveURL(/nominal=14000/);
  await expect(rows.filter({ hasNotText: "Debtors" })).toHaveCount(0);
  await page.getByRole("button", { name: "All nominals" }).click();
  await expect(page).toHaveURL(/\/reports\/ledger$/);
  await expect(rows.first()).toBeVisible();
});

test("aged debtors totals what customers owe", async ({ page }) => {
  await open(page, "/reports/aged-debtors");
  await expect(page.getByText(/customers owing/)).toBeVisible();
  await expect(page.locator("[role=grid] [role=row][data-pin]").filter({ hasText: "Brightwave Digital" })).toBeVisible();
});

test("search finds an invoice by number and opens it", async ({ page }) => {
  await open(page, "/sales/invoices");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/Search invoices/).fill("#54");
  await page.getByRole("option", { name: /Cambridge Genomix/ }).first().click();
  await expect(page).toHaveURL(/\/sales\/invoices\/s00397/);
});

test("the shortcuts overlay opens with ?", async ({ page }) => {
  await open(page, "/sales/invoices");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
});
