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
