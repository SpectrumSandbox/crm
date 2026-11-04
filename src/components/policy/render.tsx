"use client";

/*
 * Renderers for the parsed policy: inline Markdown (bold, B_i subscripts, cross-reference links, search highlight),
 * blocks (paragraphs, lists, tables, form templates) and a small LaTeX renderer for the four formulas in the policy
 * (§5.1 rate curve, §5.2 net revenue, §6.6 bonus formula, §9.1 operating result) — drawn as styled HTML, not raw TeX.
 */
import { Fragment, createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { plainText, sectionAnchor, unescapeMd, type Block } from "./model";

/* ───────────────────────── context: search query + known anchors ───────────────────────── */

interface RenderCtx {
  query: string;
  ids: Set<string>;
  /** in-document navigation (smooth scroll); falls back to a plain hash link */
  onNavigate?: (id: string) => void;
  /** render cross-references as links to another page (e.g. "/policy") instead of in-page anchors */
  base?: string;
}
const Ctx = createContext<RenderCtx>({ query: "", ids: new Set() });
export const PolicyRenderProvider = Ctx.Provider;

/* ───────────────────────── inline ───────────────────────── */

function Highlight({ text }: { text: string }) {
  const { query } = useContext(Ctx);
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  let i = lower.indexOf(q);
  while (i >= 0) {
    if (i > at) out.push(text.slice(at, i));
    out.push(
      <mark key={i} className="rounded-sm bg-soft-yellow/30 px-px text-sg-white print:bg-transparent">
        {text.slice(i, i + q.length)}
      </mark>,
    );
    at = i + q.length;
    i = lower.indexOf(q, at);
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function AnchorLink({ id, children }: { id: string; children: ReactNode }) {
  const { onNavigate, base } = useContext(Ctx);
  if (base)
    return (
      <Link href={`${base}#${id}`} className="text-soft-cyan underline decoration-soft-cyan/30 underline-offset-2 hover:decoration-soft-cyan">
        {children}
      </Link>
    );
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onNavigate(id);
      }}
      className="text-soft-cyan underline decoration-soft-cyan/30 underline-offset-2 hover:decoration-soft-cyan print:text-inherit print:no-underline"
    >
      {children}
    </a>
  );
}

const XREF = /\b(Sections?)\s+(\d{1,2}(?:\.\d{1,2})?(?:(?:,\s*|\s+and\s+|\s+to\s+|\s+or\s+)\d{1,2}(?:\.\d{1,2})?)*)|\b(Annex(?:es)?)\s+([A-H])\b|([A-Za-z])\\_([a-z])\b/g;
const NUM = /\d{1,2}(?:\.\d{1,2})?/g;

/** Plain text → nodes: cross-references become anchor links, `B\_i` becomes B<sub>i</sub>, matches are highlighted. */
function Linkified({ text }: { text: string }) {
  const { ids } = useContext(Ctx);
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(XREF)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Highlight key={k++} text={text.slice(last, idx)} />);
    if (m[1]) {
      // "Sections 6.7 and 6.8" — link each number
      out.push(<Highlight key={k++} text={`${m[1]} `} />);
      const nums = m[2];
      let p = 0;
      for (const n of nums.matchAll(NUM)) {
        const ni = n.index ?? 0;
        if (ni > p) out.push(<Highlight key={k++} text={nums.slice(p, ni)} />);
        const id = sectionAnchor(n[0]);
        out.push(
          ids.has(id) ? (
            <AnchorLink key={k++} id={id}>
              <Highlight text={n[0]} />
            </AnchorLink>
          ) : (
            <Highlight key={k++} text={n[0]} />
          ),
        );
        p = ni + n[0].length;
      }
      if (p < nums.length) out.push(<Highlight key={k++} text={nums.slice(p)} />);
    } else if (m[3]) {
      const id = `s-annex-${m[4].toLowerCase()}`;
      out.push(
        ids.has(id) ? (
          <AnchorLink key={k++} id={id}>
            <Highlight text={`${m[3]} ${m[4]}`} />
          </AnchorLink>
        ) : (
          <Highlight key={k++} text={`${m[3]} ${m[4]}`} />
        ),
      );
    } else {
      out.push(
        <span key={k++} className="font-serif italic">
          {m[5]}
          <sub className="not-italic">{m[6]}</sub>
        </span>,
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(<Highlight key={k++} text={text.slice(last)} />);
  return <>{out}</>;
}

/** Inline Markdown from the policy: **bold** spans, escapes, cross-references. */
export function Inline({ text }: { text: string }) {
  const s = unescapeMd(text);
  const parts = s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i} className="font-semibold text-sg-white">
            <Linkified text={p.slice(2, -2)} />
          </strong>
        ) : (
          <Linkified key={i} text={p} />
        ),
      )}
    </>
  );
}

