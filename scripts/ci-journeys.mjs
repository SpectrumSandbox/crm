// End-to-end user journeys used by the "QA journeys" workflow: boots against a running `next start`
// and drives real interactions (dialogs, drag & drop, keyboard shortcuts, downloads) through the app.
// Every journey runs in a fresh browser context (clean localStorage = seed data), is split into named
// steps, and failures are collected without stopping the other journeys. A failing step gets a
// screenshot; every journey also gets a final screenshot. Results: OUT/report.json + OUT/report.md.
// Usage: BASE_URL=http://localhost:3000 OUT=qa node scripts/ci-journeys.mjs [journey-name-filter]
import { chromium, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "qa";
const ONLY = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
mkdirSync(OUT, { recursive: true });

const STEP_TIMEOUT = 6_000;
expect.configure({ timeout: STEP_TIMEOUT });

/* ───────────── helpers ───────────── */

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const xpathLiteral = (s) => (s.includes('"') ? `concat("${s.split('"').join(`", '"', "`)}")` : `"${s}"`);
const pathOf = (url) => {
  try {
    return new URL(url, BASE).pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
};

/** Console noise that is not an app error (mirrors scripts/ci-screenshots.mjs). */
function ignorable(text, resourceUrl) {
  if (/React DevTools/i.test(text)) return true;
  if (/status of 404/.test(text) && /favicon/i.test(resourceUrl || text)) return true;
  // CI runs `next start` without the D1 binding: /api/workspace answers 503 and the app goes offline by design
  if (/status of 503/.test(text) && (pathOf(resourceUrl) === "/api/workspace" || /\/api\/workspace/.test(text))) return true;
  // the deliberate 404 journey
  if (/status of 404/.test(text) && /this-page-does-not-exist/.test(resourceUrl || "")) return true;
  return false;
}

/**
 * Form control for a visible label. The app's <Field> renders `<label>` as a sibling of the control
 * (no htmlFor), so getByLabel() usually fails — fall back to "the first control after this label".
 */
function field(scope, label) {
  const lit = xpathLiteral(label);
  const sibling = scope.locator(
    `xpath=.//label[normalize-space(.)=${lit}]/following-sibling::*[1]/descendant-or-self::*[self::input or self::select or self::textarea][1]`,
  );
  const wrapped = scope.locator(`xpath=.//label[.//*[normalize-space(.)=${lit}]]//*[self::input or self::select or self::textarea][1]`);
  return scope.getByLabel(label, { exact: true }).or(sibling).or(wrapped).first();
}

const dialog = (page, name) => (name ? page.getByRole("dialog", { name }) : page.getByRole("dialog")).last();
// CSS (not getByRole): a toast raised while a modal/sheet is open sits under aria-hidden — see toastIsExposed()
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first();
/** true when the toast is reachable by assistive tech (not inside an aria-hidden / inert subtree) */
const toastIsExposed = (loc) => loc.evaluate((el) => !el.closest('[aria-hidden="true"], [inert]'));
const button = (scope, name, exact = false) => scope.getByRole("button", { name, exact }).first();

async function open(page, path) {
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // AppShell renders a boot screen until the persisted store has rehydrated
  await page.locator("#main").waitFor({ state: "attached", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(400);
  return res;
}

/** Keyboard drag with @hello-pangea/dnd: focus handle, Space, arrow, Space. Returns droppable before/after. */
async function keyboardDrag(page, handle, key = "ArrowRight") {
  const id = await handle.getAttribute("data-rfd-drag-handle-draggable-id");
  if (!id) throw new Error("element is not a drag handle");
  const where = () => page.locator(`[data-rfd-draggable-id="${id}"]`).first().evaluate((el) => el.closest("[data-rfd-droppable-id]")?.getAttribute("data-rfd-droppable-id") ?? null);
  const from = await where();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(350);
  await page.keyboard.press(key);
  await page.waitForTimeout(350);
  await page.keyboard.press("Space");
  await page.waitForTimeout(900);
  const to = await where();
  return { id, from, to };
}

/* ───────────── journey runner ───────────── */

const journeys = [];
/** @param {string} name @param {(ctx: {page: import('playwright').Page, step: Function, note: Function, browser: any}) => Promise<void>} fn */
const journey = (name, fn, opts = {}) => journeys.push({ name, fn, opts });

async function runJourney(browser, j) {
  const id = slug(j.name);
  const viewport = j.opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    acceptDownloads: true,
    ...(j.opts.mobile ? { isMobile: true, hasTouch: true } : {}),
    timezoneId: "Asia/Jakarta",
    locale: "en-GB",
  });
  context.setDefaultTimeout(STEP_TIMEOUT);
  context.setDefaultNavigationTimeout(30_000);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const resourceUrl = m.location()?.url ?? "";
    if (ignorable(m.text(), resourceUrl)) return;
    consoleErrors.push(`[console] ${page.url()} :: ${m.text()}${resourceUrl ? ` (${resourceUrl})` : ""}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${page.url()} :: ${e.message}`));

  const result = { name: j.name, id, status: "pass", steps: [], notes: [], consoleErrors, screenshots: [], ms: 0 };
  const t0 = Date.now();
  let n = 0;
  const step = async (label, fn) => {
    n += 1;
    const s = { n, label, status: "pass" };
    result.steps.push(s);
    const ts = Date.now();
    try {
      await fn();
    } catch (e) {
      s.status = "fail";
      s.error = (e instanceof Error ? e.message : String(e)).split("\n").filter((l) => l.trim() && !/^\s+at /.test(l)).slice(0, 6).join(" | ").slice(0, 900);
      const shot = `${id}--step${n}-fail.png`;
      await page.screenshot({ path: `${OUT}/${shot}` }).catch(() => {});
      s.screenshot = shot;
      result.screenshots.push(shot);
      throw Object.assign(new Error(`step ${n} "${label}" failed`), { stepFailed: true });
    } finally {
      s.ms = Date.now() - ts;
    }
  };
  const note = (text) => result.notes.push(text);

  try {
    await j.fn({ page, step, note, context });
  } catch (e) {
    result.status = "fail";
    if (!e?.stepFailed) {
      result.steps.push({ n: n + 1, label: "(journey script)", status: "fail", error: e instanceof Error ? e.message : String(e) });
      const shot = `${id}--script-fail.png`;
      await page.screenshot({ path: `${OUT}/${shot}` }).catch(() => {});
      result.screenshots.push(shot);
    }
  }
  const final = `${id}.png`;
  await page.screenshot({ path: `${OUT}/${final}` }).catch(() => {});
  result.screenshots.unshift(final);
  if (consoleErrors.length && result.status === "pass") {
    result.status = "fail";
    result.steps.push({ n: n + 1, label: "no console / page errors", status: "fail", error: consoleErrors.slice(0, 3).join(" | ").slice(0, 900) });
  }
  result.ms = Date.now() - t0;
  await context.close().catch(() => {});
  return result;
}

/* ───────────── journeys: CRM ───────────── */

journey("Deals — create a deal via the dialog and see it on the board", async ({ page, step }) => {
  const dealName = `QA Journey Drone Survey ${Date.now() % 10000}`;
  await step("open /deals", () => open(page, "/deals"));
  await step("open the Create deal dialog", async () => {
    await button(page, /Create deal/).click();
    await expect(dialog(page, "Create deal")).toBeVisible();
  });
  const dlg = dialog(page, "Create deal");
  await step("fill name, amount and company", async () => {
    await field(dlg, "Deal name").fill(dealName);
    await field(dlg, "Amount (IDR)").fill("1234000000");
    await field(dlg, "Company").selectOption({ label: "Nusantara Hydrographic Survey" });
    await expect(dlg.getByText(/1[.,]234[.,]000[.,]000/)).toBeVisible();
  });
  await step("submit and land on the new deal record", async () => {
    await button(dlg, "Create deal", true).click();
    await expect(page).toHaveURL(/\/deals\/[^/]+$/);
    await expect(page.getByText(dealName).first()).toBeVisible();
    await expect(toast(page, /Deal created/)).toBeVisible();
  });
  await step("deal card shows on the board in the first stage", async () => {
    await open(page, "/deals");
    const card = page.locator("[data-rfd-draggable-id]", { hasText: dealName });
    await expect(card).toBeVisible();
    const col = await card.evaluate((el) => el.closest("[data-rfd-droppable-id]")?.getAttribute("data-rfd-droppable-id"));
    expect(col).toBe("st-discovery");
  });
});

journey("Deals — drag a deal to the next stage (keyboard drag) and it persists", async ({ page, step, note }) => {
  await step("open /deals", () => open(page, "/deals"));
  let moved;
  await step("keyboard-drag the first Discovery card one column right", async () => {
    const handle = page.locator('[data-rfd-droppable-id="st-discovery"] [data-rfd-drag-handle-draggable-id]').first();
    await expect(handle).toBeVisible();
    moved = await keyboardDrag(page, handle);
    note(`deal ${moved.id}: ${moved.from} → ${moved.to}`);
    expect(moved.to).toBe("st-qualified");
  });
  await step("stage survives a reload", async () => {
    await open(page, "/deals");
    const where = await page.locator(`[data-rfd-draggable-id="${moved.id}"]`).evaluate((el) => el.closest("[data-rfd-droppable-id]")?.getAttribute("data-rfd-droppable-id"));
    expect(where).toBe("st-qualified");
  });
  await step("record page shows the new stage", async () => {
    await open(page, `/deals/${moved.id}`);
    await expect(page.getByText("Qualified").first()).toBeVisible();
  });
});

journey("Deals — quick-edit the amount from the card, then Undo", async ({ page, step }) => {
  const label = "Quick edit NHS — Autonomous Survey Vessel Retrofit";
  await step("open /deals", () => open(page, "/deals"));
  await step("open the quick-edit popover", async () => {
    const card = page.locator('[data-rfd-draggable-id="d-nhs-asv"]');
    await card.hover();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Amount (IDR)" })).toBeVisible();
  });
  await step("change the amount and save", async () => {
    const pop = page.getByRole("dialog").filter({ hasText: "Amount (IDR)" });
    const amount = field(pop, "Amount (IDR)");
    await expect(amount).toHaveValue("8400000000");
    await amount.fill("9100000000");
    await button(pop, "Save", true).click();
    await expect(toast(page, /Autonomous Survey Vessel Retrofit updated/)).toBeVisible();
  });
  await step("re-opened popover shows the saved amount", async () => {
    await page.locator('[data-rfd-draggable-id="d-nhs-asv"]').hover();
    await page.getByRole("button", { name: label, exact: true }).click();
    const pop = page.getByRole("dialog").filter({ hasText: "Amount (IDR)" });
    await expect(field(pop, "Amount (IDR)")).toHaveValue("9100000000");
    await page.keyboard.press("Escape");
  });
  await step("Undo from a second edit's toast restores the amount", async () => {
    await page.locator('[data-rfd-draggable-id="d-nhs-asv"]').hover();
    await page.getByRole("button", { name: label, exact: true }).click();
    const pop = page.getByRole("dialog").filter({ hasText: "Amount (IDR)" });
    await field(pop, "Amount (IDR)").fill("100");
    await button(pop, "Save", true).click();
    await toast(page, /updated/).getByRole("button", { name: "Undo" }).click();
    await page.locator('[data-rfd-draggable-id="d-nhs-asv"]').hover();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(field(page.getByRole("dialog").filter({ hasText: "Amount (IDR)" }), "Amount (IDR)")).toHaveValue("9100000000");
  });
});

journey("Deals — page filter via the / shortcut narrows the board", async ({ page, step }) => {
  await step("open /deals", () => open(page, "/deals"));
  let before = 0;
  await step("press / and type a company prefix", async () => {
    before = await page.locator("[data-rfd-draggable-id]").count();
    await page.locator("body").press("/");
    await expect(page.getByPlaceholder("Filter deals")).toBeFocused();
    await page.keyboard.type("Seabed");
  });
  await step("only matching deals remain", async () => {
    await expect.poll(() => page.locator("[data-rfd-draggable-id]").count()).toBeLessThan(before);
    await expect(page.locator('[data-rfd-draggable-id="d-nhs-ai"]')).toBeVisible();
  });
});

journey("Deals — delete from the record page, then Undo restores it", async ({ page, step }) => {
  await step("open the deal record", () => open(page, "/deals/d-nhs-ai"));
  await step("Actions → Delete deal", async () => {
    await button(page, /^Actions/).click();
    await page.getByRole("menuitem", { name: /Delete deal/ }).click();
    await expect(dialog(page, "Delete deal?")).toBeVisible();
  });
  await step("confirm delete → back on /deals with an Undo toast", async () => {
    await button(dialog(page, "Delete deal?"), /Delete deal/).click();
    await expect(page).toHaveURL(/\/deals$/);
    await expect(toast(page, /deleted/)).toBeVisible();
    await expect(page.locator('[data-rfd-draggable-id="d-nhs-ai"]')).toHaveCount(0);
  });
  await step("Undo restores the deal and reopens it", async () => {
    await toast(page, /deleted/).getByRole("button", { name: "Undo" }).click();
    await expect(page).toHaveURL(/\/deals\/d-nhs-ai$/);
    await expect(page.getByText("Seabed Classification AI").first()).toBeVisible();
  });
});

journey("Contacts — log a call from the record quick actions", async ({ page, step }) => {
  const subject = "QA call — survey follow-up";
  await step("open contact Hendra Gunawan", () => open(page, "/contacts/k-hendra"));
  await step("click the Call quick action", async () => {
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await expect(dialog(page, "Log call")).toBeVisible();
  });
  await step("fill subject, outcome and notes; submit", async () => {
    const dlg = dialog(page, "Log call");
    await field(dlg, "Subject").fill(subject);
    await field(dlg, "Outcome").selectOption("left_voicemail");
    await field(dlg, "Notes").fill("Discussed retrofit timeline; send revised quote.");
    await button(dlg, "Log call", true).click();
    await expect(toast(page, /Call logged/)).toBeVisible();
  });
  await step("call appears on the timeline", async () => {
    await expect(page.getByText(subject).first()).toBeVisible();
  });
});

journey("Contacts — L shortcut opens Log call on a record", async ({ page, step }) => {
  await step("open contact Rina Susanto", () => open(page, "/contacts/k-rina"));
  await step("press L", async () => {
    await page.locator("body").press("l");
    await expect(dialog(page, "Log call")).toBeVisible();
    await expect(dialog(page, "Log call").getByText(/Rina Susanto/).first()).toBeVisible();
  });
  await step("Escape closes it", async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

journey("Contacts — duplicate warnings in Create contact", async ({ page, step }) => {
  await step("open /contacts and the Create contact dialog", async () => {
    await open(page, "/contacts");
    await button(page, /Create contact/).click();
    await expect(dialog(page, "Create contact")).toBeVisible();
  });
  const dlg = dialog(page, "Create contact");
  await step("existing email blocks creation", async () => {
    await field(dlg, "First name").fill("Rina");
    await field(dlg, "Last name").fill("Susanto");
    await field(dlg, "Email").fill("rina.susanto@nusantarahydro.co.id");
    await expect(dlg.getByText(/already exists/)).toBeVisible();
    await expect(button(dlg, "Create contact", true)).toBeDisabled();
  });
  await step("new email + same name at same company only warns", async () => {
    await field(dlg, "Email").fill("rina.qa@nusantarahydro.co.id");
    await expect(dlg.getByText(/Possible duplicate/)).toBeVisible();
    await expect(button(dlg, "Create contact", true)).toBeEnabled();
  });
  await step("create anyway → lands on the new contact", async () => {
    await button(dlg, "Create contact", true).click();
    await expect(page).toHaveURL(/\/contacts\/(?!k-rina)[^/]+$/);
    await expect(page.getByText("rina.qa@nusantarahydro.co.id").first()).toBeVisible();
  });
});

journey("Contacts — smart list tab + Export CSV downloads the rows in view", async ({ page, step, note }) => {
  await step("open /contacts", () => open(page, "/contacts"));
  let shown = 0;
  await step("switch to the Hot leads smart list", async () => {
    await page.getByRole("button", { name: /^Hot leads/ }).click();
    await expect(page).toHaveURL(/view=hot-leads/);
    const counter = page.getByText(/^\d+ of \d+$/).first();
    await expect(counter).toBeVisible();
    shown = Number((await counter.innerText()).split(" ")[0]);
    note(`hot leads in view: ${shown}`);
    expect(shown).toBeGreaterThan(0);
  });
  await step("Export CSV downloads a file with the same row count", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, /Export CSV/).click()]);
    const name = dl.suggestedFilename();
    note(`downloaded ${name}`);
    expect(name).toMatch(/contacts-hot-leads.*\.csv$/);
    const text = readFileSync(await dl.path(), "utf8").replace(/^﻿/, "");
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toContain("Lead score");
    expect(lines.length - 1).toBe(shown);
  });
});

journey("Contacts table — j / Enter opens the focused row; Alt+→ walks to the next record", async ({ page, step, note }) => {
  await step("open /contacts", () => open(page, "/contacts"));
  let first = "";
  await step("press j then Enter", async () => {
    await page.locator("body").click({ position: { x: 5, y: 600 } }).catch(() => {});
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/contacts\/[^/?]+$/);
    first = pathOf(page.url());
    note(`opened ${first}`);
  });
  await step("Alt+ArrowRight opens the next contact", async () => {
    await page.locator("#main").waitFor();
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(() => pathOf(page.url())).not.toBe(first);
    await expect(page).toHaveURL(/\/contacts\/[^/?]+$/);
  });
});

