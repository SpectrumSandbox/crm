"use client";

/* "Live check" card under the §5.1 rate table and the §16 worked examples: printed figure vs engine figure. */
import { useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, CircleCheck, CircleX, Info } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";
import { checkStatus, LIVE_CHECKS, type CheckItem, type CheckStatus, type ExampleCheck } from "./examples";

/** Policy-style figures ("Rp38,345,806", "20.060%") so they read side by side with the printed text. */
export function fmtFigure(v: number | string | null, fmt: CheckItem["fmt"], decimals?: number) {
  if (v == null) return "—";
  if (fmt === "text" || typeof v === "string") return String(v);
  if (fmt === "rp") return `${v < 0 ? "−" : ""}Rp${formatNumber(Math.abs(Math.round(v)))}`;
  if (fmt === "pct") return `${v.toFixed(decimals ?? 3)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function StatusMark({ status, diff }: { status: CheckStatus; diff?: number }) {
  if (status === "match")
    return (
      <span className="inline-flex items-center gap-1 text-soft-green" title="Engine matches the printed figure">
        <CircleCheck className="size-3.5" aria-label="Matches" />
      </span>
    );
  if (status === "rounding")
    return (
      <Chip color="yellow" title="Differs by a rounding effect explained below">
        Rp{diff ?? 1} rounding
      </Chip>
    );
  if (status === "differs")
    return (
      <span className="inline-flex items-center gap-1 text-soft-red" title="Engine differs from the printed figure">
        <CircleX className="size-3.5" aria-label="Differs" />
      </span>
    );
  return <span className="text-2xs text-sg-dim">—</span>;
}

const diffOf = (c: CheckItem) => (typeof c.printed === "number" && typeof c.engine === "number" ? Math.round(Math.abs(c.printed - c.engine)) : undefined);

function summary(check: ExampleCheck) {
  const all = [...check.items, ...(check.matrix?.rows.flatMap((r) => Object.values(r.cells)) ?? [])].filter((c) => c.printed != null);
  const statuses = all.map(checkStatus);
  return { total: all.length, match: statuses.filter((s) => s === "match").length, rounding: statuses.filter((s) => s === "rounding").length, differs: statuses.filter((s) => s === "differs").length };
}

export function LiveCheck({ subId }: { subId: string }) {
  const fn = LIVE_CHECKS[subId];
  const check = useMemo(() => (fn ? fn() : null), [fn]);
  const [open, setOpen] = useState(true);
  if (!check) return null;
  const s = summary(check);
  return (
    <section aria-label={`${check.title} — live engine check`} className="my-4 rounded-xl border border-soft-cyan/25 bg-soft-cyan/[0.04] print:hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        {open ? <ChevronDown className="size-3.5 text-sg-dim" /> : <ChevronRight className="size-3.5 text-sg-dim" />}
        <Calculator className="size-3.5 text-soft-cyan" />
        <span className="text-xs font-bold text-sg-white">Live numbers</span>
        <span className="text-2xs text-sg-dim">recomputed by the compensation engine</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Chip color={s.differs ? "red" : "green"}>
            {s.match}/{s.total} match
          </Chip>
          {s.rounding > 0 && <Chip color="yellow">{s.rounding} within Rp1</Chip>}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-soft-cyan/15 px-4 pb-4 pt-3">
          <p className="text-2xs leading-relaxed text-sg-muted">{check.method}</p>

          {check.items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-sg-line bg-sg-card">
              <table className="w-full min-w-[460px] text-xs">
                <thead>
                  <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.08em] text-sg-dim">
                    <th className="px-3 py-1.5 font-semibold">Figure</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Printed in policy</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Engine</th>
                    <th className="w-24 px-3 py-1.5 text-center font-semibold">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {check.items.map((it) => {
                    const st = checkStatus(it);
                    return (
                      <tr key={it.label} className="border-b border-sg-line last:border-b-0">
                        <td className="px-3 py-1.5 text-sg-text">
                          {it.label}
                          {it.note && <div className="text-2xs text-sg-dim">{it.note}</div>}
                        </td>
                        <td className="sg-num px-3 py-1.5 text-right text-sg-muted">{fmtFigure(it.printed, it.fmt, it.printedDecimals)}</td>
                        <td className={cn("sg-num px-3 py-1.5 text-right font-semibold", st === "differs" ? "text-soft-red" : st === "rounding" ? "text-soft-yellow" : "text-sg-white")}>{fmtFigure(it.engine, it.fmt)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <StatusMark status={st} diff={diffOf(it)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {check.matrix && (
            <div className="overflow-x-auto rounded-lg border border-sg-line bg-sg-card">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-sg-line text-left text-2xs uppercase tracking-[0.08em] text-sg-dim">
                    <th className="px-3 py-1.5 font-semibold">Row</th>
                    {check.matrix.columns.map((c) => (
                      <th key={c.key} className="px-3 py-1.5 text-right font-semibold">
                        {c.label}
                      </th>
                    ))}
                    <th className="w-20 px-3 py-1.5 text-center font-semibold">Row</th>
                  </tr>
                  <tr className="border-b border-sg-line text-right text-[10px] text-sg-dim">
                    <th />
                    {check.matrix.columns.map((c) => (
                      <th key={c.key} className="px-3 pb-1 font-normal">
                        printed · <span className="text-sg-text">engine</span>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {check.matrix.rows.map((r) => {
                    const cells = check.matrix!.columns.map((c) => r.cells[c.key]);
                    const statuses = cells.map((c) => (c ? checkStatus(c) : "unknown"));
                    const rowStatus: CheckStatus = statuses.includes("differs") ? "differs" : statuses.includes("rounding") ? "rounding" : statuses.every((x) => x === "match") ? "match" : "unknown";
                    return (
                      <tr key={r.label} className="border-b border-sg-line align-top last:border-b-0">
                        <td className="px-3 py-1.5 font-medium text-sg-white">{r.label}</td>
                        {cells.map((c, i) => {
                          if (!c) return <td key={i} />;
                          const st = statuses[i];
                          return (
                            <td key={i} className="px-3 py-1.5 text-right">
                              <div className="sg-num flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <span className="text-sg-dim">{fmtFigure(c.printed, c.fmt, c.printedDecimals ?? (c.fmt === "pct" ? 2 : undefined))}</span>
                                <span className="text-sg-dim">·</span>
                                <span className={cn("font-semibold", st === "differs" ? "text-soft-red" : st === "rounding" ? "text-soft-yellow" : "text-sg-white")}>{fmtFigure(c.engine, c.fmt)}</span>
                                {st === "match" ? <CircleCheck className="size-3 text-soft-green" aria-label="Matches" /> : st === "rounding" ? <span className="text-2xs font-semibold text-soft-yellow">±{diffOf(c)}</span> : st === "differs" ? <CircleX className="size-3 text-soft-red" aria-label="Differs" /> : null}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 text-center">
                          <StatusMark status={rowStatus} diff={1} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {check.rounding && <RoundingNote r={check.rounding} />}
        </div>
      )}
    </section>
  );
}

function RoundingNote({ r }: { r: NonNullable<ExampleCheck["rounding"]> }) {
  const rp = (n: number, dp = 0) => `Rp${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  return (
    <div className="flex gap-2.5 rounded-lg border border-soft-yellow/30 bg-soft-yellow/[0.06] px-3 py-2.5 text-2xs leading-relaxed text-sg-text">
      <Info className="mt-0.5 size-3.5 shrink-0 text-soft-yellow" />
      <div className="space-y-1.5">
        <p className="font-semibold text-sg-white">Why the installation figures differ by Rp1 — cumulative rule (§8.1) vs per-payment rounding in the example</p>
        <p>
          <span className="font-semibold text-sg-white">§8.1 cumulative (engine):</span> pool = y × cumulative net revenue − pool already allocated ={" "}
          <span className="sg-num">
            {(r.rate * 100).toFixed(4)}% × {rp(r.cumNet)} = {rp(r.cumPoolExact, 2)} → {rp(r.cumPoolFloor)} − {rp(r.allocated)} = <span className="font-semibold text-soft-yellow">{rp(r.cumulativePool)}</span>
          </span>
          .
        </p>
        <p>
          <span className="font-semibold text-sg-white">Per-payment rounding (printed example):</span> pool = y × this payment&apos;s net revenue ={" "}
          <span className="sg-num">
            {(r.rate * 100).toFixed(4)}% × {rp(r.paymentNet)} = {rp(r.perPaymentExact, 2)} → <span className="font-semibold text-sg-white">{rp(r.perPaymentPool)}</span>
          </span>
          .
        </p>
        <p className="text-sg-muted">
          Rounding the design pool down (§8.5) left a fraction of a rupiah unallocated. The cumulative rule recovers it in the next payment, so the engine&apos;s installation pool is Rp{r.cumulativePool - r.perPaymentPool} higher and each member&apos;s share rounds down from the larger pool. The policy&apos;s table rounds each payment on its own. The engine applies §8.1; the &ldquo;per payment&rdquo; column reproduces the printed table exactly. The difference is at most Rp1 per payment, in the team&apos;s favour.
        </p>
      </div>
    </div>
  );
}
