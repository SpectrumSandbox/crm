/*
 * Quote calculations (no React): PPN per PMK 131/2024 (DPP nilai lain 11/12 × 12 %), suggested faktur code,
 * client withholding (PPh Final 0.5 % under PP 55/2022 — Policy §5.4 — or PPh 23 2 % on services), approval needs
 * (Policy §4.7 Finance check + director threshold), expiry, and amounts in words (terbilang / English).
 */
import type { Company, LineItem, Product, Quote, QuoteSettings, QuoteStatus } from "@/lib/types";

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  id: "qs-default",
  financeCheckRequired: true,
  directorDiscountPct: 10,
  directorTotalIdr: 5_000_000_000,
  defaultValidityDays: 30,
  supplierLegalName: "Spectrum Group",
  supplierNpwp: "",
  supplierAddress: "",
  supplierBank: "",
  supplierPkp: true,
  umkmFinalTax: true,
};

export function settingsOf(rows: QuoteSettings[] | undefined): QuoteSettings {
  return { ...DEFAULT_QUOTE_SETTINGS, ...(rows?.[0] ?? {}) };
}

type Line = Pick<LineItem, "productId" | "quantity" | "unitPrice" | "discountPct">;

export const lineTotal = (l: Pick<LineItem, "quantity" | "unitPrice" | "discountPct">) => l.quantity * l.unitPrice * (1 - l.discountPct / 100);

/** services are PPh 23 objects; hardware is goods. Explicit Product.taxKind wins. */
export function isService(p: Pick<Product, "sku" | "billing" | "taxKind"> | undefined) {
  if (!p) return true;
  if (p.taxKind) return p.taxKind === "service";
  if (p.billing !== "one_time") return true;
  return /-(ENG|TRN|SW|DOC|CTL|SNS|AI)(-|$)/.test(p.sku);
}

/** suggested faktur transaction code from the customer's entity type */
export function suggestedFakturCode(company: Pick<Company, "entityType"> | undefined) {
  if (company?.entityType === "pemerintah") return "02";
  if (company?.entityType === "bumn") return "03";
  return "04";
}

export const FAKTUR_CODES: Record<string, string> = {
  "01": "01 · to non-collectors (DPP = price)",
  "02": "02 · to a government VAT collector",
  "03": "03 · to another VAT collector (BUMN etc.)",
  "04": "04 · DPP nilai lain (11/12)",
  "07": "07 · VAT not collected (facility)",
  "08": "08 · VAT exempt",
};

export interface QuoteTotals {
  subtotal: number;
  dpp: number;
  dppFactor: number;
  vatRate: number;
  vat: number;
  total: number;
  services: number;
  goods: number;
  withholding: number;
  withholdingLabel: string;
  expectedCash: number;
  maxDiscount: number;
  fakturCode: string;
  pkp: boolean;
}

export function quoteTotals(lines: Line[], opts: { quote?: Pick<Quote, "vatRate" | "dppFactor" | "fakturCode" | "taxPct">; settings: QuoteSettings; products: Pick<Product, "id" | "sku" | "billing" | "taxKind">[]; company?: Pick<Company, "entityType"> }): QuoteTotals {
  const { quote, settings, products, company } = opts;
  const byId = new Map(products.map((p) => [p.id, p] as const));
  let subtotal = 0;
  let services = 0;
  let maxDiscount = 0;
  for (const l of lines) {
    const t = lineTotal(l);
    subtotal += t;
    if (isService(byId.get(l.productId))) services += t;
    maxDiscount = Math.max(maxDiscount, l.discountPct);
  }
  const pkp = settings.supplierPkp;
  const vatRate = pkp ? (quote?.vatRate ?? 12) : 0;
  const dppFactor = quote?.dppFactor ?? 11 / 12;
  const dpp = Math.round(subtotal * dppFactor);
  const vat = pkp ? Math.round(dpp * (vatRate / 100)) : 0;
  const total = Math.round(subtotal) + vat;
  const withholding = settings.umkmFinalTax ? Math.round(subtotal * 0.005) : Math.round(services * 0.02);
  const withholdingLabel = settings.umkmFinalTax ? "PPh Final 0.5 % (PP 55/2022) withheld by the client on the price excl. VAT" : "PPh 23 2 % withheld by the client on services";
  return {
    subtotal: Math.round(subtotal),
    dpp,
    dppFactor,
    vatRate,
    vat,
    total,
    services: Math.round(services),
    goods: Math.round(subtotal - services),
    withholding,
    withholdingLabel,
    expectedCash: total - withholding,
    maxDiscount,
    fakturCode: quote?.fakturCode ?? suggestedFakturCode(company),
    pkp,
  };
}

/* ───────────── approvals (§4.7) ───────────── */

export interface ApprovalNeeds {
  finance: boolean;
  director: boolean;
  reasons: string[];
  financeDone: boolean;
  directorDone: boolean;
  complete: boolean;
}