/* ───────────────────────── LaTeX (subset) ───────────────────────── */

type Tok = { t: "cmd"; v: string } | { t: "ch"; v: string } | { t: "open" } | { t: "close" } | { t: "sub" } | { t: "sup" } | { t: "amp" } | { t: "nl" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      if (next === "\\") {
        out.push({ t: "nl" });
        i++;
      } else if (next && /[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
        out.push({ t: "cmd", v: src.slice(i + 1, j) });
        i = j - 1;
      } else if (next) {
        out.push({ t: "ch", v: next });
        i++;
      }
    } else if (c === "{") out.push({ t: "open" });
    else if (c === "}") out.push({ t: "close" });
    else if (c === "_") out.push({ t: "sub" });
    else if (c === "^") out.push({ t: "sup" });
    else if (c === "&") out.push({ t: "amp" });
    else out.push({ t: "ch", v: c });
  }
  return out;
}

type TexNode =
  | { k: "text"; v: string; upright?: boolean }
  | { k: "op"; v: string }
  | { k: "group"; c: TexNode[] }
  | { k: "frac"; n: TexNode[]; d: TexNode[] }
  | { k: "script"; base: TexNode | null; sub: TexNode[] | null; sup: TexNode[] | null }
  | { k: "sum"; sub: TexNode[] | null; sup: TexNode[] | null }
  | { k: "space"; em: number }
  | { k: "cases"; rows: TexNode[][][] };

const OPS: Record<string, string> = { times: "×", le: "≤", leq: "≤", ge: "≥", geq: "≥", cdot: "·", pm: "±", neq: "≠" };

