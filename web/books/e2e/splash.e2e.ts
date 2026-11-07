import { expect, open, test } from "./fixtures";

// The splash: once per browser session, about the VantageUI demo, out of the way with Enter
// or "Explore Demo", back from the shortcuts overlay.
test.use({ splash: true });

const splashOf = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Books. Sorted." });

test("a new session opens on the splash, once", async ({ page }) => {
  await open(page, "/sales/invoices");
  const splash = splashOf(page);
  await expect(splash).toBeVisible();
  await expect(splash).toContainText("Demo built with VantageUI 1.13.3");
  await expect(splash).toContainText("active agent time");
  await expect(splash).toContainText("typical accounting software");
  await expect(splash.getByRole("link", { name: /Build your own/ })).toHaveAttribute("href", "https://vantage-ui.com/download/");
  await page.keyboard.press("Enter");
  await expect(splash).toBeHidden();

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
  await expect(splashOf(page)).toBeHidden();

  await page.keyboard.press("?");
  await page.getByRole("dialog", { name: "Keyboard shortcuts" }).getByRole("button", { name: "About this demo" }).click();
  await expect(splashOf(page)).toBeVisible();
  await page.getByRole("button", { name: /Explore Demo/ }).click();
  await expect(splashOf(page)).toBeHidden();

  // and from the About button in the header
  await page.getByRole("banner").getByRole("button", { name: "About this demo" }).click();
  await expect(splashOf(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(splashOf(page)).toBeHidden();
});

test("About has its own address: /about, kept on refresh, gone on close", async ({ page }) => {
  await open(page, "/purchases/invoices");
  await page.keyboard.press("Enter"); // the session's first splash
  await expect(splashOf(page)).toBeHidden();

  await page.getByRole("banner").getByRole("button", { name: "About this demo" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await page.reload();
  await expect(splashOf(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(splashOf(page)).toBeHidden();
  await expect(page).toHaveURL(/\/purchases\/invoices$/); // back to the page it was opened from
  await page.goForward();
  await expect(splashOf(page)).toBeVisible(); // Forward reopens it

  // a link straight to /about (from another page: a goto to the same address keeps its state)
  await page.goto("/reports/pnl");
  await page.goto("/about");
  await expect(splashOf(page)).toBeVisible();
  await page.getByRole("button", { name: /Explore Demo/ }).click();
  await expect(page).toHaveURL(/\/sales\/invoices$/);
});
