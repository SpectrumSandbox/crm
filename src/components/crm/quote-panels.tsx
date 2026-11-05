"use client";

/* Quote row + approval/expiry actions, shared by the deal record's Quotes card and the /quotes register. */
import { useMemo } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, FileText, Printer, ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import type { Quote, QuoteStatus } from "@/lib/types";
import { quoteStatusMeta } from "@/lib/meta";
import { cn, formatIDR } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { approvalNeeds, expiryLabel, isQuoteExpired, quoteTotals, settingsOf, type ApprovalNeeds, type QuoteTotals } from "./quote-math";
import { requestDealStage } from "./deal-close";

export interface QuoteView {
  quote: Quote;
  totals: QuoteTotals;
  needs: ApprovalNeeds;
  expired: boolean;
  status: QuoteStatus;
}

/** derived totals / approvals / expiry for a quote */
export function useQuoteView(quote: Quote | undefined): QuoteView | null {
  const products = useCrm((s) => s.products);
  const deals = useCrm((s) => s.deals);
  const companies = useCrm((s) => s.companies);
  const quoteSettings = useCrm((s) => s.quoteSettings);
  return useMemo(() => {
    if (!quote) return null;
    const settings = settingsOf(quoteSettings);
    const deal = deals.find((d) => d.id === quote.dealId);
    const totals = quoteTotals(quote.lineItems, { quote, settings, products, company: companies.find((c) => c.id === deal?.companyId) });
    const needs = approvalNeeds(quote, totals, settings);
    const expired = isQuoteExpired(quote);
    return { quote, totals, needs, expired, status: expired ? "expired" : quote.status };
  }, [quote, products, deals, companies, quoteSettings]);
}

/** what the current user can do with a quote, with the reason when they can't */
export function useQuoteActions(v: QuoteView | null) {
  const access = useAccess();
  const notify = useUi((s) => s.notify);
  const s = useCrm.getState;
  if (!v) return [];
  const q = v.quote;
  const isOwner = q.ownerId === access.userId;
  const canFinance = access.roles.includes("finance") || access.roles.includes("cfo");
  const canDirector = access.roles.includes("ceo") || access.executive;
  const run = (fn: () => string | null, ok: string, after?: () => void) => () => {
    const err = fn();
    if (err) notify(err);
    else {
      notify(ok);
      after?.();
    }
  };
  const actions: { key: string; label: string; run: () => void; disabled?: string }[] = [];
  if (v.expired) {
    if (!q.supersededById && q.status !== "signed") {
      actions.push({ key: "extend", label: "Extend 30 days", run: run(() => s().extendQuote(q.id, 30), `${q.number} extended by 30 days`) });
      actions.push({ key: "reissue", label: "Re-issue as new revision", run: () => {
        const id = s().reissueQuote(q.id);
        notify(id ? `Revision ${s().quotes.find((x) => x.id === id)?.number} drafted` : "Could not re-issue");
      } });
    }
    return actions;
  }
  if (q.status === "draft") actions.push({ key: "submit", label: v.needs.finance || v.needs.director ? "Submit for approval" : "Approve (no approval needed)", run: run(() => s().submitQuote(q.id), `${q.number} submitted`) });
  if (q.status === "pending_approval") {
    if (v.needs.finance && !v.needs.financeDone)
      actions.push({
        key: "finance",
        label: "Finance check (§4.7)",
        run: run(() => s().approveQuote(q.id, "finance"), `${q.number} checked by Finance`),
        disabled: !canFinance ? "Needs the CFO or the finance team" : isOwner ? "You own this quote — another person must check it" : undefined,
      });
    if (v.needs.director && !v.needs.directorDone)
      actions.push({
        key: "director",
        label: "Director approval",
        run: run(() => s().approveQuote(q.id, "director"), `${q.number} approved`),
        disabled: !canDirector ? "Needs the CEO or an Executive Committee member" : isOwner ? "You own this quote — another person must approve it" : undefined,
      });
    actions.push({ key: "draft", label: "Back to draft", run: run(() => s().quoteToDraft(q.id), `${q.number} back to draft`) });
  }
  if (q.status === "approved") {
    actions.push({ key: "send", label: "Mark sent to client", run: run(() => s().sendQuote(q.id), `${q.number} marked sent`) });
    actions.push({ key: "draft", label: "Back to draft", run: run(() => s().quoteToDraft(q.id), `${q.number} back to draft`) });
  }
  if (q.status === "sent") {
    actions.push({
      key: "sign",
      label: "Mark signed by client",
      run: () => {
        const err = s().signQuote(q.id);
        if (err) return notify(err);
        const st = useCrm.getState();
        const deal = st.deals.find((d) => d.id === q.dealId);
        const pipeline = st.pipelines.find((p) => p.id === deal?.pipelineId);
        const won = pipeline?.stages.find((x) => x.closed === "won");
        const stage = pipeline?.stages.find((x) => x.id === deal?.stageId);
        if (deal && won && !stage?.closed) notify(`${q.number} signed — mark the deal ${won.name}?`, { label: `Mark ${won.name.toLowerCase()}`, run: () => requestDealStage(deal.id, won.id) });
        else notify(`${q.number} signed`);
      },
    });
  }
  if (q.status !== "signed" && !q.supersededById) {
    actions.push({ key: "extend", label: "Extend 30 days", run: run(() => s().extendQuote(q.id, 30), `${q.number} extended by 30 days`) });
    if (q.status !== "draft")
      actions.push({ key: "reissue", label: "Re-issue as new revision", run: () => {
        const id = s().reissueQuote(q.id);
        notify(id ? `Revision ${s().quotes.find((x) => x.id === id)?.number} drafted — ${q.number} superseded` : "Could not re-issue");
      } });
  }
  return actions;
}

