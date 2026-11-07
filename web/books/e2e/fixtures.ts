import { test as base, expect, type Page } from "@playwright/test";

// Every test runs against the user's real books, so none may write. The page's WebSocket
// goes through this fixture: reads pass, and a write frame (flash, delete, invoke) is held
// back and fails the test that sent it. Drafts stay in the test browser's own storage.

const WRITES = ["flash", "delete", "invoke", "batch"];

export const test = base.extend<{ page: Page; writes: string[]; splash: boolean }>({
  writes: async ({}, use) => { await use([]); },
  // the splash shows once per browser session; tests skip it unless they are about it
  splash: [false, { option: true }],
  page: async ({ page, writes, splash }, use) => {
    if (!splash) await page.addInitScript(() => sessionStorage.setItem("books.splash.seen", "1"));
    await page.routeWebSocket(/\/v1\/ws$/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        let frame: { t?: string } = {};
        try { frame = JSON.parse(String(message)); } catch { /* not JSON: pass it on */ }
        if (frame.t && WRITES.includes(frame.t)) { writes.push(String(message).slice(0, 200)); return; }
        server.send(message);
      });
    });
    await use(page);
    expect(writes, "a test tried to write to the real books").toEqual([]);
  },
});

export { expect };

/** Opens a page and waits for the app to connect and draw its first rows. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
}

/** The data rows of the list on screen (not the header). */
export const rows = (page: Page) => page.locator('[role=grid] [role=row][data-pin]');
