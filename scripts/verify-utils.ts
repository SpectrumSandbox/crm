/**
 * Unit checks for the shared helpers: formatting (src/lib/utils.ts), smart-list predicates
 * (src/lib/smart-lists.ts) against the seed data, and the command-palette ranking (src/lib/search.ts).
 *   npm run test:utils
 */
import { formatIDR, fromDateInput, initials, relativeTime, titleCase, toDateInput } from "../src/lib/utils";
import { SMART_LISTS, type ContactContext } from "../src/lib/smart-lists";
import { contacts, SEED_NOW } from "../src/lib/seed";
import { tokenFilter } from "../src/lib/search";
import type { Contact } from "../src/lib/types";

let failures = 0;
let passes = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) passes++;
  else {
    failures++;
    console.error(`✗ ${label}${detail === undefined ? "" : ` — got ${JSON.stringify(detail)}`}`);
  }
}
function same<T>(label: string, actual: T, expected: T) {
  ok(`${label}: expected ${JSON.stringify(expected)}`, actual === expected, actual);
}

const DAY = 86_400_000;

/* ── formatIDR ── */
same("formatIDR compact billions", formatIDR(8_400_000_000), "Rp 8.4B");
same("formatIDR compact millions", formatIDR(125_000_000), "Rp 125M");
same("formatIDR compact thousands", formatIDR(1_500), "Rp 1.5K");
same("formatIDR compact small", formatIDR(950), "Rp 950");
same("formatIDR compact zero", formatIDR(0), "Rp 0");
same("formatIDR full uses id-ID grouping", formatIDR(8_400_000_000, "full"), "Rp 8.400.000.000");
same("formatIDR full rounds", formatIDR(1_234_567.6, "full"), "Rp 1.234.568");
same("formatIDR NaN", formatIDR(Number.NaN), "—");
same("formatIDR Infinity", formatIDR(Number.POSITIVE_INFINITY, "full"), "—");

/* ── relativeTime ── */
const now = Date.UTC(2026, 10, 4, 2, 0, 0);
const iso = (ms: number) => new Date(now + ms).toISOString();
same("relativeTime null", relativeTime(null, now), "never");
same("relativeTime <1m", relativeTime(iso(-30_000), now), "just now");
same("relativeTime minutes ago", relativeTime(iso(-5 * 60_000), now), "5m ago");
same("relativeTime hours ago", relativeTime(iso(-3 * 3_600_000), now), "3h ago");
same("relativeTime days ago", relativeTime(iso(-3 * DAY), now), "3d ago");
same("relativeTime future hours", relativeTime(iso(2 * 3_600_000), now), "in 2h");
same("relativeTime months", relativeTime(iso(-65 * DAY), now), "2mo ago");
same("relativeTime years", relativeTime(iso(400 * DAY), now), "in 1y");

/* ── toDateInput / fromDateInput (WIB, UTC+7) ── */
same("fromDateInput → 17:00 WIB", fromDateInput("2026-11-04"), "2026-11-04T10:00:00.000Z");
same("toDateInput null", toDateInput(null), "");
same("toDateInput late UTC evening is next day in WIB", toDateInput("2026-11-04T18:30:00.000Z"), "2026-11-05");
same("toDateInput early UTC is same day in WIB", toDateInput("2026-11-04T00:30:00.000Z"), "2026-11-04");
for (const d of ["2026-01-01", "2026-02-28", "2026-12-31", "2027-06-15", "2028-02-29"]) {
  same(`date round-trip ${d}`, toDateInput(fromDateInput(d)), d);
}
{
  // any instant → date → back lands on 17:00 WIB of the same WIB calendar day
  const instant = "2026-11-04T20:15:00.000Z"; // 03:15 WIB on 5 Nov
  same("round-trip from instant keeps the WIB day", fromDateInput(toDateInput(instant)), "2026-11-05T10:00:00.000Z");
}

/* ── initials / titleCase ── */
same("initials two words", initials("Bennaya Kusuma"), "BK");
same("initials three words takes first two", initials("Maria Clara Gunadi"), "MC");
same("initials single + extra spaces", initials("  ada  "), "A");
same("initials empty", initials(""), "");
same("titleCase snake", titleCase("closed_won"), "Closed Won");
same("titleCase words", titleCase("in progress"), "In Progress");

