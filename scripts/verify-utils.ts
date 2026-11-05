/**
 * Unit checks for the shared helpers: formatting (src/lib/utils.ts), smart-list predicates
 * (src/lib/smart-lists.ts) against the seed data, and the command-palette ranking (src/lib/search.ts).
 *   npm run test:utils
 */
import { countLabel, daysFromNow, dueLabel, endOfDayWib, formatIDR, formatNumber, fromDateInput, fromDateInputOrNull, fromDateTimeInput, groupIDR, initials, isDateInput, parseIDR, plural, relativeTime, startOfDayWib, titleCase, toDateInput, toDateTimeInput, todayInput, wibDayKey } from "../src/lib/utils";
import { SMART_LISTS, type ContactContext } from "../src/lib/smart-lists";
import { contacts, SEED_NOW } from "../src/lib/seed";
import { normalizePhone, phoneKeywords, tokenFilter } from "../src/lib/search";
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

/* ── formatIDR (Indonesian convention: "." groups thousands, "," is the decimal; rb / jt / M = miliar / T) ── */
same("formatIDR compact miliar", formatIDR(8_400_000_000), "Rp 8,4 M");
same("formatIDR compact juta", formatIDR(570_000_000), "Rp 570 jt");
same("formatIDR compact juta decimal", formatIDR(9_500_000), "Rp 9,5 jt");
same("formatIDR compact triliun", formatIDR(70_100_000_000_000), "Rp 70,1 T");
same("formatIDR compact ribu", formatIDR(1_500), "Rp 1,5 rb");
same("formatIDR compact small", formatIDR(950), "Rp 950");
same("formatIDR compact zero", formatIDR(0), "Rp 0");
same("formatIDR compact promotes 999,95 jt to 1 M", formatIDR(999_950_000), "Rp 1 M");
same("formatIDR compact negative", formatIDR(-125_000_000), "-Rp 125 jt");
same("formatIDR negative zero is Rp 0 (compact)", formatIDR(-0), "Rp 0");
same("formatIDR negative zero is Rp 0 (full)", formatIDR(-0, "full"), "Rp 0");
same("formatIDR tiny negative rounds to Rp 0", formatIDR(-0.3, "full"), "Rp 0");
same("formatIDR full uses id-ID grouping", formatIDR(8_400_000_000, "full"), "Rp 8.400.000.000");
same("formatIDR full rounds", formatIDR(1_234_567.6, "full"), "Rp 1.234.568");
same("formatIDR full negative", formatIDR(-1_500_000, "full"), "-Rp 1.500.000");
same("formatIDR NaN", formatIDR(Number.NaN), "—");
same("formatIDR Infinity", formatIDR(Number.POSITIVE_INFINITY, "full"), "—");
same("formatNumber id-ID grouping", formatNumber(3_200), "3.200");
same("formatNumber decimals", formatNumber(1_234.56, 1), "1.234,6");
same("formatNumber negative zero", formatNumber(-0), "0");
same("groupIDR", groupIDR(7_200_000_000), "7.200.000.000");

/* ── parseIDR ── */
const parses: [string, number | null][] = [
  ["7.200.000.000", 7_200_000_000],
  ["7200000000", 7_200_000_000],
  ["Rp 7.200.000.000", 7_200_000_000],
  ["Rp7.200.000.000", 7_200_000_000],
  ["7,2 M", 7_200_000_000],
  ["7,2M", 7_200_000_000],
  ["1,5 miliar", 1_500_000_000],
  ["720 jt", 720_000_000],
  ["720jt", 720_000_000],
  ["720 juta", 720_000_000],
  ["1.500 jt", 1_500_000_000],
  ["7.2B", 7_200_000_000],
  ["7.2 bn", 7_200_000_000],
  ["9.5 mn", 9_500_000],
  ["15 rb", 15_000],
  ["70,1 T", 70_100_000_000_000],
  ["7,200,000", 7_200_000],
  ["7,200", 7_200],
  ["1.234,5", 1_235],
  ["-1.500.000", -1_500_000],
  ["Rp -2 jt", -2_000_000],
  ["0", 0],
  ["", null],
  ["   ", null],
  ["Rp", null],
  ["abc", null],
  ["12xyz", null],
  ["1.2.3", null],
];
for (const [text, want] of parses) same(`parseIDR ${JSON.stringify(text)}`, parseIDR(text), want);
same("parseIDR number passthrough", parseIDR(42), 42);
same("parseIDR null", parseIDR(null), null);
for (const n of [0, 950, 1_500, 125_000_000, 7_200_000_000]) same(`parseIDR(formatIDR full) round-trip ${n}`, parseIDR(formatIDR(n, "full")), n);