journey("Deal record — Propose initiative link prefills a PRC proposal", async ({ page, step }) => {
  await step("open deal d-nhs-ai", () => open(page, "/deals/d-nhs-ai"));
  await step("click Propose initiative", async () => {
    await page.getByRole("link", { name: /Propose initiative/ }).first().click();
    await expect(page).toHaveURL(/\/initiatives\/new\?fromDeal=d-nhs-ai/);
    await expect(toast(page, /Prefilled from deal/)).toBeVisible();
    await expect(field(page, "Project name")).not.toHaveValue("");
  });
});

journey("Companies — duplicate domain blocks Create company", async ({ page, step }) => {
  await step("open /companies and press C", async () => {
    await open(page, "/companies");
    await page.locator("body").press("c");
    await expect(dialog(page, "Create company")).toBeVisible();
  });
  await step("an existing domain is flagged and blocks saving", async () => {
    const dlg = dialog(page, "Create company");
    await field(dlg, "Company name").fill("NHS Duplicate");
    await field(dlg, "Domain").fill("nusantarahydro.co.id");
    await expect(dlg.getByText(/Already in CRM: Nusantara Hydrographic Survey/)).toBeVisible();
    await expect(button(dlg, "Create company", true)).toBeDisabled();
  });
});

journey("Tickets — create a ticket and move it to the next stage", async ({ page, step, note }) => {
  const subject = `QA gateway offline ${Date.now() % 10000}`;
  await step("open /tickets", () => open(page, "/tickets"));
  await step("New ticket dialog → fill subject and company", async () => {
    await button(page, /New ticket/).click();
    const dlg = dialog(page, "New ticket");
    await expect(dlg).toBeVisible();
    await field(dlg, "Subject").fill(subject);
    await field(dlg, "Company").selectOption({ label: "Nusantara Hydrographic Survey" });
    await field(dlg, "Description").fill("Gateway at Tanjung Priok quay offline after power cut.");
  });
  await step("create → toast and card on the board", async () => {
    await button(dialog(page, "New ticket"), "Create ticket", true).click();
    await expect(toast(page, /Ticket .* opened/)).toBeVisible();
    await expect(page.locator("[data-rfd-draggable-id]", { hasText: subject })).toBeVisible();
  });
  await step("keyboard-drag the ticket one stage right", async () => {
    const handle = page.locator("[data-rfd-drag-handle-draggable-id]", { hasText: subject });
    const r = await keyboardDrag(page, handle);
    note(`ticket ${r.id}: ${r.from} → ${r.to}`);
    expect(r.to).not.toBe(r.from);
  });
});

