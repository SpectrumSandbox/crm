import { normalisePhone } from "./smart-lists";

/**
 * Command-palette ranking (cmdk `filter`): every typed word must appear somewhere in the item's value or
 * keywords; whole-word / prefix hits rank higher than mid-word hits. Returns 0 (hidden) … 1 (best).
 */
export function tokenFilter(value: string, search: string, keywords?: string[]) {
  const hay = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  let score = 0;
  for (const t of tokens) {
    const at = hay.indexOf(t);
    if (at < 0) return 0;
    score += at === 0 || /[\s\-—·(/]/.test(hay[at - 1] ?? "") ? 1 : 0.5;
  }
  return score / tokens.length;
}

/**
 * Indonesian phone number in E.164 form for matching and WhatsApp links: "0812 8919 8729" / "62812…" / "+62-812-…" →
 * "+6281289198729" (the CRM's one normaliser, normalisePhone in smart-lists.ts). Returns "" when there are no digits.
 */
export function normalizePhone(raw: string | null | undefined) {
  return normalisePhone(raw).e164 ?? "";
}

/** Search keywords for a phone number: E.164, bare digits and the local 0… form, so any way of typing it matches. */
export function phoneKeywords(raw: string | null | undefined): string[] {
  const e164 = normalizePhone(raw);
  if (!e164) return [];
  const digits = e164.slice(1);
  const out = [e164, digits];
  if (digits.startsWith("62")) out.push(`0${digits.slice(2)}`);
  return out;
}

/**
 * Top `limit` items for a query using the same ranking as the palette (tokenFilter), best first, plus the total match
 * count — lets a result group render a bounded list with "See all (n)".
 */
export function topMatches<T>(items: readonly T[], search: string, toText: (item: T) => { value: string; keywords?: string[] }, limit = 8) {
  const scored: { item: T; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const { value, keywords } = toText(item);
    const score = tokenFilter(value, search, keywords);
    if (score > 0) scored.push({ item, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return { items: scored.slice(0, limit).map((s) => s.item), total: scored.length };
}