export function ApprovalSteps({ v, compact }: { v: QuoteView; compact?: boolean }) {
  const users = useCrm((s) => s.users);
  const name = (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? "—";
  const steps: { label: string; done: boolean; who?: string }[] = [];
  if (v.needs.finance) steps.push({ label: "Finance check", done: v.needs.financeDone, who: v.quote.financeCheckedById ? name(v.quote.financeCheckedById) : undefined });
  if (v.needs.director) steps.push({ label: "Director", done: v.needs.directorDone, who: v.quote.directorApprovedById ? name(v.quote.directorApprovedById) : undefined });
  if (!steps.length) return compact ? null : <span className="text-2xs text-sg-dim">No approval needed</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {steps.map((st) => (
        <span key={st.label} className={cn("inline-flex items-center gap-0.5 rounded-sm px-1 text-2xs font-semibold", st.done ? "bg-soft-green/15 text-soft-green" : "bg-sg-card-3 text-sg-dim")} title={st.done ? `${st.label} by ${st.who}` : `${st.label} pending`}>
          <ShieldCheck className="size-3" /> {st.label}
          {!compact && st.who ? ` · ${st.who.split(" ")[0]}` : ""}
        </span>
      ))}
    </span>
  );
}

export function QuoteRow({ quoteId }: { quoteId: string }) {
  const quote = useCrm((s) => s.quotes.find((q) => q.id === quoteId));
  const v = useQuoteView(quote);
  const actions = useQuoteActions(v);
  if (!v || !quote) return null;
  const meta = quoteStatusMeta[v.status];
  return (
    <div className={cn("rounded-md border bg-sg-bg/40 p-2.5", v.expired && !quote.supersededById ? "border-soft-red/40" : "border-sg-line")}>
      <div className="flex items-center gap-2">
        <Link href={`/quotes/${quote.id}`} className="flex items-center gap-1 text-2xs font-semibold text-sg-muted hover:text-sg-white hover:underline" title="Open the printable quote">
          <FileText className="size-3" /> {quote.number}
        </Link>
        {quote.supersededById && <span className="text-2xs text-sg-dim">superseded</span>}
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="ml-auto flex items-center gap-0.5 rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-sg-white" aria-label={`Quote ${quote.number} actions — status ${meta.label}`}>
              <Chip color={meta.color}>{meta.label}</Chip>
              <ChevronDown className="size-3 text-sg-dim" />
            </button>
          </MenuTrigger>
          <MenuContent align="end" className="w-64">
            <MenuLabel>{quote.number}</MenuLabel>
            <Link href={`/quotes/${quote.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-sg-text hover:bg-sg-card-3 hover:text-sg-white">
              <Printer className="size-3.5" /> Open / print
            </Link>
            {actions.length > 0 && <MenuSeparator />}
            {actions.map((a) => (
              <MenuItem key={a.key} onSelect={a.disabled ? undefined : a.run} className={a.disabled ? "cursor-not-allowed opacity-50" : undefined}>
                <span className="min-w-0">
                  <span className="block">{a.label}</span>
                  {a.disabled && <span className="block text-2xs text-sg-dim">{a.disabled}</span>}
                </span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>
      <div className="mt-1 truncate text-sm text-sg-white">{quote.title}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-sg-dim">
        <span className="sg-num font-semibold text-sg-text" title={`Harga jual ${formatIDR(v.totals.subtotal, "full")} · DPP ${formatIDR(v.totals.dpp, "full")} · PPN ${formatIDR(v.totals.vat, "full")}`}>
          {formatIDR(v.totals.total, "full")} {v.totals.pkp ? "incl. PPN" : ""}
        </span>
        <span className={cn("flex items-center gap-0.5", v.expired ? "font-semibold text-soft-red" : Date.parse(quote.expiresAt) - Date.now() < 7 * 86_400_000 && quote.status !== "signed" ? "text-soft-orange" : "")}>
          <CalendarClock className="size-3" /> {expiryLabel(quote)}
        </span>
      </div>
      {(quote.status === "pending_approval" || quote.status === "draft") && !v.expired ? (
        <div className="mt-1.5">
          <ApprovalSteps v={v} compact />
        </div>
      ) : null}
    </div>
  );
}