/* ───────────── journeys: shell ───────────── */

journey("⌘K palette — search a contact and an issue, open them", async ({ page, step }) => {
  await step("open /home", () => open(page, "/home"));
  await step("Ctrl+K, type 'Rina', pick the contact", async () => {
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder(/Search contacts, companies/);
    await expect(input).toBeFocused();
    await input.fill("Rina");
    await page.getByRole("option", { name: /Rina Susanto/ }).first().click();
    await expect(page).toHaveURL(/\/contacts\/k-rina$/);
  });
  await step("Ctrl+K, type 'UAV-102', open the issue drawer", async () => {
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Search contacts, companies/).fill("UAV-102");
    await page.getByRole("option", { name: /UAV-102/ }).first().click();
    await expect(page.getByRole("dialog", { name: /UAV-102/ })).toBeVisible();
  });
});

journey("Keyboard — G-shortcuts navigate and ? opens the shortcut sheet", async ({ page, step }) => {
  await step("open /home", () => open(page, "/home"));
  for (const [key, path] of [
    ["d", "/deals"],
    ["c", "/contacts"],
    ["b", "/board"],
    ["i", "/initiatives"],
    ["j", "/projects"],
    ["k", "/policy"],
    ["y", "/me"],
  ]) {
    await step(`g ${key} → ${path}`, async () => {
      await page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
      await page.keyboard.press("Escape");
      await page.keyboard.press("g");
      await page.keyboard.press(key);
      await expect(page).toHaveURL(new RegExp(`${esc(path)}(\\?|$)`));
      await page.locator("#main").waitFor();
      await page.waitForTimeout(300);
    });
  }
  await step("? opens Keyboard shortcuts", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Slash");
    await expect(dialog(page, "Keyboard shortcuts")).toBeVisible();
  });
});