function parseTex(src: string): TexNode[] {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];

  const rawGroup = (): string => {
    // text inside {...} kept verbatim (for \text, \begin)
    if (peek()?.t !== "open") return "";
    i++;
    let depth = 1;
    let s = "";
    while (i < toks.length && depth > 0) {
      const t = toks[i++];
      if (t.t === "open") depth++;
      else if (t.t === "close") {
        depth--;
        if (depth === 0) break;
      } else if (t.t === "ch") s += t.v;
      else if (t.t === "cmd") s += t.v;
    }
    return s;
  };
  const group = (): TexNode[] => {
    if (peek()?.t === "open") {
      i++;
      return seq(["close"]);
    }
    const one = atom();
    return one ? [one] : [];
  };
  const scripts = (): { sub: TexNode[] | null; sup: TexNode[] | null } => {
    let sub: TexNode[] | null = null;
    let sup: TexNode[] | null = null;
    while (peek()?.t === "sub" || peek()?.t === "sup") {
      const t = toks[i++];
      if (t.t === "sub") sub = group();
      else sup = group();
    }
    return { sub, sup };
  };
  function atom(): TexNode | null {
    const t = toks[i++];
    if (!t) return null;
    if (t.t === "open") return { k: "group", c: seq(["close"]) };
    if (t.t === "ch") {
      if (t.v === " ") return null;
      if (/[A-Za-z]/.test(t.v)) return { k: "text", v: t.v };
      if (t.v === "-") return { k: "op", v: "−" };
      if ("=+<>".includes(t.v)) return { k: "op", v: t.v };
      if (t.v === "/") return { k: "text", v: " / ", upright: true };
      return { k: "text", v: t.v, upright: true };
    }
    if (t.t === "cmd") {
      if (t.v === "text" || t.v === "mathrm") return { k: "text", v: rawGroup(), upright: true };
      if (t.v === "frac" || t.v === "dfrac" || t.v === "tfrac") {
        const n = group();
        const d = group();
        return { k: "frac", n, d };
      }
      if (t.v === "sum") return { k: "sum", ...scripts() };
      if (t.v === "qquad") return { k: "space", em: 2 };
      if (t.v === "quad") return { k: "space", em: 1 };
      if (t.v === "begin") {
        const env = rawGroup();
        if (env === "cases") {
          const rows: TexNode[][][] = [];
          let row: TexNode[][] = [];
          for (;;) {
            const cell = seq(["amp", "nl", "end"]);
            row.push(cell);
            const stop = toks[i - 1];
            const stopped = !!stop && (stop.t === "amp" || stop.t === "nl" || (stop.t === "cmd" && stop.v === "end"));
            if (!stopped || (stop?.t === "cmd" && stop.v === "end")) {
              rawGroup();
              rows.push(row);
              break;
            }
            if (stop.t === "nl") {
              rows.push(row);
              row = [];
            }
          }
          return { k: "cases", rows };
        }
        return null;
      }
      if (OPS[t.v]) return { k: "op", v: OPS[t.v] };
      return { k: "text", v: t.v, upright: true };
    }
    return null;
  }
  function seq(stops: ("close" | "amp" | "nl" | "end")[]): TexNode[] {
    const out: TexNode[] = [];
    while (i < toks.length) {
      const t = peek();
      if (t.t === "close" && stops.includes("close")) {
        i++;
        break;
      }
      if (t.t === "amp" && stops.includes("amp")) {
        i++;
        break;
      }
      if (t.t === "nl" && stops.includes("nl")) {
        i++;
        break;
      }
      if (t.t === "cmd" && t.v === "end" && stops.includes("end")) {
        i++;
        break;
      }
      if (t.t === "sub" || t.t === "sup") {
        const base = out.pop() ?? null;
        const s = scripts();
        out.push({ k: "script", base, ...s });
        continue;
      }
      const a = atom();
      if (!a) continue;
      const prev = out[out.length - 1];
      // merge runs of upright characters ("1,500,000,000") into one text node
      if (a.k === "text" && a.upright && prev?.k === "text" && prev.upright) prev.v += a.v;
      else out.push(a);
    }
    return out;
  }
  return seq([]);
}

function TexNodes({ nodes }: { nodes: TexNode[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <TexView key={i} n={n} />
      ))}
    </>
  );
}

function TexView({ n }: { n: TexNode }): ReactNode {
  switch (n.k) {
    case "text":
      return n.upright ? <span>{n.v}</span> : <span className="font-serif italic">{n.v}</span>;
    case "op":
      return <span className="mx-1.5">{n.v}</span>;
    case "group":
      return <TexNodes nodes={n.c} />;
    case "space":
      return <span className="inline-block" style={{ width: `${n.em}em` }} />;
    case "frac":
      return (
        <span className="mx-1 inline-flex flex-col items-center align-middle text-[0.95em] leading-tight">
          <span className="border-b border-current px-1.5 pb-0.5">
            <TexNodes nodes={n.n} />
          </span>
          <span className="px-1.5 pt-0.5">
            <TexNodes nodes={n.d} />
          </span>
        </span>
      );
    case "script":
      return (
        <span>
          {n.base ? <TexView n={n.base} /> : null}
          {n.sup ? (
            <sup className="text-[0.7em]">
              <TexNodes nodes={n.sup} />
            </sup>
          ) : null}
          {n.sub ? (
            <sub className="text-[0.7em]">
              <TexNodes nodes={n.sub} />
            </sub>
          ) : null}
        </span>
      );
    case "sum":
      return (
        <span className="mx-0.5 inline-flex flex-col items-center align-middle leading-none">
          <span className="text-[0.65em]">{n.sup ? <TexNodes nodes={n.sup} /> : null}</span>
          <span className="text-[1.5em] leading-none">Σ</span>
          <span className="text-[0.65em]">{n.sub ? <TexNodes nodes={n.sub} /> : null}</span>
        </span>
      );
    case "cases":
      return (
        <span className="inline-flex items-stretch align-middle">
          <span aria-hidden className="mr-2 w-2 rounded-l-md border-y-2 border-l-2 border-current opacity-70" />
          <span className="inline-grid grid-cols-[auto_auto] items-center gap-x-6 gap-y-2 py-1">
            {n.rows.map((row, r) => (
              <Fragment key={r}>
                {row.map((cell, c) => (
                  <span key={c} className={cn(c === 1 && "text-sg-muted")}>
                    {c === 1 ? <span className="mr-1 text-2xs uppercase tracking-wider text-sg-dim">if</span> : null}
                    <TexNodes nodes={cell} />
                  </span>
                ))}
              </Fragment>
            ))}
          </span>
        </span>
      );
  }
}

