// Visual smoke test used by CI: boots against a running `next start` and captures every view.
// Fails (exit 1) on any uncaught page error, console error or script error; pages that other
// workstreams have not shipped yet (OPTIONAL_PAGES) only log a warning when they 404.
// Usage: BASE_URL=http://localhost:3000 OUT=shots node scripts/ci-screenshots.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "shots";
mkdirSync(OUT, { recursive: true });

/** Routes that may not exist yet — a 404 (document or RSC prefetch) is a warning, not a failure. */
const OPTIONAL_PAGES = ["/home", "/tickets", "/backlog", "/issues", "/me", "/policy", "/settings", "/projects"];
/** Deliberately missing route used to capture the branded 404 page. */
const NOT_FOUND_PATH = "/this-page-does-not-exist";

const log = [];
const failures = [];
const warnings = [];

const pathOf = (url) => {
  try {
    return new URL(url, BASE).pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
};
const isOptionalPath = (p) => OPTIONAL_PAGES.some((o) => p === o || p.startsWith(o + "/"));

/** Console noise that is not an app error. */
function classifyConsoleError(text, resourceUrl, pageUrl) {
  if (/React DevTools/i.test(text)) return "ignore";
  const is404 = /status of 404/.test(text);
  if (is404 && /favicon/i.test(resourceUrl || text)) return "ignore";
  // CI runs `next start` without the D1 binding: /api/workspace answers 503 and the app switches to offline mode by design
  if (/status of 503/.test(text) && pathOf(resourceUrl) === "/api/workspace") return "ignore";
  if (is404 && pathOf(resourceUrl || pageUrl) === NOT_FOUND_PATH) return "ignore";
  if (is404 && (isOptionalPath(pathOf(resourceUrl)) || (!resourceUrl && isOptionalPath(pathOf(pageUrl))))) return "warn";
  return "fail";
}

function instrument(page, label) {
  page.on("console", (m) => {
    const type = m.type();
    if (type !== "error" && type !== "warning") return;
    const resourceUrl = m.location()?.url ?? "";
    const line = `[${type}] ${label} ${page.url()} :: ${m.text()}${resourceUrl ? ` (${resourceUrl})` : ""}`;
    log.push(line);
    if (type !== "error") return;
    const verdict = classifyConsoleError(m.text(), resourceUrl, page.url());
    if (verdict === "fail") failures.push(line);
    else if (verdict === "warn") warnings.push(line);
  });
  page.on("pageerror", (e) => {
    const line = `[pageerror] ${label} ${page.url()} :: ${e.message}`;
    log.push(line);
    failures.push(line);
  });
}

const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
instrument(desktop, "desktop");
let page = desktop;

const settle = async () => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
};
const shot = async (name) => {
  await settle();
  await page.screenshot({ path: `${OUT}/${name}.png` });
  log.push(`[shot] ${name} ${page.url()}`);
};
const go = async (path, name) => {
  await page.goto(BASE + path);
  await shot(name);
};
/** Like go(), but a 404 for a not-yet-built page is logged as a warning and the shot is skipped. */
const goOptional = async (path, name) => {
  const res = await page.goto(BASE + path);
  if (res && res.status() === 404) {
    const line = `[warn] ${path} returned 404 — page not built yet, skipped ${name}`;
    log.push(line);
    warnings.push(line);
    return false;
  }
  await shot(name);
  return true;
};