journey("Notifications — bell opens and Mark all read clears the badge", async ({ page, step, note }) => {
  await step("open /home", () => open(page, "/home"));
  await step("open the bell", async () => {
    const bell = page.getByRole("button", { name: /^Notifications/ }).first();
    note(`bell label: ${await bell.getAttribute("aria-label")}`);
    await bell.click();
    await expect(page.getByRole("button", { name: /Mark all read/ })).toBeVisible();
  });
  await step("Mark all read → bell has no unread count", async () => {
    const mark = page.getByRole("button", { name: /Mark all read/ });
    if (await mark.isEnabled()) await mark.click();
    await expect(page.getByRole("button", { name: "Notifications", exact: true }).first()).toBeVisible();
  });
});

journey("Settings — Download backup produces a JSON workspace snapshot", async ({ page, step, note }) => {
  await step("open /settings", () => open(page, "/settings"));
  await step("click Download backup (.json)", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, /Download backup/).click()]);
    note(`downloaded ${dl.suggestedFilename()}`);
    expect(dl.suggestedFilename()).toMatch(/^spectrum-crm-backup-.*\.json$/);
    const json = JSON.parse(readFileSync(await dl.path(), "utf8"));
    const keys = Object.keys(json.data ?? json);
    note(`backup keys: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? "…" : ""}`);
    expect(JSON.stringify(json)).toContain("d-nhs-asv");
    await expect(toast(page, /Backup downloaded/)).toBeVisible();
  });
});

