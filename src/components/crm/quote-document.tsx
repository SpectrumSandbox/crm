"use client";

/*
 * Printable quotation (/quotes/[id]) — a light, paper-like layout over the app shell, like the PRC packet.
 * Bahasa Indonesia / English / bilingual; supplier + customer identity with NPWP; line items in full rupiah;
 * Harga Jual → DPP nilai lain 11/12 → PPN 12 % (PMK 131/2024); amount in words; termin; withholding note and
 * expected cash (Policy §5.4); validity; signature blocks. Commercial terms are edited above the paper while the
 * quote is a draft; the approval steps (§4.7) and sending happen from the toolbar.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm, useUi } from "@/lib/store";
import type { PaymentMilestone, Quote } from "@/lib/types";
import { quoteStatusMeta } from "@/lib/meta";
import { formatDate, formatIDR, fromDateInput, isDateInput, toDateInput, uid } from "@/lib/utils";
import { amountInEnglish, FAKTUR_CODES, formatNpwp, lineTotal, MILESTONE_TRIGGERS, settingsOf, terbilang } from "./quote-math";
import { useQuoteActions, useQuoteView } from "./quote-panels";

type Lang = "id" | "en" | "both";

const L = {
  title: { id: "Penawaran Harga", en: "Quotation" },
  number: { id: "Nomor", en: "Number" },
  date: { id: "Tanggal", en: "Date" },
  valid: { id: "Berlaku hingga", en: "Valid until" },
  to: { id: "Kepada", en: "To" },
  attn: { id: "U.p.", en: "Attn." },
  from: { id: "Dari", en: "From" },
  subject: { id: "Perihal", en: "Subject" },
  no: { id: "No", en: "No" },
  desc: { id: "Uraian", en: "Description" },
  qty: { id: "Jml", en: "Qty" },
  unit: { id: "Harga satuan", en: "Unit price" },
  disc: { id: "Diskon", en: "Disc." },
  amount: { id: "Jumlah", en: "Amount" },
  hargaJual: { id: "Harga jual", en: "Selling price" },
  dpp: { id: "DPP nilai lain (11/12)", en: "Tax base — DPP nilai lain (11/12)" },
  ppn: { id: "PPN", en: "VAT (PPN)" },
  total: { id: "Total", en: "Total" },
  words: { id: "Terbilang", en: "In words" },
  terms: { id: "Termin pembayaran", en: "Payment terms" },
  withholding: { id: "Pemotongan pajak oleh pemberi kerja", en: "Client tax withholding" },
  expected: { id: "Perkiraan penerimaan bersih", en: "Expected net receipt" },
  notes: { id: "Catatan", en: "Notes" },
  bank: { id: "Rekening pembayaran", en: "Payment account" },
  supplierSig: { id: "Hormat kami", en: "Yours faithfully" },
  clientSig: { id: "Disetujui oleh", en: "Accepted by" },
  nameTitle: { id: "Nama / jabatan / tanggal", en: "Name / title / date" },
  faktur: { id: "Kode transaksi faktur", en: "Faktur transaction code" },
  noVat: { id: "Pemasok bukan PKP — tidak dipungut PPN", en: "Supplier is not VAT-registered — no VAT charged" },
  prevails: { id: "Dokumen ini dibuat dalam Bahasa Indonesia dan Bahasa Inggris; apabila terdapat perbedaan, versi Bahasa Indonesia yang berlaku.", en: "Issued in Bahasa Indonesia and English; if the two differ, the Bahasa Indonesia version prevails." },
  draftMark: { id: "DRAF — belum diperiksa Keuangan, belum boleh dikirim", en: "DRAFT — not yet checked by Finance, not to be sent" },
  expiredMark: { id: "KEDALUWARSA", en: "EXPIRED" },
} as const;

function tr(key: keyof typeof L, lang: Lang) {
  const v = L[key];
  return lang === "both" ? `${v.id} / ${v.en}` : v[lang];
}

const CSS = `
#sgq-print-root { position: fixed; inset: 0; z-index: 80; overflow: auto; background: #e9e9e6; color: #111; font-family: Montserrat, "Helvetica Neue", Arial, sans-serif; }
#sgq-print-root .toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ccc; font-size: 12px; }
#sgq-print-root .toolbar .sp { flex: 1; }
#sgq-print-root button, #sgq-print-root .btn { font: inherit; font-size: 12px; font-weight: 600; color: #111; background: #fff; border: 1px solid #999; border-radius: 3px; padding: 5px 10px; cursor: pointer; text-decoration: none; }
#sgq-print-root button.primary { background: #111; color: #fff; border-color: #111; }
#sgq-print-root button:disabled { opacity: .45; cursor: not-allowed; }
#sgq-print-root button.on { background: #111; color: #fff; }
#sgq-print-root .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; background: #eee; }
#sgq-print-root .panel { max-width: 860px; margin: 16px auto 0; background: #fff; border: 1px solid #ccc; border-radius: 4px; padding: 14px 18px; font-size: 12px; }
#sgq-print-root .panel h3 { font-size: 12px; font-weight: 800; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; }
#sgq-print-root .panel input, #sgq-print-root .panel select, #sgq-print-root .panel textarea { font: inherit; font-size: 12px; border: 1px solid #aaa; border-radius: 3px; padding: 3px 6px; background: #fff; color: #111; }
#sgq-print-root .panel .row { display: grid; grid-template-columns: 1fr 70px 190px 130px 28px; gap: 6px; align-items: center; margin-bottom: 4px; }
#sgq-print-root .panel .err { color: #b00020; font-weight: 600; }
#sgq-print-root .panel .ok { color: #1b6e2a; font-weight: 600; }
#sgq-print-root .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
#sgq-print-root .paper { position: relative; background: #fff; max-width: 860px; margin: 16px auto 48px; padding: 36px 40px; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
#sgq-print-root .mark { position: absolute; top: 14px; right: 40px; font-size: 10px; font-weight: 800; color: #b00020; border: 2px solid #b00020; padding: 2px 8px; letter-spacing: .06em; }
#sgq-print-root .lh { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
#sgq-print-root .brand { font-size: 22px; font-weight: 900; letter-spacing: -.01em; }
#sgq-print-root .rule { height: 3px; background: linear-gradient(90deg,#e6007e,#0072ce,#00b5e2,#43b02a,#ffd100,#ff8200,#e4002b); margin-top: 6px; width: 160px; }
#sgq-print-root h1 { font-size: 18px; font-weight: 800; margin: 0 0 4px; text-transform: uppercase; letter-spacing: .03em; }
#sgq-print-root h2 { font-size: 12px; font-weight: 800; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #111; text-transform: uppercase; letter-spacing: .04em; }
#sgq-print-root p, #sgq-print-root li { font-size: 11px; line-height: 1.45; margin: 0 0 4px; }
#sgq-print-root .meta { font-size: 10.5px; color: #444; }
#sgq-print-root table.doc { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
#sgq-print-root table.doc th, #sgq-print-root table.doc td { border: 1px solid #888; padding: 4px 6px; font-size: 10.5px; text-align: left; vertical-align: top; }
#sgq-print-root table.doc th { background: #f0f0ee; font-weight: 700; }
#sgq-print-root table.kv td { border: 0; padding: 1px 8px 1px 0; font-size: 10.5px; vertical-align: top; }
#sgq-print-root .num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
#sgq-print-root .muted { color: #555; }
#sgq-print-root .tot td { font-weight: 700; }
#sgq-print-root .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px; }
#sgq-print-root .sig { border-bottom: 1px solid #111; height: 56px; }
@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background: #fff !important; }
  body *:not(:has(#sgq-print-root)):not(#sgq-print-root):not(#sgq-print-root *) { display: none !important; }
  body *:has(#sgq-print-root) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; transform: none !important; background: #fff !important; }
  #sgq-print-root { position: static; overflow: visible; background: #fff; }
  #sgq-print-root .toolbar, #sgq-print-root .panel { display: none; }
  #sgq-print-root .paper { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  #sgq-print-root table, #sgq-print-root tr, #sgq-print-root .sigs { break-inside: avoid; }
}
`;

export function QuoteDocument({ id }: { id: string }) {
  const router = useRouter();
  const quote = useCrm((s) => s.quotes.find((q) => q.id === id));
  const deals = useCrm((s) => s.deals);
  const companies = useCrm((s) => s.companies);
  const contacts = useCrm((s) => s.contacts);
  const users = useCrm((s) => s.users);
  const products = useCrm((s) => s.products);
  const quoteSettings = useCrm((s) => s.quoteSettings);
  const updateQuote = useCrm((s) => s.updateQuote);
  const expireQuotes = useCrm((s) => s.expireQuotes);
  const notify = useUi((s) => s.notify);
  const v = useQuoteView(quote);
  const actions = useQuoteActions(v);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    expireQuotes();
  }, [expireQuotes]);
  const deal = deals.find((d) => d.id === quote?.dealId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === "Escape") router.push(deal ? `/deals/${encodeURIComponent(deal.id)}` : "/quotes");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, deal]);

  const settings = settingsOf(quoteSettings);
  if (!mounted) return null;

  if (!quote || !v) {
    return (
      <div id="sgq-print-root">
        <style>{CSS}</style>
        <div className="paper">
          <h1>Quote not found</h1>
          <p>No quote with id “{id}”.</p>
          <p>
            <Link href="/quotes">All quotes</Link>
          </p>
        </div>
      </div>
    );
  }

  const lang: Lang = quote.language ?? "id";
  const company = companies.find((c) => c.id === deal?.companyId);
  const attn = contacts.find((c) => c.id === deal?.contactIds[0]);
  const owner = users.find((u) => u.id === quote.ownerId);
  const t = v.totals;
  const schedule = quote.paymentSchedule?.length ? quote.paymentSchedule : [{ id: "pm-default", label: lang === "en" ? "Full payment" : "Pelunasan", pct: 100, trigger: "acceptance" as const, dueAt: null }];
  const approved = v.needs.complete && ["approved", "sent", "signed"].includes(quote.status);
  const supplierName = settings.supplierLegalName || "Spectrum Group";
  const supplierNpwp = settings.supplierNpwp;
  const supplierAddress = settings.supplierAddress;
  const supplierBank = settings.supplierBank;
  const trig = (m: PaymentMilestone) => {
    const x = MILESTONE_TRIGGERS[m.trigger];
    const base = lang === "both" ? `${x.id} / ${x.en}` : x[lang];
    return m.trigger === "date" && m.dueAt ? `${base} ${formatDate(m.dueAt)}` : base;
  };

  return (
    <div id="sgq-print-root">
      <style>{CSS}</style>
      <div className="toolbar">
        <Link className="btn" href={deal ? `/deals/${encodeURIComponent(deal.id)}` : "/quotes"}>
          ← {deal ? "Deal" : "Quotes"}
        </Link>
        <Link className="btn" href="/quotes">
          All quotes
        </Link>
        <span className="pill">{quote.number}</span>
        <span className="pill">{quoteStatusMeta[v.status].label}</span>
        <span className="muted">Esc to close</span>
        <span className="sp" />
        {(["id", "en", "both"] as const).map((l) => (
          <button key={l} type="button" className={lang === l ? "on" : undefined} aria-pressed={lang === l} onClick={() => updateQuote(quote.id, { language: l })}>
            {l === "id" ? "Bahasa Indonesia" : l === "en" ? "English" : "Bilingual"}
          </button>
        ))}
        {actions.map((a) => (
          <button key={a.key} type="button" onClick={a.run} disabled={!!a.disabled} title={a.disabled}>
            {a.label}
          </button>
        ))}
        <button type="button" className="primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <QuotePanel quote={quote} approvedOk={approved} reasons={v.needs.reasons} expected={t.expectedCash} withholdingLabel={t.withholdingLabel} onError={notify} />

      <div className="paper">
        {v.expired ? <div className="mark">{tr("expiredMark", lang)}</div> : !approved ? <div className="mark">{tr("draftMark", lang)}</div> : null}
        <div className="lh">
          <div>
            <div className="brand">Spectrum Group</div>
            <div className="rule" />
          </div>
          <div style={{ textAlign: "right" }} className="meta">
            <div style={{ fontWeight: 700, color: "#111" }}>{supplierName}</div>
            {supplierAddress && <div style={{ whiteSpace: "pre-line" }}>{supplierAddress}</div>}
            <div>NPWP {supplierNpwp ? formatNpwp(supplierNpwp) : "— (set in Quotes › Settings)"}</div>
            <div>{t.pkp ? "PKP" : "Non-PKP"}</div>
          </div>
        </div>

        <h1>{tr("title", lang)}</h1>
        <div className="grid2">
          <table className="kv">
            <tbody>
              <tr>
                <td className="muted">{tr("number", lang)}</td>
                <td>
                  <b>{quote.number}</b>
                </td>
              </tr>
              <tr>
                <td className="muted">{tr("date", lang)}</td>
                <td>{formatDate(quote.createdAt, "long")}</td>
              </tr>
              <tr>
                <td className="muted">{tr("valid", lang)}</td>
                <td>{formatDate(quote.expiresAt, "long")}</td>
              </tr>
              <tr>
                <td className="muted">{tr("subject", lang)}</td>
                <td>{quote.title}</td>
              </tr>
            </tbody>
          </table>
          <table className="kv">
            <tbody>
              <tr>
                <td className="muted">{tr("to", lang)}</td>
                <td>
                  <b>{company?.legalName || company?.name || "—"}</b>
                  {company?.billingAddress ? <div style={{ whiteSpace: "pre-line" }}>{company.billingAddress}</div> : company ? <div>{company.city}, {company.country}</div> : null}
                  <div>NPWP {company?.npwp ? formatNpwp(company.npwp) : "—"}</div>
                </td>
              </tr>
              {attn && (
                <tr>
                  <td className="muted">{tr("attn", lang)}</td>
                  <td>
                    {attn.firstName} {attn.lastName}
                    {attn.jobTitle ? `, ${attn.jobTitle}` : ""}
                  </td>
                </tr>
              )}
              <tr>
                <td className="muted">{tr("from", lang)}</td>
                <td>
                  {owner?.name}
                  {owner?.email ? ` · ${owner.email}` : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <table className="doc" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>{tr("no", lang)}</th>
              <th>{tr("desc", lang)}</th>
              <th className="num">{tr("qty", lang)}</th>
              <th className="num">{tr("unit", lang)}</th>
              <th className="num">{tr("disc", lang)}</th>
              <th className="num">{tr("amount", lang)}</th>
            </tr>
          </thead>
          <tbody>
            {quote.lineItems.map((l, i) => {
              const p = products.find((x) => x.id === l.productId);
              return (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>
                    <b>{p?.name ?? l.productId}</b>
                    <div className="muted">
                      {p?.sku}
                      {p?.billing && p.billing !== "one_time" ? ` · ${p.billing === "monthly" ? (lang === "en" ? "per month" : "per bulan") : lang === "en" ? "per year" : "per tahun"}` : ""}
                    </div>
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatIDR(l.unitPrice, "full")}</td>
                  <td className="num">{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                  <td className="num">{formatIDR(lineTotal(l), "full")}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={5} className="num">
                {tr("hargaJual", lang)}
              </td>
              <td className="num">{formatIDR(t.subtotal, "full")}</td>
            </tr>
            {t.pkp ? (
              <>
                <tr>
                  <td colSpan={5} className="num muted">
                    {tr("dpp", lang)}
                  </td>
                  <td className="num muted">{formatIDR(t.dpp, "full")}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="num">
                    {tr("ppn", lang)} {t.vatRate}% × DPP
                  </td>
                  <td className="num">{formatIDR(t.vat, "full")}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td colSpan={6} className="muted">
                  {tr("noVat", lang)}
                </td>
              </tr>
            )}
            <tr className="tot">
              <td colSpan={5} className="num">
                {tr("total", lang)}
              </td>
              <td className="num">{formatIDR(t.total, "full")}</td>
            </tr>
          </tbody>
        </table>
        <p>
          <b>{tr("words", lang)}:</b> <i>{lang === "en" ? amountInEnglish(t.total) : lang === "both" ? `${terbilang(t.total)} / ${amountInEnglish(t.total)}` : terbilang(t.total)}</i>
        </p>
        {t.pkp && (
          <p className="meta">
            {tr("faktur", lang)}: {t.fakturCode} · PMK 131/2024
          </p>
        )}

        <h2>{tr("terms", lang)}</h2>
        <table className="doc">
          <tbody>
            {schedule.map((m, i) => (
              <tr key={m.id}>
                <td style={{ width: 28 }}>{i + 1}</td>
                <td>{m.label}</td>
                <td>{trig(m)}</td>
                <td className="num">{m.pct}%</td>
                <td className="num">{formatIDR(Math.round((t.total * m.pct) / 100), "full")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          {tr("withholding", lang)}: {t.withholdingLabel} ≈ {formatIDR(t.withholding, "full")} · {tr("expected", lang)} {formatIDR(t.expectedCash, "full")}.
        </p>
        {supplierBank && (
          <p>
            <b>{tr("bank", lang)}:</b> <span style={{ whiteSpace: "pre-line" }}>{supplierBank}</span>
          </p>
        )}
        {quote.terms && (
          <>
            <h2>{tr("notes", lang)}</h2>
            <p style={{ whiteSpace: "pre-line" }}>{quote.terms}</p>
          </>
        )}

        <div className="sigs">
          <div>
            <p>{tr("supplierSig", lang)},</p>
            <p>
              <b>{supplierName}</b>
            </p>
            <div className="sig" />
            <p className="meta">{tr("nameTitle", lang)}</p>
          </div>
          <div>
            <p>{tr("clientSig", lang)},</p>
            <p>
              <b>{company?.legalName || company?.name || "—"}</b>
            </p>
            <div className="sig" />
            <p className="meta">{tr("nameTitle", lang)}</p>
          </div>
        </div>
        {lang === "both" && <p className="meta" style={{ marginTop: 18 }}>{L.prevails.id} {L.prevails.en}</p>}
      </div>
    </div>
  );
}

/** commercial-terms editor shown above the paper (hidden in print) */
function QuotePanel({ quote, approvedOk, reasons, expected, withholdingLabel, onError }: { quote: Quote; approvedOk: boolean; reasons: string[]; expected: number; withholdingLabel: string; onError: (m: string) => void }) {
  const updateQuote = useCrm((s) => s.updateQuote);
  const users = useCrm((s) => s.users);
  const editable = quote.status === "draft";
  const [rows, setRows] = useState<PaymentMilestone[]>(() => quote.paymentSchedule?.length ? quote.paymentSchedule : [{ id: uid("pm"), label: "Pelunasan / Full payment", pct: 100, trigger: "acceptance", dueAt: null }]);
  const [terms, setTerms] = useState(quote.terms ?? "");
  const [dirty, setDirty] = useState(false);
  const sum = rows.reduce((a, m) => a + (Number.isFinite(m.pct) ? m.pct : 0), 0);
  const name = (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? "—";
  const setRow = (i: number, patch: Partial<PaymentMilestone>) => {
    setRows((r) => r.map((m, j) => (j === i ? { ...m, ...patch } : m)));
    setDirty(true);
  };
  const save = () => {
    const err = updateQuote(quote.id, { paymentSchedule: rows, terms: terms.trim() || undefined });
    if (err) onError(err);
    else {
      onError("Quote terms saved");
      setDirty(false);
    }
  };
  return (
    <div className="panel">
      <div className="grid2">
        <div>
          <h3>Approval · §4.7</h3>
          {reasons.length ? (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p>No approval needed under the current rules.</p>
          )}
          <p>
            Finance check: {quote.financeCheckedAt ? <span className="ok">{name(quote.financeCheckedById)} · {formatDate(quote.financeCheckedAt, "datetime")}</span> : "pending"}
            <br />
            Director approval: {quote.directorApprovedAt ? <span className="ok">{name(quote.directorApprovedById)} · {formatDate(quote.directorApprovedAt, "datetime")}</span> : "pending / not needed"}
          </p>
          {!approvedOk && <p className="err">Not approved — the document prints with a DRAFT mark and cannot be marked sent.</p>}
          <p className="muted">
            {withholdingLabel}. Expected cash {formatIDR(expected, "full")}.
          </p>
          <label>
            Faktur code{" "}
            <select value={quote.fakturCode ?? "04"} onChange={(e) => updateQuote(quote.id, { fakturCode: e.target.value })} disabled={quote.status === "signed"}>
              {Object.entries(FAKTUR_CODES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">Suggested from the customer&apos;s entity type — Finance confirms on the faktur.</p>
        </div>
        <div>
          <h3>Termin {editable ? "" : "(locked — back to draft or re-issue to change)"}</h3>
          {rows.map((m, i) => (
            <div key={m.id} className="row">
              <input value={m.label} disabled={!editable} onChange={(e) => setRow(i, { label: e.target.value })} aria-label={`Termin ${i + 1} label`} />
              <input value={Number.isFinite(m.pct) ? String(m.pct) : ""} disabled={!editable} inputMode="decimal" onChange={(e) => setRow(i, { pct: Number(e.target.value.replace(",", ".")) })} aria-label={`Termin ${i + 1} percent`} />
              <select value={m.trigger} disabled={!editable} onChange={(e) => setRow(i, { trigger: e.target.value as PaymentMilestone["trigger"] })} aria-label={`Termin ${i + 1} trigger`}>
                {(Object.keys(MILESTONE_TRIGGERS) as PaymentMilestone["trigger"][]).map((k) => (
                  <option key={k} value={k}>
                    {MILESTONE_TRIGGERS[k].en}
                  </option>
                ))}
              </select>
              <input type="date" value={toDateInput(m.dueAt ?? null)} disabled={!editable || m.trigger !== "date"} onChange={(e) => setRow(i, { dueAt: isDateInput(e.target.value) ? fromDateInput(e.target.value) : null })} aria-label={`Termin ${i + 1} date`} />
              <button type="button" disabled={!editable || rows.length === 1} onClick={() => { setRows((r) => r.filter((_, j) => j !== i)); setDirty(true); }} aria-label={`Remove termin ${i + 1}`}>
                ×
              </button>
            </div>
          ))}
          <p className={Math.abs(sum - 100) > 0.001 ? "err" : "ok"}>Total {Math.round(sum * 100) / 100}%{Math.abs(sum - 100) > 0.001 ? " — must be 100%" : ""}</p>
          {editable && (
            <>
              <button type="button" onClick={() => { setRows((r) => [...r, { id: uid("pm"), label: `Termin ${r.length + 1}`, pct: Math.max(0, 100 - sum), trigger: "delivery", dueAt: null }]); setDirty(true); }}>
                + Termin
              </button>{" "}
              <button type="button" onClick={() => { setRows([{ id: uid("pm"), label: "Uang muka / Down payment", pct: 40, trigger: "signing", dueAt: null }, { id: uid("pm"), label: "Pengiriman / Delivery", pct: 40, trigger: "delivery", dueAt: null }, { id: uid("pm"), label: "Serah terima / Acceptance", pct: 20, trigger: "acceptance", dueAt: null }]); setDirty(true); }}>
                40 / 40 / 20
              </button>
            </>
          )}
          <h3 style={{ marginTop: 10 }}>Notes on the quote</h3>
          <textarea rows={3} style={{ width: "100%" }} value={terms} disabled={!editable} onChange={(e) => { setTerms(e.target.value); setDirty(true); }} placeholder="Scope assumptions, delivery lead time, warranty…" />
          {editable && (
            <p>
              <button type="button" className="primary" disabled={!dirty} onClick={save}>
                Save terms
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