try {
  await go("/deals", "01-deals-board");
  await page.getByRole("button", { name: "table view" }).click();
  await shot("02-deals-table");
  await go("/deals/d-nhs-asv", "03-deal-record");
  await go("/contacts", "04-contacts");
  await go("/contacts?view=hot-leads", "05-contacts-hot-leads");
  await go("/contacts/k-rina", "06-contact-record");
  await go("/companies", "07-companies");
  await go("/companies/c-bap", "08-company-record");
  await go("/tickets/t-1002", "09-ticket-record");
  await go("/board", "10-board-status");
  await page.getByRole("button", { name: "Epic", exact: true }).click();
  await shot("11-board-swimlanes-epic");
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page.getByRole("button", { name: "Deal stage", exact: true }).click();
  await shot("12-board-deal-stage");
  await go("/board?issue=UAV-102", "13-issue-drawer");
  await page.keyboard.press("Escape");

  // command palette search
  await go("/deals", "14-pre-palette");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("rtg");
  await shot("15-command-palette");
  await page.keyboard.press("Escape");

  // log a call from the record view via the L shortcut
  await page.goto(BASE + "/contacts/k-hendra");
  await settle();
  await page.keyboard.press("l");
  await shot("16-log-call-dialog");
  await page.keyboard.press("Escape");

  // keyboard drag on the agile board: move first "To Do" card one column right
  await page.goto(BASE + "/board");
  await settle();
  const handle = page.locator('[data-rfd-droppable-id="all::todo"] [data-rfd-drag-handle-draggable-id]').first();
  const movedId = await handle.getAttribute("data-rfd-drag-handle-draggable-id");
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  const nowIn = await page.locator(`[data-rfd-draggable-id="${movedId}"]`).evaluate((el) => el.closest("[data-rfd-droppable-id]")?.getAttribute("data-rfd-droppable-id"));
  log.push(`[dnd] issue ${movedId} now in ${nowIn} (expected all::in_progress)`);
  await shot("17-board-after-keyboard-drag");

  // initiatives & compensation module
  await go("/initiatives", "19-initiatives");
  await go("/initiatives/new", "20-proposal-form");
  await go("/initiatives/ini-sbs-pdm", "21-initiative-overview");
  await page.getByRole("tab", { name: /Team/ }).first().click().catch(() => log.push("[warn] no Team tab"));
  await shot("22-initiative-team");
  await page.getByRole("tab", { name: /Financials/ }).first().click().catch(() => log.push("[warn] no Financials tab"));
  await shot("23-initiative-financials");
  await go("/initiatives/ini-nhs-asv", "24-initiative-in-review");
  await page.getByRole("tab", { name: /PRC/ }).first().click().catch(() => log.push("[warn] no PRC tab"));
  await shot("25-prc-review");
  await go("/compensation", "26-compensation-run");
  await go("/compensation?tab=deferred", "27-compensation-deferred");
  await go("/compensation?tab=probation", "28-compensation-probation");
  await go("/compensation?tab=clawbacks", "29-compensation-clawbacks");
  await go("/compensation?tab=policy", "30-compensation-policy");
  await go("/people", "31-people");
  await page.getByText("Bima Siregar").first().click().catch(() => log.push("[warn] could not open Bima"));
  await shot("32-people-sheet");
  await page.keyboard.press("Escape");

  // shortcuts dialog
  await page.goto(BASE + "/deals");
  await settle();
  await page.keyboard.press("?");
  await shot("18-shortcuts");
  await page.keyboard.press("Escape");

  // pages added in the 50-improvement batch
  await goOptional("/home", "33-home");
  await goOptional("/tickets", "34-tickets");
  await goOptional("/backlog", "35-backlog");
  await goOptional("/issues", "36-issues");
  await goOptional("/me", "37-my-compensation");
  await goOptional("/policy", "38-policy");
  await goOptional("/settings", "39-settings");
  // ongoing-projects register (Policy v4.0)
  await go("/projects", "41-projects-register");
  await page.getByText("People register").first().click().catch(() => log.push("[warn] no people tab"));
  await shot("42-projects-people");
  await go("/projects/prj-elang", "43-project-elang");
  await go("/projects/prj-navora", "44-project-navora");
  await go("/projects/ini-sbs-pdm", "45-project-sample-sbs");

  // 404 page
  await page.goto(BASE + NOT_FOUND_PATH);
  await shot("40-not-found");

  // mobile pass (390×844): top bar, then the off-canvas navigation drawer
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  instrument(mobile, "mobile");
  page = mobile;
  for (const [path, name, optional] of [
    ["/home", "41-mobile-home", true],
    ["/deals", "42-mobile-deals", false],
    ["/initiatives", "43-mobile-initiatives", false],
  ]) {
    const shown = optional ? await goOptional(path, name) : (await go(path, name), true);
    if (!shown) continue;
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.waitForTimeout(400);
    await shot(`${name}-drawer`);
    await page.keyboard.press("Escape");
  }
} catch (e) {
  const line = `[script-error] ${e instanceof Error ? e.stack : String(e)}`;
  log.push(line);
  failures.push(line);
  await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {});
} finally {
  log.push("", `== ${failures.length} failure(s), ${warnings.length} warning(s) ==`, ...failures.map((f) => `FAIL ${f}`), ...warnings.map((w) => `WARN ${w}`));
  writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
  await browser.close();
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (failures.length) {
  console.error(`ci-screenshots: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`ci-screenshots: ok (${warnings.length} warning(s))`);