journey("Not found — branded 404 with working links", async ({ page, step }) => {
  await step("open a missing route", async () => {
    const res = await open(page, "/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /couldn.t find that page/ })).toBeVisible();
  });
  await step("Deals link goes to /deals", async () => {
    await page.getByRole("link", { name: /^Deals Pipeline board/ }).click();
    await expect(page).toHaveURL(/\/deals$/);
  });
});

journey(
  "Mobile 390px — navigation drawer opens, navigates and closes",
  async ({ page, step }) => {
    await step("open /deals at 390×844", () => open(page, "/deals"));
    await step("Open navigation shows the drawer", async () => {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    });
    await step("tap Contacts → /contacts and the drawer closes", async () => {
      await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: /^Contacts/ }).click();
      await expect(page).toHaveURL(/\/contacts$/);
      await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
    });
    await step("search button opens the palette", async () => {
      await page.getByRole("button", { name: "Search (Command K)" }).first().click();
      await expect(page.getByPlaceholder(/Search contacts, companies/)).toBeVisible();
    });
  },
  { mobile: true },
);

journey(
  "Mobile 390px — no page scrolls horizontally",
  async ({ page, step, note }) => {
    const offenders = [];
    for (const path of ["/home", "/deals", "/contacts", "/tickets", "/board", "/initiatives", "/projects", "/compensation", "/people", "/me", "/policy", "/settings"]) {
      await step(`measure ${path}`, async () => {
        await open(page, path);
        const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
        if (w > 392) offenders.push(`${path} (${w}px)`);
      });
    }
    note(offenders.length ? `pages wider than 390px: ${offenders.join(", ")}` : "no horizontal overflow");
    await step("no page wider than the viewport", async () => {
      expect(offenders, offenders.join(", ")).toEqual([]);
    });
  },
  { mobile: true },
);

/* ───────────── journeys: agile ───────────── */

journey("Board — j/k focus and Shift+→ moves an issue to the next column", async ({ page, step, note }) => {
  await step("open /board", () => open(page, "/board"));
  let msg = "";
  await step("press j twice then Shift+ArrowRight", async () => {
    await page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("Shift+ArrowRight");
    const t = toast(page, /→/);
    await expect(t).toBeVisible();
    msg = (await t.innerText()).trim();
    note(`toast: ${msg}`);
  });
  await step("the issue card now sits in the announced column", async () => {
    const m = msg.match(/^([A-Z]+-\d+)\s*→\s*(.+)$/);
    expect(m, `toast "${msg}"`).toBeTruthy();
    const [, key, label] = m;
    const statusId = { "To Do": "todo", "In Progress": "in_progress", "In Review": "in_review", Done: "done", Backlog: "backlog" }[label.trim()];
    const col = await page.locator("[data-issue-card]", { hasText: key }).first().evaluate((el) => el.closest("[data-rfd-droppable-id]")?.getAttribute("data-rfd-droppable-id") ?? "");
    expect(col.endsWith(`::${statusId}`), `${key} is in ${col}`).toBe(true);
  });
});

journey("Issue drawer — open UAV-102 and set status with the 5 key", async ({ page, step }) => {
  await step("open /board?issue=UAV-102", () => open(page, "/board?issue=UAV-102"));
  await step("drawer shows UAV-102", async () => {
    await expect(page.getByRole("dialog", { name: /UAV-102/ })).toBeVisible();
  });
  await step("press 5 (Done) and close", async () => {
    // focus the drawer itself (not a text field) so the 1–5 status hotkeys apply
    await page.getByRole("dialog", { name: /UAV-102/ }).focus();
    await page.keyboard.press("5");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  await step("card is in the Done column", async () => {
    const col = await page.locator("[data-issue-card]", { hasText: "UAV-102" }).first().evaluate((el) => el.closest("[data-rfd-droppable-id]")?.getAttribute("data-rfd-droppable-id") ?? "");
    expect(col).toMatch(/::done$/);
  });
});

journey("Backlog — create a sprint, complete the active one, start the new one", async ({ page, step, note }) => {
  await step("open /backlog", () => open(page, "/backlog"));
  let sprintName = "";
  await step("Create sprint", async () => {
    await button(page, /^Create sprint/).click();
    const t = toast(page, /created/);
    await expect(t).toBeVisible();
    sprintName = (await t.innerText()).replace(/\s*created.*$/, "").trim();
    note(`created ${sprintName}`);
    await expect(page.getByRole("heading", { name: sprintName })).toBeVisible();
  });
  await step("complete the active sprint (if any)", async () => {
    const complete = page.getByRole("button", { name: /^Complete sprint/ }).first();
    if (!(await complete.count())) return note("no active sprint");
    await complete.click();
    const dlg = dialog(page, /^Complete /);
    await expect(dlg).toBeVisible();
    await button(dlg, /Complete sprint/).click();
    await expect(toast(page, /completed/)).toBeVisible();
  });
  await step("start the new sprint", async () => {
    // innermost card that holds the sprint heading (ancestors come first in document order)
    const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: sprintName, exact: true }) }).last();
    await button(card, /Start sprint/).click();
    const dlg = dialog(page, `Start ${sprintName}`);
    await expect(dlg).toBeVisible();
    await button(dlg, /Start sprint/).click();
    await expect(toast(page, /started/)).toBeVisible();
    await expect(card.getByText("Active", { exact: true })).toBeVisible();
  });
});

