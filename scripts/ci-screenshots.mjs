// Visual smoke test used by CI: boots against a running `next start` and captures every Phase 1 view.
// Usage: BASE_URL=http://localhost:3000 OUT=shots node scripts/ci-screenshots.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "shots";
mkdirSync(OUT, { recursive: true });

const log = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") log.push(`[${m.type()}] ${page.url()} :: ${m.text()}`);
});
page.on("pageerror", (e) => log.push(`[pageerror] ${page.url()} :: ${e.message}`));

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

  // shortcuts dialog
  await page.keyboard.press("?");
  await shot("18-shortcuts");
} catch (e) {
  log.push(`[script-error] ${e instanceof Error ? e.stack : String(e)}`);
  await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
  await browser.close();
}