/* ── smart lists vs seed ── */
const list = (id: string) => {
  const l = SMART_LISTS.find((x) => x.id === id);
  if (!l) throw new Error(`smart list ${id} missing`);
  return l;
};
const ctx: ContactContext = { now: SEED_NOW, openPipelineByContact: new Map() };
ok("seed has contacts", contacts.length > 0, contacts.length);
{
  const hot = contacts.filter((c) => list("hot-leads").test(c, ctx));
  ok("hot leads: seed yields at least one", hot.length > 0, hot.length);
  for (const c of hot) {
    ok(`hot lead ${c.id} score ≥ 75`, c.leadScore >= 75, c.leadScore);
    ok(`hot lead ${c.id} is not a customer`, c.lifecycleStage !== "customer" && c.lifecycleStage !== "evangelist", c.lifecycleStage);
  }
  const missed = contacts.filter((c) => c.leadScore >= 75 && c.lifecycleStage !== "customer" && c.lifecycleStage !== "evangelist" && !hot.includes(c));
  ok("hot leads: no qualifying contact is left out", missed.length === 0, missed.map((c) => c.id));
}
{
  const stale = list("stale");
  const flagged = contacts.filter((c) => stale.test(c, ctx));
  ok("stale: seed yields at least one", flagged.length > 0, flagged.length);
  for (const c of flagged) {
    ok(`stale ${c.id} is not a subscriber`, c.lifecycleStage !== "subscriber", c.lifecycleStage);
    ok(`stale ${c.id} untouched for 14d+`, !c.lastContactedAt || SEED_NOW - Date.parse(c.lastContactedAt) > 14 * DAY, c.lastContactedAt);
  }
  const base = contacts.find((c) => c.lifecycleStage === "lead") ?? contacts[0];
  const probe = (patch: Partial<Contact>) => stale.test({ ...base, ...patch }, ctx);
  ok("stale: contacted 3 days ago is fresh", !probe({ lifecycleStage: "lead", lastContactedAt: new Date(SEED_NOW - 3 * DAY).toISOString() }));
  ok("stale: exactly 14 days is not yet stale", !probe({ lifecycleStage: "lead", lastContactedAt: new Date(SEED_NOW - 14 * DAY).toISOString() }));
  ok("stale: 15 days ago is stale", probe({ lifecycleStage: "lead", lastContactedAt: new Date(SEED_NOW - 15 * DAY).toISOString() }));
  ok("stale: never contacted is stale", probe({ lifecycleStage: "lead", lastContactedAt: null }));
  ok("stale: subscribers are never stale", !probe({ lifecycleStage: "subscriber", lastContactedAt: null }));
}
{
  const all = contacts.filter((c) => list("all").test(c, ctx));
  same("all contacts list matches everything", all.length, contacts.length);
  const big = list("big-pipeline");
  const someone = contacts[0];
  ok("big-pipeline: ≥ Rp 2B qualifies", big.test(someone, { now: SEED_NOW, openPipelineByContact: new Map([[someone.id, 2_000_000_000]]) }));
  ok("big-pipeline: below Rp 2B does not", !big.test(someone, { now: SEED_NOW, openPipelineByContact: new Map([[someone.id, 1_999_999_999]]) }));
}

/* ── command palette tokenFilter ── */
same("tokenFilter empty query shows everything", tokenFilter("deal d-1 Radar upgrade", ""), 1);
same("tokenFilter whitespace query shows everything", tokenFilter("deal d-1 Radar upgrade", "   "), 1);
same("tokenFilter missing word hides", tokenFilter("deal d-1 Radar upgrade", "radar sonar"), 0);
same("tokenFilter whole-word hit", tokenFilter("deal d-1 Radar upgrade", "radar"), 1);
same("tokenFilter mid-word hit ranks lower", tokenFilter("deal d-1 Radar upgrade", "adar"), 0.5);
same("tokenFilter is case-insensitive", tokenFilter("contact Rina Kartika", "RINA"), 1);
same("tokenFilter searches keywords", tokenFilter("company c-bap Bina Aero", "aerospace", ["Aerospace & Defence", "Bandung"]), 1);
same("tokenFilter every token must match (mixed)", tokenFilter("issue UAV-102 Telemetry dropouts", "uav tele"), 1);
same("tokenFilter averages token scores", tokenFilter("issue UAV-102 Telemetry dropouts", "102 lemetry"), 0.75);
ok("tokenFilter prefix beats mid-word", tokenFilter("nav Contacts", "con") > tokenFilter("nav Deals pipeline", "eal"));

console.log(`verify-utils: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
