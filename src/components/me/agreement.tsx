"use client";

/*
 * Annex B Project Participation Agreement (and Annex C for probationers) — status, typed-name e-signature in
 * Bahasa Indonesia or English, the immutable signature record and a printable signed copy (§3.1, §11.2, §15.1).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, ClipboardCheck, FileText, Printer, ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { EMPLOYMENT_META, POLICY_VERSION } from "@/lib/initiatives/policy";
import type { AgreementSignature, EmployeeProfile } from "@/lib/initiatives/types";
import type { User } from "@/lib/types";
import { fingerprint } from "@/lib/slices/program-extras";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite } from "@/components/initiatives/shared";
import { findSection, plainText, policyDoc, type Block } from "@/components/policy/model";
import { PolicyBlocks, PolicyRenderProvider } from "@/components/policy/render";
import { ANNEX_B_FIELDS_EN, ANNEX_B_ID, ANNEX_C_FIELDS_EN, ANNEX_C_ID, BI_STATUS, SIGN_UI, type AgreementText, type PolicyLang } from "@/components/policy/bahasa";
import { annexBState, isLiveMember, rolesLabel } from "./helpers";
import { Card } from "./ui";

const PRINT_CSS = `
@media print {
  @page { margin: 16mm 14mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #annex-b-print, #annex-b-print * { visibility: visible !important; color: #111 !important; background: transparent !important; }
  #annex-b-print { position: absolute; left: 0; top: 0; width: 100%; }
  #annex-b-print table, #annex-b-print td, #annex-b-print th, #annex-b-print div { border-color: #bbb !important; }
}
`;

function DetailsTable({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-sg-line">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-sg-line last:border-b-0">
              <th scope="row" className="w-2/5 bg-sg-card-2/50 px-3 py-1.5 text-left font-medium text-sg-muted">
                {k}
              </th>
              <td className="px-3 py-1.5 font-semibold text-sg-white">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Policy text blocks of an annex without its blank form tables (we show the filled-in details instead). */
function annexText(id: string): { intro: Block[]; terms: Block[] } {
  const blocks = findSection(id)?.intro ?? [];
  const firstP = blocks.findIndex((b) => b.kind === "p");
  const intro = firstP >= 0 ? [blocks[firstP]] : [];
  const termsStart = blocks.findIndex((b, i) => i > firstP && b.kind === "p");
  const terms = termsStart >= 0 ? blocks.slice(termsStart).filter((b) => b.kind !== "table") : [];
  return { intro, terms };
}

const blocksText = (blocks: Block[]) =>
  blocks
    .map((b) => (b.kind === "p" ? plainText(b.text) : b.kind === "ol" || b.kind === "ul" ? b.items.map(plainText).join("\n") : ""))
    .join("\n");
const biText = (t: AgreementText) => [t.title, t.intro, t.lead, ...t.terms].join("\n");