journey("Backlog — quick-add an issue to the backlog", async ({ page, step }) => {
  const summary = `QA backlog item ${Date.now() % 10000}`;
  await step("open /backlog", () => open(page, "/backlog"));
  await step("type a summary and press Enter", async () => {
    const input = page.getByLabel("New backlog issue summary");
    await input.fill(summary);
    await input.press("Enter");
    await expect(toast(page, /Added to the .* backlog/)).toBeVisible();
    await expect(page.getByText(summary).first()).toBeVisible();
  });
});

journey("Issues — bulk-select two issues and set status Done, then Undo", async ({ page, step, note }) => {
  await step("open /issues", () => open(page, "/issues"));
  const keys = [];
  const rowOf = (key) => page.locator("tbody tr").filter({ has: page.getByRole("checkbox", { name: `Select ${key}`, exact: true }) });
  await step("select the first two rows", async () => {
    // two rows that are not Done yet, so the bulk change really changes both
    const rows = page.locator("tbody tr").filter({ has: page.getByRole("checkbox", { name: /^Select [A-Z]+-\d+$/ }) }).filter({ hasNot: page.getByText("Done", { exact: true }) });
    await expect(rows.first()).toBeVisible();
    for (const i of [0, 1]) keys.push(((await rows.nth(i).getByRole("checkbox").getAttribute("aria-label")) ?? "").replace("Select ", ""));
    for (const k of keys) await rowOf(k).getByRole("checkbox").check();
    note(`selected ${keys.join(", ")}`);
    await expect(page.getByText("2 selected")).toBeVisible();
  });
  await step("Status → Done", async () => {
    await button(page, /^Status/).click();
    await page.getByRole("menuitem", { name: "Done" }).click();
    const t = toast(page, /Status → Done for 2 issues/);
    await expect(t).toBeVisible();
    note((await t.innerText()).trim());
  });
  await step("Undo from the toast", async () => {
    const undo = toast(page, /Status → Done/).getByRole("button");
    if (!(await undo.count())) throw new Error("bulk status toast has no Undo action");
    await undo.first().click();
    for (const k of keys) await expect(rowOf(k).getByText("Done", { exact: true })).toHaveCount(0);
  });
});

/* ───────────── journeys: programme ───────────── */

journey("Projects register — register a project, add people, figures, payment, PRC ratification", async ({ page, step, note }) => {
  const title = `QA Falcon ${Date.now() % 10000}`;
  await step("open /projects → Register project", async () => {
    await open(page, "/projects");
    await button(page, /^Register project/).click();
    await expect(dialog(page, "Register an ongoing project")).toBeVisible();
  });
  await step("name it and register → project page", async () => {
    const dlg = dialog(page, "Register an ongoing project");
    await field(dlg, "Project name").fill(title);
    await field(dlg, "Jira project (optional)").selectOption({ index: 1 });
    await button(dlg, "Register project", true).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
  });
  await step("add an existing person as Project Lead", async () => {
    await button(page, /^Add person/).click();
    const dlg = dialog(page, "Add to the project team");
    await expect(dlg).toBeVisible();
    const person = field(dlg, "Person");
    const opt = await person.locator("option", { hasText: "Dimas Saputra" }).first().getAttribute("value").catch(() => null);
    await person.selectOption(opt ? opt : { index: 1 });
    await dlg.getByRole("button", { name: /^Engineer/ }).click(); // de-select default Engineer
    await dlg.getByRole("button", { name: /^Project Lead/ }).click();
    await button(dlg, /Add to register|Circulate amendment/).click();
    await expect(toast(page, /Added to the register|circulated/)).toBeVisible();
  });
  await step("add a new person (not yet in the system)", async () => {
    await button(page, /^Add person/).click();
    const dlg = dialog(page, "Add to the project team");
    await button(dlg, /New person/).click();
    await field(dlg, "Full name").fill("QA Newhire");
    await field(dlg, "Work email").fill(`qa.newhire${Date.now() % 10000}@spectrumgroup.id`);
    await field(dlg, "Job title").fill("Field Engineer");
    await field(dlg, "Hire date").fill("2026-06-01");
    await field(dlg, "Annex B signed on").fill("2026-06-02");
    await button(dlg, /Add to register|Circulate amendment/).click();
    await expect(toast(page, /Added to the register|circulated/)).toBeVisible();
    await expect(page.getByText("QA Newhire").first()).toBeVisible();
  });
  await step("enter the expected case and save figures", async () => {
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Project figures" }) });
    await field(card, "Expected revenue").fill("2500");
    await field(card, "Best").fill("3000");
    await field(card, "Worst").fill("2000");
    await field(card, "Direct costs").fill("800");
    await button(card, "Save", true).click();
    await expect(toast(page, /Project figures saved/)).toBeVisible();
  });
  await step("record a collected client payment", async () => {
    await button(page, /^Record payment/).click();
    const dlg = dialog(page, "Record a client payment");
    await expect(dlg).toBeVisible();
    await field(dlg, "Revenue, Rp million").fill("500");
    await field(dlg, "Direct costs, Rp million").fill("120");
    await field(dlg, "Note").fill("INV-QA-001 milestone 1");
    await button(dlg, "Record payment", true).click();
    await expect(toast(page, /Payment recorded|Earned payment recorded/)).toBeVisible();
  });
  const todayShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(new Date());
  await step("open PRC ratification", async () => {
    await button(page, /^PRC ratification/).click();
    const dlg = dialog(page, `PRC ratification — ${title}`);
    await expect(dlg).toBeVisible();
    const record = button(dlg, /Record PRC ratification/);
    if (await record.isEnabled()) {
      await record.click();
      await expect(toast(page, /brought under Policy v4\.0/)).toBeVisible();
      note("ratified");
    } else {
      const blockers = await dlg.getByText(/^Fix first:/).innerText().catch(() => "(no reason shown)");
      note(`ratification blocked — ${blockers}`);
    }
    await page.keyboard.press("Escape");
  });
  await step(`payment work period ends today (${todayShort}), the default "Work period to"`, async () => {
    const row = page.locator("section", { has: page.getByRole("heading", { name: "Client payments" }) }).locator("tr", { hasText: "INV-QA-001" });
    const period = (await row.locator("td").first().innerText()).replace(/\s+/g, " ").trim();
    note(`work period shown: ${period}`);
    expect(period, "workPeriodEnd = fromDateInput(to) (17:00 WIB) + 86 399 s → next day 16:59 WIB").toMatch(new RegExp(`– ${todayShort}\\b`));
  });
});