/** A display formula from the policy source (Markdown-escaped LaTeX). */
export function Formula({ tex, className }: { tex: string; className?: string }) {
  const nodes = parseTex(unescapeMd(tex));
  return (
    <div role="math" aria-label={unescapeMd(tex).replace(/\\[a-z]+/g, " ").replace(/[{}\\]/g, "")} className={cn("my-3 overflow-x-auto rounded-lg border border-sg-line bg-sg-bg/50 px-4 py-3 text-center text-[15px] text-sg-white print:border-black/30 print:bg-transparent", className)}>
      <span className="inline-flex flex-wrap items-center justify-center whitespace-nowrap">
        <TexNodes nodes={nodes} />
      </span>
    </div>
  );
}

/* ───────────────────────── blocks ───────────────────────── */

const NUMERIC = /^[−-]?Rp[\d,]+$|^\d+(\.\d+)?%$|^[\d.]+$/;

function Table({ head, rows, form }: { head: string[]; rows: string[][]; form: boolean }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-sg-line print:overflow-visible print:border-black/40">
      <table className={cn("w-full text-xs", form ? "min-w-[420px]" : "min-w-[480px]")}>
        <thead>
          <tr className="border-b border-sg-line bg-sg-card-2/60 text-left print:bg-transparent">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-1.5 align-bottom text-2xs font-semibold uppercase tracking-[0.08em] text-sg-dim">
                <Inline text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-sg-line align-top last:border-b-0 print:break-inside-avoid">
              {r.map((c, ci) => (
                <td key={ci} className={cn("px-3 py-1.5 text-sg-text", ci === 0 && "font-medium text-sg-white", NUMERIC.test(plainText(c)) && "sg-num whitespace-nowrap", form && !c && "h-7")}>
                  {c ? <Inline text={c} /> : form ? <span aria-label="blank" className="block h-full min-h-4 border-b border-dashed border-sg-line-2 print:border-black/40" /> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PolicyBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "p":
            return (
              <p key={i} className="my-2 text-[13px] leading-relaxed text-sg-text">
                <Inline text={b.text} />
              </p>
            );
          case "ul":
            return (
              <ul key={i} className={cn("my-2 list-disc space-y-1 text-[13px] leading-relaxed text-sg-text marker:text-sg-dim", b.nested ? "ml-11 pl-4" : "pl-5")}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={b.start} className="my-2 list-decimal space-y-1 pl-6 text-[13px] leading-relaxed text-sg-text marker:font-semibold marker:text-sg-dim">
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    <Inline text={it} />
                  </li>
                ))}
              </ol>
            );
          case "table":
            return <Table key={i} head={b.head} rows={b.rows} form={b.form} />;
          case "formula":
            return <Formula key={i} tex={b.tex} />;
        }
      })}
    </>
  );
}
