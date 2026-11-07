import { expect, open, rows, test } from "./fixtures";

// Drafts live in the browser until saved: a new invoice can be started, filled in, found in
// the Drafts panel and discarded without anything reaching the server.

test("a new invoice is a draft until it is saved", async ({ page }) => {
  await open(page, "/sales/invoices");
  await expect(rows(page).first()).toBeVisible();
  await page.getByRole("button", { name: /New invoice/ }).click();
  await expect(page).toHaveURL(/\/sales\/invoices\/new-/);

  const customer = page.getByPlaceholder("Type a customer…");
  await expect(customer).toBeFocused();
  await customer.pressSequentially("Cambridge");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("Description").fill("e2e line");
  await page.getByPlaceholder("0.00").fill("100");
  await expect(page.locator("aside")).toContainText("120.00"); // net 100 + VAT 20

  await page.getByRole("button", { name: /Drafts/ }).click();
  const panel = page.getByRole("dialog", { name: "Drafts" });
  await expect(panel).toContainText("Cambridge Genomix");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/sales\/invoices$/);
  await page.getByRole("button", { name: /Drafts/ }).click();
  await expect(page.getByRole("dialog", { name: "Drafts" })).not.toContainText("Cambridge Genomix");
});

test("an invoice card turns to a payment of what is due", async ({ page }) => {
  await open(page, "/sales/invoices?q=%2354");
  await rows(page).filter({ hasText: "Cambridge Genomix" }).first().dblclick();
  await page.getByRole("button", { name: "Payment" }).click();
  await expect(page.getByText(/Money received against invoice/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save receipt" })).toBeVisible();
  await page.getByRole("button", { name: "Invoice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