export function approvalNeeds(quote: Pick<Quote, "financeCheckedAt" | "directorApprovedAt">, totals: Pick<QuoteTotals, "subtotal" | "maxDiscount">, settings: QuoteSettings): ApprovalNeeds {
  const reasons: string[] = [];
  const finance = settings.financeCheckRequired;
  if (finance) reasons.push("Finance checks every quotation before it is sent (§4.7)");
  const overDiscount = totals.maxDiscount >= settings.directorDiscountPct && settings.directorDiscountPct > 0;
  const overTotal = totals.subtotal >= settings.directorTotalIdr && settings.directorTotalIdr > 0;
  if (overDiscount) reasons.push(`A line discount of ${totals.maxDiscount}% is at or above ${settings.directorDiscountPct}%`);
  if (overTotal) reasons.push(`Total excl. VAT is at or above the director threshold`);
  const director = overDiscount || overTotal;
  const financeDone = !finance || !!quote.financeCheckedAt;
  const directorDone = !director || !!quote.directorApprovedAt;
  return { finance, director, reasons, financeDone, directorDone, complete: financeDone && directorDone };
}

/* ───────────── expiry ───────────── */

const OPEN_FOR_EXPIRY: QuoteStatus[] = ["draft", "pending_approval", "approved", "sent"];

export function isQuoteExpired(q: Pick<Quote, "status" | "expiresAt">, now = Date.now()) {
  return q.status === "expired" || (OPEN_FOR_EXPIRY.includes(q.status) && Date.parse(q.expiresAt) < now);
}

/** "expires in 5d", "expires today", "Expired 3d ago" */
export function expiryLabel(q: Pick<Quote, "status" | "expiresAt" | "signedAt">, now = Date.now()) {
  if (q.status === "signed") return q.signedAt ? `signed ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(new Date(q.signedAt))}` : "signed";
  const days = Math.round((Date.parse(q.expiresAt) - now) / 86_400_000);
  if (isQuoteExpired(q, now)) return days === 0 ? "Expired today" : `Expired ${Math.abs(days)}d ago`;
  if (days <= 0) return "expires today";
  return `expires in ${days}d`;
}

/* ───────────── amounts in words ───────────── */

const ID_UNITS = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

function idWords(n: number): string {
  if (n < 12) return ID_UNITS[n];
  if (n < 20) return `${idWords(n - 10)} belas`;
  if (n < 100) return `${idWords(Math.floor(n / 10))} puluh ${idWords(n % 10)}`;
  if (n < 200) return `seratus ${idWords(n - 100)}`;
  if (n < 1000) return `${idWords(Math.floor(n / 100))} ratus ${idWords(n % 100)}`;
  if (n < 2000) return `seribu ${idWords(n - 1000)}`;
  if (n < 1e6) return `${idWords(Math.floor(n / 1000))} ribu ${idWords(n % 1000)}`;
  if (n < 1e9) return `${idWords(Math.floor(n / 1e6))} juta ${idWords(n % 1e6)}`;
  if (n < 1e12) return `${idWords(Math.floor(n / 1e9))} miliar ${idWords(n % 1e9)}`;
  return `${idWords(Math.floor(n / 1e12))} triliun ${idWords(n % 1e12)}`;
}

/** "Delapan miliar empat ratus juta rupiah" */
export function terbilang(amount: number) {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return "Nol rupiah";
  const w = `${idWords(n)} rupiah`.replace(/\s+/g, " ").trim();
  return w[0].toUpperCase() + w.slice(1);
}

const EN_SMALL = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enBelowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? EN_SMALL[r] : `${EN_TENS[Math.floor(r / 10)]}${r % 10 ? `-${EN_SMALL[r % 10]}` : ""}`;
  return [h ? `${EN_SMALL[h]} hundred` : "", rest].filter(Boolean).join(" ");
}

/** "Eight billion four hundred million rupiah" */
export function amountInEnglish(amount: number) {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Zero rupiah";
  const scales = ["", "thousand", "million", "billion", "trillion"];
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${enBelowThousand(chunk)}${scales[i] ? ` ${scales[i]}` : ""}`);
    n = Math.floor(n / 1000);
    i += 1;
  }
  const w = `${parts.join(" ")} rupiah`;
  return w[0].toUpperCase() + w.slice(1);
}

/** NPWP: 15 digits (legacy 99.999.999.9-999.999) or 16 digits (NIK-based, 2024+) */
export function npwpValid(v: string) {
  const d = v.replace(/\D/g, "");
  return d.length === 15 || d.length === 16;
}

export function formatNpwp(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length === 15) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12)}`;
  return d || v;
}

export const MILESTONE_TRIGGERS = {
  signing: { id: "Saat penandatanganan kontrak", en: "On contract signing" },
  delivery: { id: "Saat pengiriman / delivery", en: "On delivery" },
  acceptance: { id: "Saat serah terima (BAST)", en: "On acceptance (BAST)" },
  date: { id: "Pada tanggal", en: "On date" },
} as const;