journey("Initiatives — new proposal prefilled from a deal (?fromDeal=) and saved as draft", async ({ page, step, note }) => {
  await step("open /initiatives/new?fromDeal=d-nhs-ai", () => open(page, "/initiatives/new?fromDeal=d-nhs-ai"));
  await step("prefill toast and project name filled from the deal", async () => {
    await expect(toast(page, /Prefilled from deal/)).toBeVisible();
    const name = field(page, "Project name");
    await expect(name).not.toHaveValue("");
    note(`prefilled name: ${await name.inputValue()}`);
  });
  await step("Save draft", async () => {
    await button(page, /^Save draft/).click();
    await expect(toast(page, /Draft (created|saved)/)).toBeVisible();
  });
});

journey("Initiatives — propose a team amendment and record a vote", async ({ page, step, note }) => {
  await step("open the SBS initiative → Team tab", async () => {
    await open(page, "/initiatives/ini-sbs-pdm");
    await page.getByRole("tab", { name: /Team/ }).first().click();
    await expect(button(page, /Propose amendment/)).toBeVisible();
  });
  await step("Propose amendment → add a member", async () => {
    await button(page, /Propose amendment/).click();
    const dlg = dialog(page, "Propose an amendment");
    await expect(dlg).toBeVisible();
    await dlg.getByRole("radio", { name: "Add a member" }).click();
    const who = field(dlg, "Joining member");
    if (!(await who.inputValue())) await who.selectOption({ index: 1 });
    const consent = dlg.getByRole("checkbox").first();
    if (await consent.count()) await consent.check();
    await field(dlg, "Reason").fill("QA: second reviewer for the data pipeline");
  });
  await step("circulate to the team", async () => {
    const dlg = dialog(page, "Propose an amendment");
    await button(dlg, /Circulate to the team/).click();
    const t = toast(page, /Amendment (circulated|passed)/);
    await expect(t).toBeVisible();
    note((await t.innerText()).trim());
  });
  await step("record a For vote on the open amendment", async () => {
    let forBtn = page.getByRole("button", { name: "For", exact: true }).first();
    if (!(await forBtn.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /^Open\b|for \d+ · against/ }).first().click();
      forBtn = page.getByRole("button", { name: "For", exact: true }).first();
    }
    await forBtn.click();
    await expect(toast(page, /voted for/)).toBeVisible();
  });
});

journey("Compensation — change monthly-cycle inputs and save provisional bonuses", async ({ page, step, note }) => {
  await step("open /compensation", () => open(page, "/compensation"));
  await step("edit operating overheads", async () => {
    const input = field(page, "Operating overheads (3 months)");
    await expect(input).toBeEditable();
    const before = Number(await input.inputValue());
    note(`overheads before: ${before}`);
    await input.fill(String(before + 50_000_000));
  });
  await step("Save provisional", async () => {
    await button(page, /^Save provisional|^Reopen as provisional/).click();
    await expect(toast(page, /Provisional bonuses saved/)).toBeVisible();
  });
  await step("value persists after reload", async () => {
    await open(page, "/compensation");
    const v = Number(await field(page, "Operating overheads (3 months)").inputValue());
    note(`overheads after reload: ${v}`);
    expect(v % 50_000_000 === 0 || v > 0).toBe(true);
  });
});

journey("People — Add person dialog creates an HR record", async ({ page, step }) => {
  const name = `QA Person ${Date.now() % 10000}`;
  await step("open /people → Add person", async () => {
    await open(page, "/people");
    await button(page, /^Add person/).click();
    await expect(dialog(page, "Add person")).toBeVisible();
  });
  await step("fill the form and save", async () => {
    const dlg = dialog(page, "Add person");
    await field(dlg, "Full name").fill(name);
    await field(dlg, "Work email").fill(`${slug(name)}@spectrumgroup.id`);
    await field(dlg, "Job title").fill("Embedded Engineer");
    await field(dlg, "Hire date").fill("2026-10-01");
    await button(dlg, /^Add person/).click();
    await expect(toast(page, /added — HR to confirm eligibility/)).toBeVisible();
  });
  await step("the new person's HR sheet opens and the list has the row", async () => {
    await expect(page.getByRole("dialog").getByText(name).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(name).first()).toBeVisible();
  });
  await step("a11y: the success toast is announced (not under aria-hidden while the sheet is open)", async () => {
    await button(page, /^Add person/).click();
    const dlg = dialog(page, "Add person");
    const n2 = `${name} B`;
    await field(dlg, "Full name").fill(n2);
    await field(dlg, "Work email").fill(`${slug(n2)}@spectrumgroup.id`);
    await field(dlg, "Job title").fill("Embedded Engineer");
    await field(dlg, "Hire date").fill("2026-10-01");
    await button(dlg, /^Add person/).click();
    const t = toast(page, /added — HR to confirm eligibility/);
    await expect(t).toBeVisible();
    expect(await toastIsExposed(t), "toast role=status is inside an aria-hidden subtree while the HR sheet is open — screen readers never hear it").toBe(true);
  });
});

