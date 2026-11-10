// Google Analytics: the same GA4 property as vantage-ui.com, so a visit carries across
// *.vantage-ui.com through the top-level cookie (gtag's default cookie_domain: 'auto').
// The tag loads only on the production host; localhost, *.run.app and e2e runs send nothing,
// and track() logs "[ga] name params" to the console there instead.
// Page views: GA's enhanced measurement counts the router's History API changes, so none are
// sent by hand. Events are listed in docs/web-app.md.

const ID = "G-R3BJYDRX24";
const PRODUCTION_HOST = "books.demo.vantage-ui.com";

type Params = Record<string, string | number | boolean>;
type Gtag = (...args: unknown[]) => void;
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

let gtag: Gtag | null | undefined; // undefined: not decided yet; null: not on production

function load(): Gtag | null {
  if (gtag !== undefined) return gtag;
  if (location.hostname !== PRODUCTION_HOST) return (gtag = null);
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the arguments objects off dataLayer, not arrays
  window.gtag = function () { window.dataLayer!.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", ID, { content_group: "demo-books" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
  document.head.appendChild(script);
  return (gtag = window.gtag);
}

/** Called once at startup, so page views are counted before any event fires. */
export const initAnalytics = () => { load(); };

export function track(name: string, params: Params = {}) {
  const g = load();
  if (g) g("event", name, params);
  else console.info("[ga]", name, params);
}

/** For a link leaving the app: `<a onClick={trackOutbound} href=…>`. */
export const trackOutbound = (e: { currentTarget: HTMLAnchorElement }) =>
  track("outbound_click", { link_url: e.currentTarget.href });
