/*
 * Parses the embedded policy Markdown (docs/policy/v4.0.md, a Google Docs export) into a navigable structure:
 * sections (## …) with sub-sections (### …), each holding blocks — paragraphs, bullet / numbered lists, pipe tables
 * and LaTeX formulas. Anchor ids follow the app-wide convention: §5 → s-5, §5.1 → s-5-1, Annex D → s-annex-d.
 */
import { POLICY_V4_SOURCE } from "./source";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[]; nested: boolean }
  | { kind: "ol"; start: number; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][]; form: boolean }
  | { kind: "formula"; tex: string };

export interface PolicySub {
  id: string;
  num: string | null;
  title: string;
  blocks: Block[];
  /** lower-cased plain text of title + body, for the search box */
  search: string;
}

export interface PolicySection {
  id: string;
  kind: "control" | "section" | "annex";
  num: string | null; // "5" or "A"
  title: string;
  /** "§5", "Annex A" or "" for Document control */
  label: string;
  intro: Block[];
  subs: PolicySub[];
  search: string;
}

export interface PolicyDoc {
  title: string;
  byline: string;
  preamble: Block[];
  sections: PolicySection[];
  /** every anchor id in the document */
  ids: Set<string>;
}

/** Markdown backslash escapes: `\_` → `_`, `\\` → `\`, `\>` → `>`, `\*` → `*` … */
export function unescapeMd(s: string) {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|>~%&])/g, "$1");
}

const clean = (s: string) => s.replace(/ /g, " ").trim();
const stripBold = (s: string) => clean(s).replace(/^\*\*(.*)\*\*$/, "$1").trim();
export const plainText = (s: string) => unescapeMd(s).replace(/\*\*/g, "").replace(/\\_/g, "_");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const sectionAnchor = (num: string) => `s-${num.replace(/\./g, "-")}`;

const FORMULA = /\\\\(begin|text|frac|dfrac|times|sum|le|qquad)\b/;

function blockText(b: Block): string {
  switch (b.kind) {
    case "p":
      return plainText(b.text);
    case "ul":
    case "ol":
      return b.items.map(plainText).join(" ");
    case "table":
      return [...b.head, ...b.rows.flat()].map(plainText).join(" ");
    case "formula":
      return unescapeMd(b.tex).replace(/\\[a-z]+/g, " ").replace(/[{}]/g, "");
  }
}

function splitRow(line: string) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map(clean);
}

function parseTable(lines: string[]): Block {
  const rows = lines.map(splitRow).filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
  let head = rows[0] ?? [];
  let body = rows.slice(1);
  // Google Docs exports an empty header row; the real header is the first data row
  if (head.every((c) => !c) && body.length) {
    head = body[0];
    body = body.slice(1);
  }
  const cells = body.flat();
  const form = cells.length > 0 && cells.filter((c) => !c).length / cells.length >= 0.45;
  return { kind: "table", head, rows: body, form };
}

/** Group raw lines into blocks; numbered lists split by `<!-- end list -->` keep counting (Google Docs export quirk). */
function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let table: string[] = [];
  let afterEndList = false;
  const flushTable = () => {
    if (table.length) blocks.push(parseTable(table));
    table = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/ /g, " ");
    if (line.trim().startsWith("|")) {
      table.push(line);
      continue;
    }
    flushTable();
    const t = line.trim();
    if (!t) continue;
    if (t === "<!-- end list -->") {
      afterEndList = true;
      continue;
    }
    const prev = blocks[blocks.length - 1];
    const bullet = /^[-*]\s+(.*)$/.exec(t);
    const numbered = /^(\d+)\.\s+(.*)$/.exec(t);
    if (bullet) {
      if (prev?.kind === "ul" && !afterEndList) prev.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]], nested: afterEndList && prev?.kind === "ol" });
    } else if (numbered) {
      const n = Number(numbered[1]);
      if (prev?.kind === "ol" && !afterEndList) prev.items.push(numbered[2]);
      else {
        let start = n;
        const before = blocks[blocks.length - 2];
        if (n === 1 && afterEndList && prev?.kind === "ul" && prev.nested && before?.kind === "ol") start = before.start + before.items.length;
        blocks.push({ kind: "ol", start, items: [numbered[2]] });
      }
    } else if (FORMULA.test(t)) {
      blocks.push({ kind: "formula", tex: t });
    } else {
      blocks.push({ kind: "p", text: t });
    }
    afterEndList = false;
  }
  flushTable();
  return blocks;
}

