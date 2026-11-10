import { afterEach, describe, expect, it, vi } from "vitest";

// analytics.ts decides once per page load, so each case imports a fresh copy
async function trackOn(hostname: string) {
  vi.resetModules();
  vi.stubGlobal("location", { hostname });
  const append = vi.spyOn(document.head, "appendChild").mockImplementation((n) => n);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const { track } = await import("@/analytics");
  track("demo_action", { action: "save_invoice" });
  return { append, log };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.gtag; delete window.dataLayer; });

describe("track", () => {
  it("only logs off the production host", async () => {
    const { append, log } = await trackOn("localhost");
    expect(append).not.toHaveBeenCalled();
    expect(window.gtag).toBeUndefined();
    expect(log).toHaveBeenCalledWith("[ga]", "demo_action", { action: "save_invoice" });
  });

  it("loads gtag once on the production host", async () => {
    const { append, log } = await trackOn("books.demo.vantage-ui.com");
    expect(append).toHaveBeenCalledTimes(1);
    expect((append.mock.calls[0]![0] as HTMLScriptElement).src).toBe("https://www.googletagmanager.com/gtag/js?id=G-R3BJYDRX24");
    expect(log).not.toHaveBeenCalled();
    const sent = window.dataLayer!.map((a) => Array.from(a as ArrayLike<unknown>));
    expect(sent).toContainEqual(["config", "G-R3BJYDRX24", { content_group: "demo-books" }]);
    expect(sent).toContainEqual(["event", "demo_action", { action: "save_invoice" }]);
  });
});
