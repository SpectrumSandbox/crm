"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Settings, ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { useCompanyMap, useUserMap } from "@/lib/selectors";
import type { Quote, QuoteSettings } from "@/lib/types";
import { quoteStatusMeta } from "@/lib/meta";
import { cn, formatDate, formatIDR, parseIDR } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Avatar, Chip, EmptyState } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/overlays";
import { approvalNeeds, expiryLabel, isQuoteExpired, npwpValid, quoteTotals, settingsOf } from "@/components/crm/quote-math";

type Filter = "all" | "mine" | "pending" | "approved" | "sent" | "expiring" | "expired" | "signed";

export default function QuotesPage() {
  const quotes = useCrm((s) => s.quotes);
  const deals = useCrm((s) => s.deals);
  const products = useCrm((s) => s.products);
  const companies = useCrm((s) => s.companies);
  const quoteSettings = useCrm((s) => s.quoteSettings);
  const expireQuotes = useCrm((s) => s.expireQuotes);
  const access = useAccess();
  const userMap = useUserMap();
  const companyMap = useCompanyMap();
  const [filter, setFilter] = useState<Filter>("all");
  const [showSettings, setShowSettings] = useState(false);
  const settings = settingsOf(quoteSettings);

  useEffect(() => {
    expireQuotes();
  }, [expireQuotes]);

  const rows = useMemo(() => {
    const now = Date.now();
    return quotes.map((q) => {
      const deal = deals.find((d) => d.id === q.dealId);
      const company = companyMap.get(deal?.companyId ?? "");
      const totals = quoteTotals(q.lineItems, { quote: q, settings, products, company });
      const needs = approvalNeeds(q, totals, settings);
      const expired = isQuoteExpired(q, now);
      const canFinance = access.roles.includes("finance") || access.roles.includes("cfo");
      const canDirector = access.roles.includes("ceo") || access.executive;
      const forMe = q.status === "pending_approval" && !expired && q.ownerId !== access.userId && ((needs.finance && !needs.financeDone && canFinance) || (needs.director && !needs.directorDone && canDirector));
      const expiring = !expired && q.status !== "signed" && Date.parse(q.expiresAt) - now < 7 * 86_400_000;
      return { q, deal, company, totals, needs, expired, forMe, expiring };
    });
  }, [quotes, deals, companyMap, settings, products, access]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, mine: 0, pending: 0, approved: 0, sent: 0, expiring: 0, expired: 0, signed: 0 };
    rows.forEach((r) => {
      if (r.forMe) c.mine += 1;
      if (r.expired) c.expired += 1;
      else if (r.q.status === "pending_approval") c.pending += 1;
      else if (r.q.status === "approved") c.approved += 1;
      else if (r.q.status === "sent") c.sent += 1;
      if (r.q.status === "signed") c.signed += 1;
      if (r.expiring) c.expiring += 1;
    });
    return c;
  }, [rows]);

  const visible = rows
    .filter((r) => {
      switch (filter) {
        case "mine":
          return r.forMe;
        case "pending":
          return !r.expired && r.q.status === "pending_approval";
        case "approved":
          return !r.expired && r.q.status === "approved";
        case "sent":
          return !r.expired && r.q.status === "sent";
        case "expiring":
          return r.expiring;
        case "expired":
          return r.expired;
        case "signed":
          return r.q.status === "signed";
        default:
          return true;
      }
    })
    .sort((a, b) => b.q.createdAt.localeCompare(a.q.createdAt));

  const canEditSettings = access.certify || access.admin;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Quotes" meta={<span className="text-xs text-sg-muted">Quotations are checked by Finance before they are sent (§4.7)</span>}>
        <Button variant="outline" size="md" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
          <Settings /> Rules & supplier
        </Button>
      </PageHeader>
      <Tabs
        value={filter}
        onChange={setFilter}
        className="px-4"
        items={[
          { value: "all", label: "All", count: counts.all },
          { value: "mine", label: "Needs my approval", count: counts.mine },
          { value: "pending", label: "Awaiting approval", count: counts.pending },
          { value: "approved", label: "Approved to send", count: counts.approved },
          { value: "sent", label: "Sent", count: counts.sent },
          { value: "expiring", label: "Expiring ≤ 7d", count: counts.expiring },
          { value: "expired", label: "Expired", count: counts.expired },
          { value: "signed", label: "Signed", count: counts.signed },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {showSettings && <SettingsCard settings={settings} canEdit={canEditSettings} />}
        {visible.length ? (
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 z-10 bg-sg-bg">
              <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim">
                <th className="px-4 py-2 font-semibold">Quote</th>
                <th className="px-4 py-2 font-semibold">Deal · company</th>
                <th className="px-4 py-2 font-semibold">Owner</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Approvals</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
                <th className="px-4 py-2 font-semibold">Validity</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ q, deal, company, totals, needs, expired, forMe }) => {
                const status = expired ? "expired" : q.status;
                return (
                  <tr key={q.id} className={cn("border-b border-sg-line hover:bg-sg-card/70", forMe && "bg-soft-yellow/5")}>
                    <td className="px-4 py-2">
                      <Link href={`/quotes/${q.id}`} className="flex items-center gap-1.5 font-semibold text-sg-white hover:underline">
                        <FileText className="size-3.5 text-sg-dim" /> {q.number}
                      </Link>
                      <div className="truncate text-2xs text-sg-dim">{q.title}</div>
                    </td>
                    <td className="px-4 py-2">
                      {deal ? (
                        <Link href={`/deals/${deal.id}`} className="text-sg-text hover:text-sg-white hover:underline">
                          {deal.name}
                        </Link>
                      ) : (
                        <span className="text-sg-dim">Deal deleted</span>
                      )}
                      <div className="text-2xs text-sg-dim">{company?.name ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 text-sg-muted">
                        <Avatar user={userMap.get(q.ownerId)} size="xs" /> {userMap.get(q.ownerId)?.name}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Chip color={quoteStatusMeta[status].color}>{quoteStatusMeta[status].label}</Chip>
                      {q.supersededById && <div className="text-2xs text-sg-dim">superseded</div>}
                    </td>
                    <td className="px-4 py-2">
                      <Approvals q={q} needs={needs} />
                      {forMe && <div className="mt-0.5 text-2xs font-semibold text-soft-yellow">Waiting for you</div>}
                    </td>
                    <td className="sg-num px-4 py-2 text-right font-semibold text-sg-white">
                      {formatIDR(totals.total, "full")}
                      <div className="text-2xs font-normal text-sg-dim">{totals.pkp ? `PPN ${formatIDR(totals.vat)}` : "no PPN"}</div>
                    </td>
                    <td className={cn("px-4 py-2 text-xs", expired ? "font-semibold text-soft-red" : "text-sg-muted")}>
                      {expiryLabel(q)}
                      <div className="text-2xs text-sg-dim">until {formatDate(q.expiresAt)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-8">
            <EmptyState title="No quotes here" icon={FileText}>
              Quotes are drafted from a deal&apos;s line items — open a deal and use “+ Quote”.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function Approvals({ q, needs }: { q: Quote; needs: ReturnType<typeof approvalNeeds> }) {
  const userMap = useUserMap();
  const items: { label: string; done: boolean; by?: string }[] = [];
  if (needs.finance) items.push({ label: "Finance", done: !!q.financeCheckedAt, by: userMap.get(q.financeCheckedById ?? "")?.name });
  if (needs.director) items.push({ label: "Director", done: !!q.directorApprovedAt, by: userMap.get(q.directorApprovedById ?? "")?.name });
  if (!items.length) return <span className="text-2xs text-sg-dim">none needed</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i.label} title={i.done ? `${i.label} — ${i.by}` : `${i.label} pending`} className={cn("inline-flex items-center gap-0.5 rounded-sm px-1 text-2xs font-semibold", i.done ? "bg-soft-green/15 text-soft-green" : "bg-sg-card-3 text-sg-dim")}>
          <ShieldCheck className="size-3" /> {i.label}
          {i.done && i.by ? ` · ${i.by.split(" ")[0]}` : ""}
        </span>
      ))}
    </span>
  );
}

function SettingsCard({ settings, canEdit }: { settings: QuoteSettings; canEdit: boolean }) {
  const updateQuoteSettings = useCrm((s) => s.updateQuoteSettings);
  const users = useCrm((s) => s.users);
  const notify = useUi((s) => s.notify);
  const [draft, setDraft] = useState(settings);
  const [total, setTotal] = useState(String(settings.directorTotalIdr));
  const parsedTotal = parseIDR(total);
  const npwpOk = !draft.supplierNpwp || npwpValid(draft.supplierNpwp);
  const valid = parsedTotal !== null && parsedTotal >= 0 && draft.directorDiscountPct >= 0 && draft.directorDiscountPct <= 100 && draft.defaultValidityDays >= 1 && npwpOk;
  const set = <K extends keyof QuoteSettings>(k: K, v: QuoteSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <section className="m-4 rounded-xl border border-sg-line bg-sg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-extrabold text-sg-white">Quote rules & supplier identity</h2>
          <p className="text-2xs text-sg-dim">
            {canEdit ? "Finance and the CEO/CFO can change these." : "Read-only — only Finance or the CEO/CFO can change these."}
            {settings.updatedAt ? ` Last changed ${formatDate(settings.updatedAt, "datetime")} by ${users.find((u) => u.id === settings.updatedById)?.name ?? "—"}.` : ""}
          </p>
        </div>
        {canEdit && (
          <Button
            variant="primary"
            size="sm"
            disabled={!valid}
            onClick={() => {
              updateQuoteSettings({ ...draft, supplierNpwp: draft.supplierNpwp.replace(/\D/g, ""), directorTotalIdr: parsedTotal ?? draft.directorTotalIdr });
              notify("Quote rules saved");
            }}
          >
            Save
          </Button>
        )}
      </div>
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex items-center gap-2 text-sm text-sg-text">
          <input type="checkbox" checked={draft.financeCheckRequired} onChange={(e) => set("financeCheckRequired", e.target.checked)} className="size-4 accent-white" /> Finance check before sending (§4.7)
        </label>
        <Field label="Director approval: line discount ≥ %">
          <Input inputMode="decimal" value={String(draft.directorDiscountPct)} onChange={(e) => set("directorDiscountPct", Number(e.target.value.replace(",", ".")) || 0)} />
        </Field>
        <Field label="Director approval: total excl. PPN ≥" hint={parsedTotal !== null ? formatIDR(parsedTotal, "full") : "e.g. 5 M or 5.000.000.000"}>
          <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={parsedTotal === null} />
        </Field>
        <Field label="Default validity (days)">
          <Input inputMode="numeric" value={String(draft.defaultValidityDays)} onChange={(e) => set("defaultValidityDays", Math.max(0, Math.round(Number(e.target.value) || 0)))} />
        </Field>
        <Field label="Supplier legal name">
          <Input value={draft.supplierLegalName} onChange={(e) => set("supplierLegalName", e.target.value)} />
        </Field>
        <Field label="Supplier NPWP" hint={npwpOk ? "15 or 16 digits" : "NPWP must have 15 or 16 digits"}>
          <Input value={draft.supplierNpwp} onChange={(e) => set("supplierNpwp", e.target.value)} aria-invalid={!npwpOk} className={npwpOk ? undefined : "border-soft-red/60"} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-sg-text">
          <input type="checkbox" checked={draft.supplierPkp} onChange={(e) => set("supplierPkp", e.target.checked)} className="size-4 accent-white" /> Supplier is PKP (charges PPN)
        </label>
        <label className="flex items-center gap-2 text-sm text-sg-text">
          <input type="checkbox" checked={draft.umkmFinalTax} onChange={(e) => set("umkmFinalTax", e.target.checked)} className="size-4 accent-white" /> UMKM final tax 0.5% (PP 55/2022, §5.4)
        </label>
        <Field label="Supplier address" className="sm:col-span-2">
          <Textarea value={draft.supplierAddress} onChange={(e) => set("supplierAddress", e.target.value)} />
        </Field>
        <Field label="Payment account (bank, account no., name)" className="sm:col-span-2">
          <Textarea value={draft.supplierBank} onChange={(e) => set("supplierBank", e.target.value)} />
        </Field>
      </fieldset>
    </section>
  );
}