function BiAgreement({ t }: { t: AgreementText }) {
  return (
    <div lang="id">
      <p className="text-xs leading-relaxed text-sg-text">{t.lead}</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-sg-text">
        {t.terms.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ol>
    </div>
  );
}

/** Latest e-signature record of a user for the policy version in force. */
export function useMySignatures(userId: string) {
  const sigs = useCrm((s) => s.agreementSignatures);
  return useMemo(() => sigs.filter((x) => x.userId === userId).sort((a, b) => b.signedAt.localeCompare(a.signedAt)), [sigs, userId]);
}

export function AgreementCard({ user, profile }: { user: User; profile: EmployeeProfile | undefined }) {
  const [open, setOpen] = useState(false);
  const state = annexBState(profile);
  const probationary = profile?.employmentType === "probationary";
  const sigs = useMySignatures(user.id);
  const current = sigs.find((x) => x.policyVersion === POLICY_VERSION);
  return (
    <Card
      id="annex-b"
      title={
        <>
          Project Participation Agreement <Cite s="3.1" />
          <Cite s="15.1" />
        </>
      }
      action={
        profile ? (
          <Button size="xs" variant={state === "current" ? "outline" : "primary"} onClick={() => setOpen(true)}>
            <FileText /> {state === "current" ? "View agreement" : state === "stale" ? "Sign the v4.0 agreement" : "Sign Project Participation Agreement"}
          </Button>
        ) : null
      }
    >
      {state === "none" && <p className="text-xs text-soft-red">No HR record — HR must create it and confirm eligibility before you can sign (§3.5).</p>}
      {state === "missing" && (
        <p className="flex gap-2 text-xs text-sg-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-soft-red" />
          <span>
            <span className="font-semibold text-soft-red">Not signed.</span> Annex B is an addendum to your employment agreement. You need it to join a project, and any bonus is held until it is signed (§3.1, §15.1).
            {probationary && " As a probationary employee you also sign Annex C (§11.2)."}
          </span>
        </p>
      )}
      {state === "stale" && (
        <p className="flex gap-2 text-xs text-sg-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-soft-yellow" />
          <span>
            Signed {formatDate(profile?.acknowledgmentSignedAt, "medium")}, before Version {POLICY_VERSION} was issued. All participants sign the updated agreement before the first payment under Version {POLICY_VERSION} (§15.1).
          </span>
        </p>
      )}
      {state === "current" && (
        <p className="flex gap-2 text-xs text-sg-text">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-soft-green" />
          <span>
            Signed {formatDate(profile?.acknowledgmentSignedAt, "medium")} for Version {POLICY_VERSION}
            {probationary ? ", with the Annex C probationary acknowledgment" : ""}. You receive an annual reminder of the §10 rules.
          </span>
        </p>
      )}
      {/* e-signature history (append-only record) */}
      <div className="mt-3 border-t border-sg-line pt-2">
        <div className="sg-eyebrow mb-1">Signature record</div>
        {sigs.length === 0 ? (
          <p className="text-2xs text-sg-dim">{profile?.acknowledgmentSignedAt ? `Signed on paper ${formatDate(profile.acknowledgmentSignedAt, "medium")} (recorded by HR) — no electronic record.` : "No signature yet."}</p>
        ) : (
          <ul className="space-y-1">
            {sigs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-1.5 text-2xs text-sg-muted">
                <ShieldCheck className="size-3 text-soft-green" aria-hidden />
                <span className="font-semibold text-sg-white">v{s.policyVersion}</span>
                <span>
                  Annex B{s.annexC ? " + C" : ""} · {s.language === "id" ? "Bahasa Indonesia" : "English"} · {formatDate(s.signedAt, "datetime")} WIB
                </span>
                <span className="sg-num text-sg-dim" title="Fingerprint of the exact text and details signed">
                  #{s.fingerprint}
                </span>
                {s === current && <Chip color="green">in force</Chip>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {profile && open && <SignModal open={open} onOpenChange={setOpen} user={user} profile={profile} signature={current} />}
    </Card>
  );
}

function SignModal({ open, onOpenChange, user, profile, signature }: { open: boolean; onOpenChange: (v: boolean) => void; user: User; profile: EmployeeProfile; signature: AgreementSignature | undefined }) {
  const users = useCrm((s) => s.users);
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const identity = useCrm((s) => s.identity);
  const signAgreement = useCrm((s) => s.signAgreement);
  const notify = useUi((s) => s.notify);
  const state = annexBState(profile);
  const viewing = state === "current";
  // Bahasa Indonesia prevails — offered first; an existing signature opens in the language it was signed in
  const [lang, setLang] = useState<PolicyLang>(signature?.language ?? "id");
  const [agreed, setAgreed] = useState(false);
  const [typed, setTyped] = useState("");
  const probationary = profile.employmentType === "probationary";
  const b = useMemo(() => annexText("s-annex-b"), []);
  const c = useMemo(() => annexText("s-annex-c"), []);
  const ctx = useMemo(() => ({ query: "", ids: policyDoc().ids, base: "/policy" }), []);
  const ui = SIGN_UI[lang];

  const manager = users.find((u) => u.id === profile.directManagerId);
  const live = members.filter((m) => m.userId === user.id && isLiveMember(m) && m.consent !== "declined");
  const timeAgreed = live.reduce((s, m) => s + m.allocationPct, 0);
  const firstRow = [...members.filter((m) => m.userId === user.id)].sort((x, y) => x.joinedAt.localeCompare(y.joinedAt))[0];
  const firstProject = firstRow ? initiatives.find((i) => i.id === firstRow.initiativeId) : undefined;
  const empNo = (profile as EmployeeProfile & { employeeNumber?: string }).employeeNumber;

  const bValues: Record<keyof typeof ANNEX_B_FIELDS_EN, string> = {
    name: user.name,
    number: empNo || (lang === "id" ? "Belum dicatat HR" : "Not yet recorded by HR"),
    position: `${user.title} · ${user.team}`,
    manager: manager?.name ?? "—",
    status: `${EMPLOYMENT_META[profile.employmentType].label}${profile.employmentType === "fixed_term_contract" && profile.contractEndDate ? ` · ${lang === "id" ? "kontrak berakhir" : "contract ends"} ${formatDate(profile.contractEndDate, "medium")}` : ""}`,
    time: live.length ? `${timeAgreed}% ${lang === "id" ? "dari waktu kerja pada" : "of working time across"} ${live.length} ${lang === "id" ? "peran proyek aktif" : `live project role${live.length === 1 ? "" : "s"}`}` : lang === "id" ? "Disepakati per proyek dengan atasan langsung (Bagian 7.1)" : "Agreed per project with your line manager (§7.1)",
  };
  const cValues: Record<keyof typeof ANNEX_C_FIELDS_EN, string> = {
    name: user.name,
    start: formatDate(profile.hireDate, "medium"),
    probationEnd: formatDate(profile.probationEndDate, "medium"),
    firstProject: firstProject ? `${firstProject.code || firstProject.trackingNo || firstProject.title} · ${rolesLabel(firstRow.roles)}` : lang === "id" ? "Belum bergabung dengan proyek" : "Not yet on a project",
  };
  const bLabels = lang === "id" ? ANNEX_B_ID.fields : ANNEX_B_FIELDS_EN;
  const cLabels = lang === "id" ? ANNEX_C_ID.fields : ANNEX_C_FIELDS_EN;
  const details = [
    ...(Object.keys(bValues) as (keyof typeof bValues)[]).map((k) => ({ label: `B · ${bLabels[k]}`, value: bValues[k] })),
    ...(probationary ? (Object.keys(cValues) as (keyof typeof cValues)[]).map((k) => ({ label: `C · ${cLabels[k]}`, value: cValues[k] })) : []),
  ];
  const text = lang === "id" ? [biText(ANNEX_B_ID), probationary ? biText(ANNEX_C_ID) : ""].join("\n") : [blocksText(b.intro), blocksText(b.terms), probationary ? blocksText(c.intro) + blocksText(c.terms) : ""].join("\n");

  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const nameOk = norm(typed) === norm(user.name);
  const isSelf = identity.source !== "access" || identity.userId === user.id;

  const sign = () => {
    if (!agreed || !nameOk) return;
    const fp = fingerprint(`${POLICY_VERSION}|${lang}|${text}|${JSON.stringify(details)}`);
    const id = signAgreement({ typedName: typed, language: lang, annexC: probationary, fingerprint: fp, details });
    if (!id) {
      notify(ui.mismatch);
      return;
    }
    onOpenChange(false);
    // no Undo — the signature record is evidence and cannot be withdrawn from here; HR handles corrections
    notify(`Project Participation Agreement signed electronically${probationary ? " with Annex C" : ""} · ${lang === "id" ? "Bahasa Indonesia" : "English"} (§3.1)`);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setAgreed(false);
          setTyped("");
        }
      }}
      title={lang === "id" ? `Perjanjian Keikutsertaan Proyek (Lampiran B)${probationary ? " dan Lampiran C" : ""}` : `Project Participation Agreement (Annex B)${probationary ? " and Annex C" : ""}`}
      description={lang === "id" ? `Kebijakan Versi ${POLICY_VERSION} · adendum perjanjian kerja ${user.name}` : `Policy Version ${POLICY_VERSION} · addendum to the employment agreement of ${user.name}`}
      className="w-[min(760px,calc(100vw-32px))]"
      footer={
        viewing ? (
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer /> Print signed copy
            </Button>
            <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!agreed || !nameOk || !isSelf} onClick={sign}>
              <ClipboardCheck /> {ui.sign}
            </Button>
          </>
        )
      }
    >
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden" role="radiogroup" aria-label="Language of the agreement">
        {(["id", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            onClick={() => setLang(l)}
            className={cn("rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors", lang === l ? "border-sg-white/40 bg-sg-card-2 text-sg-white" : "border-sg-line text-sg-muted hover:text-sg-white")}
          >
            {l === "id" ? "Bahasa Indonesia" : "English"}
          </button>
        ))}
        <span className="text-2xs text-sg-dim">{lang === "id" ? `Versi Bahasa Indonesia berlaku apabila terdapat perbedaan. ${BI_STATUS}.` : "If the two versions differ, the Bahasa Indonesia version prevails."}</span>
      </div>
      <div id="annex-b-print">
        <PolicyRenderProvider value={ctx}>
          {lang === "id" ? <p className="text-xs leading-relaxed text-sg-text">{ANNEX_B_ID.intro}</p> : <PolicyBlocks blocks={b.intro} />}
          <DetailsTable rows={(Object.keys(bValues) as (keyof typeof bValues)[]).map((k) => [bLabels[k], bValues[k]])} />
          {lang === "id" ? <BiAgreement t={ANNEX_B_ID} /> : <PolicyBlocks blocks={b.terms} />}
          {probationary && (
            <div className="mt-5 border-t border-sg-line pt-4">
              <h3 className="font-display text-sm font-bold text-sg-white">{lang === "id" ? ANNEX_C_ID.title : "Annex C · Probationary participation acknowledgment"}</h3>
              {lang === "id" ? <p className="text-xs leading-relaxed text-sg-text">{ANNEX_C_ID.intro}</p> : <PolicyBlocks blocks={c.intro} />}
              <DetailsTable rows={(Object.keys(cValues) as (keyof typeof cValues)[]).map((k) => [cLabels[k], cValues[k]])} />
              {lang === "id" ? <BiAgreement t={ANNEX_C_ID} /> : <PolicyBlocks blocks={c.terms} />}
            </div>
          )}
          {viewing ? (
            <div className="mt-4 rounded-lg border border-soft-green/30 bg-soft-green/[0.06] px-3 py-2 text-xs text-sg-text">
              {signature ? (
                <>
                  <div>
                    {SIGN_UI[signature.language].signedBy} <span className="font-semibold text-sg-white">{signature.typedName}</span> · {formatDate(signature.signedAt, "datetime")} WIB · {signature.language === "id" ? "Bahasa Indonesia" : "English"} · v{signature.policyVersion}
                  </div>
                  <div className="mt-0.5 text-2xs text-sg-muted">
                    Identity: {signature.identitySource === "access" ? `Cloudflare Access · ${signature.email}` : `demo mode, acting as ${signature.email ?? user.email}`} · fingerprint <span className="sg-num">#{signature.fingerprint}</span>
                    {signature.language !== lang ? ` · signed in ${signature.language === "id" ? "Bahasa Indonesia" : "English"}; shown here in ${lang === "id" ? "Bahasa Indonesia" : "English"}` : ""}
                  </div>
                </>
              ) : (
                <>Signed by {user.name} on {formatDate(profile.acknowledgmentSignedAt, "datetime")} (recorded by HR — no electronic signature record).</>
              )}
              <div className="mt-0.5 text-2xs text-sg-dim">{ui.countersign}</div>
            </div>
          ) : (
            <div className="mt-4 space-y-2 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2.5 print:hidden">
              <label className="flex cursor-pointer items-start gap-2 text-xs text-sg-text">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-3.5 accent-white" />
                <span>
                  {ui.confirm(user.name, probationary)}{" "}
                  <Link href="/policy" className="text-soft-cyan underline underline-offset-2">
                    {lang === "id" ? "Baca kebijakan" : "Read the policy"}
                  </Link>
                </span>
              </label>
              <div>
                <label htmlFor="esign-name" className="mb-1 block text-2xs font-semibold uppercase tracking-[0.12em] text-sg-dim">
                  {ui.typeName}
                </label>
                <Input id="esign-name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={user.name} autoComplete="name" aria-invalid={typed.length > 3 && !nameOk ? true : undefined} className={cn("font-display text-base italic", typed.length > 3 && !nameOk && "border-soft-red")} />
                {typed.length > 3 && !nameOk && <p className="mt-1 text-2xs text-soft-red">{ui.mismatch}</p>}
              </div>
              <p className="text-2xs text-sg-dim">
                {lang === "id" ? "Tercatat: nama yang diketik, identitas Anda" : "Recorded: the typed name, your identity"} ({identity.source === "access" ? `Cloudflare Access ${identity.email}` : lang === "id" ? `mode demo, sebagai ${user.email}` : `demo mode, acting as ${user.email}`}), {lang === "id" ? "waktu (WIB), versi kebijakan, bahasa dan sidik jari teks yang ditandatangani. Catatan ini tidak dapat diubah atau dibatalkan." : "the time (WIB), policy version, language and a fingerprint of the text signed. The record cannot be edited or undone."} {ui.countersign}
              </p>
              {!isSelf && <p className="text-2xs text-soft-red">You are signed in as someone else — only {user.name} can sign this agreement.</p>}
            </div>
          )}
        </PolicyRenderProvider>
      </div>
    </Modal>
  );
}