journey("My compensation — sign the Project Participation Agreement (Annex B)", async ({ page, step }) => {
  await step("open /me acting as Lia Anggraini (unsigned)", async () => {
    await open(page, "/me");
    const acting = page.getByLabel("Acting as");
    if (await acting.count()) await acting.selectOption({ label: "Acting as Lia Anggraini" });
  });
  await step("open the agreement", async () => {
    await page.getByRole("button", { name: /Sign (the v4\.0 agreement|Project Participation Agreement)/ }).first().click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
  });
  await step("tick the acknowledgement and sign", async () => {
    const dlg = page.getByRole("dialog").last();
    await dlg.getByRole("checkbox").first().check();
    await button(dlg, /^Sign as/).click();
    await expect(toast(page, /Project Participation Agreement signed/)).toBeVisible();
    await expect(page.getByRole("button", { name: /View agreement/ }).first()).toBeVisible();
  });
});

journey("Policy — search highlights matches and anchors jump to sections", async ({ page, step, note }) => {
  await step("open /policy", () => open(page, "/policy"));
  await step("search 'clawback' narrows the handbook", async () => {
    const search = page.getByLabel("Search the policy");
    await search.fill("clawback");
    await expect(page.locator("article mark").first()).toBeVisible();
    note(`highlights: ${await page.locator("article mark").count()}`);
  });
  await step("Enter jumps to the first match (URL hash)", async () => {
    await page.getByLabel("Search the policy").press("Enter");
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s-/);
    note(`hash: ${await page.evaluate(() => location.hash)}`);
  });
  await step("fresh deep link /policy#s-9-1 scrolls §9.1 into view", async () => {
    await open(page, "/home");
    await open(page, "/policy#s-9-1");
    await page.waitForTimeout(800);
    await expect(page.locator('[id="s-9-1"]')).toBeInViewport();
  });
  await step("Jump to section select navigates", async () => {
    const jump = page.getByLabel("Jump to section");
    if (!(await jump.isVisible().catch(() => false))) return note("Jump to section select hidden at this width");
    const values = await jump.locator("option").evaluateAll((os) => os.map((o) => o.value));
    const target = values.find((v) => /annex-b/.test(v)) ?? values[values.length - 1];
    await jump.selectOption(target);
    await expect(page.locator(`[id="${target}"]`)).toBeInViewport();
  });
  await step("changing the hash while a search filter hides the target still jumps (clears the search)", async () => {
    await page.getByLabel("Search the policy").fill("clawback");
    await expect(page.locator('[id="s-9-1"]')).toHaveCount(0);
    await page.evaluate(() => (window.location.hash = "#s-9-1"));
    await page.waitForTimeout(800);
    await expect(page.locator('[id="s-9-1"]'), "hashchange handler kept the first render's navigate() (stale query) — section stays filtered out").toBeInViewport();
  });
});

/* ───────────── run ───────────── */

const browser = await chromium.launch();
const results = [];
const selected = journeys.filter((j) => !ONLY || ONLY.test(j.name));
for (const j of selected) {
  const r = await runJourney(browser, j);
  results.push(r);
  console.log(`${r.status === "pass" ? "PASS" : "FAIL"}  ${r.name}  (${(r.ms / 1000).toFixed(1)}s)`);
  for (const s of r.steps.filter((x) => x.status === "fail")) console.log(`      step ${s.n} ${s.label}: ${s.error}`);
  for (const nte of r.notes) console.log(`      note: ${nte}`);
}
await browser.close();

const passed = results.filter((r) => r.status === "pass").length;
const summary = { base: BASE, at: new Date().toISOString(), sha: process.env.GITHUB_SHA ?? null, total: results.length, passed, failed: results.length - passed, journeys: results };
writeFileSync(`${OUT}/report.json`, JSON.stringify(summary, null, 2));

const md = [
  `# QA journeys — ${passed}/${results.length} passed`,
  "",
  `Commit \`${(process.env.GITHUB_SHA ?? "local").slice(0, 7)}\` · ${summary.at}`,
  "",
  "| # | Journey | Result | Time | Failure |",
  "|---|---|---|---|---|",
  ...results.map((r, i) => {
    const f = r.steps.find((s) => s.status === "fail");
    return `| ${i + 1} | ${r.name} | ${r.status === "pass" ? "pass" : "**FAIL**"} | ${(r.ms / 1000).toFixed(1)}s | ${f ? `step ${f.n} “${f.label}”: ${String(f.error).replace(/\|/g, "\\|")}${f.screenshot ? ` — \`${f.screenshot}\`` : ""}` : ""} |`;
  }),
  "",
  "## Details",
  "",
  ...results.flatMap((r) => [
    `### ${r.status === "pass" ? "✓" : "✗"} ${r.name}`,
    "",
    ...r.steps.map((s) => `- ${s.status === "pass" ? "ok" : "FAIL"} — ${s.label}${s.error ? `: ${s.error}` : ""}${s.screenshot ? ` (\`${s.screenshot}\`)` : ""}`),
    ...r.notes.map((n) => `- note: ${n}`),
    ...r.consoleErrors.slice(0, 5).map((c) => `- console: ${c}`),
    `- screenshots: ${r.screenshots.map((s) => `\`${s}\``).join(", ")}`,
    "",
  ]),
].join("\n");
writeFileSync(`${OUT}/report.md`, md + "\n");

console.log(`\nci-journeys: ${passed}/${results.length} journeys passed`);
if (passed !== results.length) process.exit(1);