function parse(md: string): PolicyDoc {
  const lines = md.split(/\r?\n/);
  let title = "";
  const pre: string[] = [];
  type RawSub = { heading: string; lines: string[] };
  type RawSection = { heading: string; lines: string[]; subs: RawSub[] };
  const raw: RawSection[] = [];
  for (const line of lines) {
    if (/^#\s/.test(line)) {
      title = stripBold(line.replace(/^#\s+/, ""));
      continue;
    }
    if (/^##\s/.test(line)) {
      raw.push({ heading: stripBold(line.replace(/^##\s+/, "")), lines: [], subs: [] });
      continue;
    }
    if (/^###\s/.test(line)) {
      raw[raw.length - 1]?.subs.push({ heading: stripBold(line.replace(/^###\s+/, "")), lines: [] });
      continue;
    }
    const sec = raw[raw.length - 1];
    if (!sec) pre.push(line);
    else if (sec.subs.length) sec.subs[sec.subs.length - 1].lines.push(line);
    else sec.lines.push(line);
  }

  const ids = new Set<string>();
  const sections: PolicySection[] = raw.map((r) => {
    const annex = /^Annex ([A-H])\.\s*(.*)$/.exec(r.heading);
    const numbered = /^(\d+)\.\s+(.*)$/.exec(r.heading);
    const kind: PolicySection["kind"] = annex ? "annex" : numbered ? "section" : "control";
    const num = annex ? annex[1] : numbered ? numbered[1] : null;
    const id = annex ? `s-annex-${annex[1].toLowerCase()}` : numbered ? sectionAnchor(numbered[1]) : `s-${slug(r.heading)}`;
    const titleText = annex ? annex[2] : numbered ? numbered[2] : r.heading;
    ids.add(id);
    const subs: PolicySub[] = r.subs.map((s) => {
      const m = /^(\d+(?:\.\d+)+)\s+(.*)$/.exec(s.heading);
      const subId = m ? sectionAnchor(m[1]) : `${id}-${slug(s.heading.replace(/^Part (\d+)\..*$/, "part-$1"))}`;
      ids.add(subId);
      const blocks = parseBlocks(s.lines);
      const search = [s.heading, ...blocks.map(blockText)].join(" ").toLowerCase();
      return { id: subId, num: m ? m[1] : null, title: m ? m[2] : s.heading, blocks, search };
    });
    const intro = parseBlocks(r.lines);
    const search = [r.heading, ...intro.map(blockText)].join(" ").toLowerCase();
    return { id, kind, num, title: titleText, label: annex ? `Annex ${annex[1]}` : numbered ? `§${numbered[1]}` : "", intro, subs, search };
  });

  const preBlocks = parseBlocks(pre);
  const first = preBlocks[0];
  const byline = first?.kind === "p" && /^Version/.test(first.text) ? first.text : "";
  return { title, byline, preamble: byline ? preBlocks.slice(1) : preBlocks, sections, ids };
}

let cached: PolicyDoc | null = null;
/** The parsed v4.0 policy (memoised — the source is static). */
export function policyDoc(): PolicyDoc {
  if (!cached) cached = parse(POLICY_V4_SOURCE);
  return cached;
}

/** Find a sub-section by anchor id (e.g. "s-16-2"). */
export function findSub(id: string) {
  for (const s of policyDoc().sections) {
    const sub = s.subs.find((x) => x.id === id);
    if (sub) return sub;
  }
  return null;
}

/** Find a top-level section by anchor id (e.g. "s-annex-b"). */
export function findSection(id: string) {
  return policyDoc().sections.find((s) => s.id === id) ?? null;
}

/** Closest existing anchor for a requested one: s-4-3-5 → s-4-3 → s-4. */
export function resolveAnchor(id: string): string | null {
  const ids = policyDoc().ids;
  let cur = id;
  while (cur) {
    if (ids.has(cur)) return cur;
    const cut = cur.lastIndexOf("-");
    if (cut <= 1) break;
    cur = cur.slice(0, cut);
    if (cur === "s") break;
  }
  return null;
}