/* ── plural / countLabel ── */
same("plural one", plural(1, "deal"), "deal");
same("plural many", plural(3, "deal"), "deals");
same("plural zero", plural(0, "task"), "tasks");
same("plural irregular", plural(2, "person", "people"), "people");
same("countLabel", countLabel(1_204, "contact"), "1.204 contacts");
same("countLabel one", countLabel(1, "overdue task"), "1 overdue task");

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

/* ── safe date inputs (never throw) ── */
same("fromDateInput empty does not throw", fromDateInput(""), "");
same("fromDateInput impossible date", fromDateInput("2026-02-30"), "");
same("fromDateInput partial value", fromDateInput("2026-11"), "");
same("fromDateInputOrNull empty", fromDateInputOrNull(""), null);
same("fromDateInputOrNull valid", fromDateInputOrNull("2026-11-04"), "2026-11-04T10:00:00.000Z");
ok("isDateInput accepts leap day", isDateInput("2028-02-29"));
ok("isDateInput rejects non-leap 29 Feb", !isDateInput("2027-02-29"));
ok("isDateInput rejects empty", !isDateInput(""));
same("toDateInput garbage", toDateInput("not a date"), "");
same("startOfDayWib", startOfDayWib("2026-11-05"), "2026-11-04T17:00:00.000Z");
same("endOfDayWib", endOfDayWib("2026-11-05"), "2026-11-05T16:59:59.999Z");
same("endOfDayWib invalid", endOfDayWib(""), "");
same("todayInput at 01:00 WIB is the WIB day, not the UTC day", todayInput(Date.UTC(2026, 10, 4, 18, 0)), "2026-11-05");
same("wibDayKey", wibDayKey("2026-11-04T17:00:00.000Z"), "2026-11-05");
same("wibDayKey empty", wibDayKey(""), "");
same("toDateTimeInput is WIB wall time", toDateTimeInput("2026-11-05T02:30:00.000Z"), "2026-11-05T09:30");
same("fromDateTimeInput reads WIB", fromDateTimeInput("2026-11-05T09:30"), "2026-11-05T02:30:00.000Z");
same("fromDateTimeInput empty", fromDateTimeInput(""), "");
same("fromDateTimeInput bad hour", fromDateTimeInput("2026-11-05T25:10"), "");
same("datetime round-trip", fromDateTimeInput(toDateTimeInput("2026-12-31T20:45:00.000Z")), "2026-12-31T20:45:00.000Z");

/* ── WIB calendar days ── */
{
  // 5 Nov 00:02 WIB → 13 Nov 17:00 WIB is 8 calendar days (rounded 24 h spans said 9)
  const at = Date.parse("2026-11-04T17:02:00.000Z");
  same("daysFromNow counts WIB calendar days", daysFromNow("2026-11-13T10:00:00.000Z", at), 8);
  // due yesterday 17:00 WIB, viewed at 04:00 WIB → -1 (rounded spans gave -0)
  same("daysFromNow yesterday evening seen early morning", daysFromNow("2026-11-04T10:00:00.000Z", Date.parse("2026-11-04T21:00:00.000Z")), -1);
  same("daysFromNow same WIB day", daysFromNow("2026-11-05T16:00:00.000Z", Date.parse("2026-11-04T17:30:00.000Z")), 0);
  ok("daysFromNow invalid is NaN", Number.isNaN(daysFromNow("", at)));
  same("dueLabel today", dueLabel("2026-11-05T10:00:00.000Z", at), "today");
  same("dueLabel tomorrow", dueLabel("2026-11-06T10:00:00.000Z", at), "tomorrow");
  same("dueLabel future", dueLabel("2026-11-13T10:00:00.000Z", at), "in 8 days");
  same("dueLabel late", dueLabel("2026-11-02T10:00:00.000Z", at), "3 days late");
  same("dueLabel none", dueLabel(null, at), "no date");
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

/* ── phone search keys ── */
same("normalizePhone local 08", normalizePhone("0812 8919 8729"), "+6281289198729");
same("normalizePhone +62 with dashes", normalizePhone("+62-812-8919-8729"), "+6281289198729");
same("normalizePhone 62 prefix", normalizePhone("6281289198729"), "+6281289198729");
same("normalizePhone landline", normalizePhone("(021) 555-0101"), "+62215550101");
same("normalizePhone empty", normalizePhone(""), "");
ok("phoneKeywords match the local form", phoneKeywords("+62 812-8919-8729").includes("081289198729"));
ok("tokenFilter finds a contact by a typed local number", tokenFilter("contact k-1 Rina Kartika", "081289198729", phoneKeywords("+62 812-8919-8729")) > 0);

console.log(`verify-utils: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
