/* Built-in list views ("smart lists") for contacts and companies, plus the pure record helpers they rely on
 * (Indonesian phone normalisation, duplicate detection). Pure module — no React, no store — so the node checks in
 * scripts/verify-utils.ts can import it. */
import type { Company, Contact } from "./types";

export interface ContactContext {
  now: number;
  /** sum of open-deal amounts each contact is associated with */
  openPipelineByContact: Map<string, number>;
  /** the signed-in user — powers "My contacts" */
  currentUserId?: string;
  /** contact id → ids of its likely duplicates (see contactDuplicates) */
  duplicates?: Map<string, string[]>;
}

export interface CompanyContext {
  now: number;
  openPipelineByCompany: Map<string, number>;
  childCount: Map<string, number>;
  currentUserId?: string;
  /** company id → ids of its likely duplicates (see companyDuplicates) */
  duplicates?: Map<string, string[]>;
}

export interface SmartList<T, C> {
  id: string;
  name: string;
  description: string;
  test: (record: T, ctx: C) => boolean;
}

const DAY = 86_400_000;

/* ───────────────────────── phone numbers (+62) ───────────────────────── */

export interface PhoneInfo {
  /** E.164, e.g. "+6281234567890"; null when the input has no usable digits */
  e164: string | null;
  /** looks like a dialable number (Indonesian: +62 followed by 8–12 digits; other countries 8–15 digits) */
  valid: boolean;
  /** Indonesian mobile (+62 8…) — can receive WhatsApp */
  mobile: boolean;
}

/**
 * Normalise an Indonesian phone number: "0812-3456-7890", "62 812 3456 7890", "+62 (812) 3456 7890" and "812 3456 7890"
 * all become "+6281234567890". Numbers with another country code are kept as they are.
 */
export function normalisePhone(raw: string | null | undefined): PhoneInfo {
  const s = (raw ?? "").trim();
  if (!s) return { e164: null, valid: false, mobile: false };
  const plus = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("00")) digits = digits.slice(2);
  if (!digits) return { e164: null, valid: false, mobile: false };
  if (!plus) {
    if (digits.startsWith("62")) {
      /* already has the country code */
    } else if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
    else if (digits.startsWith("8")) digits = `62${digits}`;
  }
  // "+62 0812…" — a trunk zero after the country code is a common typo
  if (digits.startsWith("620")) digits = `62${digits.slice(3)}`;
  const e164 = `+${digits}`;
  if (digits.startsWith("62")) {
    const national = digits.slice(2);
    const valid = national.length >= 8 && national.length <= 12;
    return { e164, valid, mobile: valid && national.startsWith("8") };
  }
  return { e164, valid: digits.length >= 8 && digits.length <= 15, mobile: false };
}

