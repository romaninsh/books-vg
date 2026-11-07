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
  await page.getByRole("button", { name: "About this demo" }).click();
  await expect(splashOf(page)).toBeVisible();
  await page.getByRole("button", { name: /Explore Demo/ }).click();
  await expect(splashOf(page)).toBeHidden();
});