/** "+6281234567890" → "+62 812-3456-7890"; landlines keep their area code: "+62 21 5790 1120" */
export function formatPhone(raw: string | null | undefined): string {
  const info = normalisePhone(raw);
  if (!info.e164 || !info.valid) return (raw ?? "").trim();
  const d = info.e164.slice(1);
  if (!d.startsWith("62")) return info.e164;
  const n = d.slice(2);
  if (info.mobile) return `+62 ${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  // Jakarta (21), Bandung (22), Surabaya (31), Semarang (24), Medan (61) … use 2-digit area codes; others 3
  const area = /^(21|22|24|31|61)/.test(n) ? n.slice(0, 2) : n.slice(0, 3);
  const rest = n.slice(area.length);
  return `+62 ${area} ${rest.length > 4 ? `${rest.slice(0, rest.length - 4)} ${rest.slice(-4)}` : rest}`;
}

/** wa.me click-to-chat link (digits only, international format) or null when the number cannot receive WhatsApp */
export function whatsappLink(raw: string | null | undefined, text?: string): string | null {
  const info = normalisePhone(raw);
  if (!info.e164 || !info.valid) return null;
  const digits = info.e164.slice(1);
  // only Indonesian mobiles are known to be on WhatsApp; foreign numbers are allowed when valid
  if (digits.startsWith("62") && !info.mobile) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/* ───────────────────────── duplicate detection ───────────────────────── */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** company name without legal-form noise: "PT Sinar Baja Tbk." → "sinar baja" */
export function companyNameKey(name: string) {
  return norm(name)
    .split(" ")
    .filter((w) => w && !["pt", "tbk", "cv", "persero", "ltd", "inc", "co", "corp", "the", "company"].includes(w))
    .join(" ");
}

function groupBy<T extends { id: string }>(items: T[], keysOf: (x: T) => (string | null)[]) {
  const buckets = new Map<string, string[]>();
  items.forEach((x) =>
    keysOf(x).forEach((k) => {
      if (!k) return;
      const b = buckets.get(k);
      if (b) b.push(x.id);
      else buckets.set(k, [x.id]);
    }),
  );
  const out = new Map<string, string[]>();
  buckets.forEach((ids) => {
    if (ids.length < 2) return;
    ids.forEach((id) => {
      const others = new Set(out.get(id) ?? []);
      ids.forEach((o) => o !== id && others.add(o));
      out.set(id, Array.from(others));
    });
  });
  return out;
}

/** contact id → likely duplicates: same email, same normalised phone, or same name at the same company */
export function contactDuplicates(contacts: Contact[]): Map<string, string[]> {
  return groupBy(contacts, (c) => {
    const phone = normalisePhone(c.phone);
    const name = norm(`${c.firstName} ${c.lastName}`);
    return [c.email ? `e:${c.email.trim().toLowerCase()}` : null, phone.valid ? `p:${phone.e164}` : null, name ? `n:${name}|${c.companyId ?? "-"}` : null];
  });
}

/** company id → likely duplicates: same domain (ignoring www.) or the same name once legal forms are stripped */
export function companyDuplicates(companies: Company[]): Map<string, string[]> {
  return groupBy(companies, (c) => {
    const domain = c.domain.trim().toLowerCase().replace(/^www\./, "");
    const key = companyNameKey(c.name);
    return [domain ? `d:${domain}` : null, key ? `n:${key}` : null];
  });
}

/** why two contacts look like the same person (for the merge dialog) */
export function contactMatchReasons(a: Contact, b: Contact): string[] {
  const r: string[] = [];
  if (a.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) r.push("same email");
  const pa = normalisePhone(a.phone);
  const pb = normalisePhone(b.phone);
  if (pa.valid && pa.e164 === pb.e164) r.push("same phone");
  if (norm(`${a.firstName} ${a.lastName}`) === norm(`${b.firstName} ${b.lastName}`) && a.companyId === b.companyId) r.push("same name and company");
  return r;
}

export function companyMatchReasons(a: Company, b: Company): string[] {
  const r: string[] = [];
  if (a.domain && a.domain.trim().toLowerCase().replace(/^www\./, "") === b.domain.trim().toLowerCase().replace(/^www\./, "")) r.push("same domain");
  if (companyNameKey(a.name) && companyNameKey(a.name) === companyNameKey(b.name)) r.push("same name");
  return r;
}

/* ───────────────────────── lists ───────────────────────── */

export const SMART_LISTS: SmartList<Contact, ContactContext>[] = [
  { id: "all", name: "All contacts", description: "Every contact in the CRM", test: () => true },
  { id: "mine", name: "My contacts", description: "Contacts you own", test: (c, ctx) => !!ctx.currentUserId && c.ownerId === ctx.currentUserId },
  {
    id: "hot-leads",
    name: "Hot leads",
    description: "Lead score ≥ 75 and not yet a customer",
    test: (c) => c.leadScore >= 75 && c.lifecycleStage !== "customer" && c.lifecycleStage !== "evangelist",
  },
  {
    id: "handoff",
    name: "MQL → SQL handoff",
    description: "Marketing- and sales-qualified leads",
    test: (c) => c.lifecycleStage === "mql" || c.lifecycleStage === "sql",
  },
  {
    id: "stale",
    name: "Going cold (14d+)",
    description: "Active stages, not contacted in 14 days or never",
    test: (c, ctx) => c.lifecycleStage !== "subscriber" && (!c.lastContactedAt || ctx.now - Date.parse(c.lastContactedAt) > 14 * DAY),
  },
  {
    id: "big-pipeline",
    name: "On deals ≥ Rp 2 M",
    description: "Associated with at least Rp 2 miliar (Rp 2.000.000.000) of open pipeline",
    test: (c, ctx) => (ctx.openPipelineByContact.get(c.id) ?? 0) >= 2_000_000_000,
  },
  { id: "customers", name: "Customers & evangelists", description: "Lifecycle stage customer or evangelist", test: (c) => c.lifecycleStage === "customer" || c.lifecycleStage === "evangelist" },
  { id: "bad-phone", name: "Bad phone", description: "Missing or undialable phone number (WhatsApp needs a +62 8… mobile)", test: (c) => !normalisePhone(c.phone).valid },
  { id: "duplicates", name: "Possible duplicates", description: "Same email, same phone, or same name at the same company", test: (c, ctx) => (ctx.duplicates?.get(c.id)?.length ?? 0) > 0 },
];

export const COMPANY_LISTS: SmartList<Company, CompanyContext>[] = [
  { id: "all", name: "All companies", description: "Every company", test: () => true },
  { id: "mine", name: "My companies", description: "Companies you own", test: (c, ctx) => !!ctx.currentUserId && c.ownerId === ctx.currentUserId },
  { id: "strategic", name: "Strategic accounts", description: "Tier = Strategic", test: (c) => c.tier === "Strategic" },
  { id: "customers", name: "Customers", description: "Lifecycle stage customer or evangelist", test: (c) => c.lifecycleStage === "customer" || c.lifecycleStage === "evangelist" },
  { id: "pipeline", name: "Open pipeline ≥ Rp 5 M", description: "At least Rp 5 miliar (Rp 5.000.000.000) of open deals", test: (c, ctx) => (ctx.openPipelineByCompany.get(c.id) ?? 0) >= 5_000_000_000 },
  { id: "hierarchy", name: "Parent accounts", description: "Companies with child business units", test: (c, ctx) => (ctx.childCount.get(c.id) ?? 0) > 0 },
  { id: "unenriched", name: "Needs enrichment", description: "Domain enrichment not yet run", test: (c) => !c.enriched },
  { id: "duplicates", name: "Possible duplicates", description: "Same domain or the same name once PT / Tbk / CV are ignored", test: (c, ctx) => (ctx.duplicates?.get(c.id)?.length ?? 0) > 0 },
];
