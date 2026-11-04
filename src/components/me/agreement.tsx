"use client";

/* Annex B Project Participation Agreement (and Annex C for probationers) — status and signing (§3.1, §11.2, §15.1). */
import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, ClipboardCheck, FileText } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { EMPLOYMENT_META, POLICY_VERSION } from "@/lib/initiatives/policy";
import type { EmployeeProfile } from "@/lib/initiatives/types";
import type { User } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Cite } from "@/components/initiatives/shared";
import { findSection, policyDoc, type Block } from "@/components/policy/model";
import { PolicyBlocks, PolicyRenderProvider } from "@/components/policy/render";
import { annexBState, isLiveMember, rolesLabel } from "./helpers";
import { Card } from "./ui";

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

export function AgreementCard({ user, profile }: { user: User; profile: EmployeeProfile | undefined }) {
  const [open, setOpen] = useState(false);
  const state = annexBState(profile);
  const probationary = profile?.employmentType === "probationary";
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
      {profile && <SignModal open={open} onOpenChange={setOpen} user={user} profile={profile} />}
    </Card>
  );
}

function SignModal({ open, onOpenChange, user, profile }: { open: boolean; onOpenChange: (v: boolean) => void; user: User; profile: EmployeeProfile }) {
  const users = useCrm((s) => s.users);
  const members = useCrm((s) => s.initiativeMembers);
  const initiatives = useCrm((s) => s.initiatives);
  const updateProfile = useCrm((s) => s.updateProfile);
  const notify = useUi((s) => s.notify);
  const [agreed, setAgreed] = useState(false);
  const state = annexBState(profile);
  const probationary = profile.employmentType === "probationary";
  const b = useMemo(() => annexText("s-annex-b"), []);
  const c = useMemo(() => annexText("s-annex-c"), []);
  const ctx = useMemo(() => ({ query: "", ids: policyDoc().ids, base: "/policy" }), []);

  const manager = users.find((u) => u.id === profile.directManagerId);
  const live = members.filter((m) => m.userId === user.id && isLiveMember(m) && m.consent !== "declined");
  const timeAgreed = live.reduce((s, m) => s + m.allocationPct, 0);
  const firstRow = [...members.filter((m) => m.userId === user.id)].sort((x, y) => x.joinedAt.localeCompare(y.joinedAt))[0];
  const firstProject = firstRow ? initiatives.find((i) => i.id === firstRow.initiativeId) : undefined;

  const sign = () => {
    const prev = profile.acknowledgmentSignedAt;
    updateProfile(user.id, { acknowledgmentSignedAt: new Date().toISOString() });
    onOpenChange(false);
    setAgreed(false);
    notify(`Project Participation Agreement signed${probationary ? " with Annex C" : ""} (§3.1)`, { label: "Undo", run: () => updateProfile(user.id, { acknowledgmentSignedAt: prev }) });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setAgreed(false);
      }}
      title={`Project Participation Agreement (Annex B)${probationary ? " and Annex C" : ""}`}
      description={`Policy Version ${POLICY_VERSION} · addendum to the employment agreement of ${user.name}`}
      className="w-[min(720px,calc(100vw-32px))]"
      footer={
        state === "current" ? (
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!agreed} onClick={sign}>
              <ClipboardCheck /> Sign as {user.name.split(" ")[0]}
            </Button>
          </>
        )
      }
    >
      <PolicyRenderProvider value={ctx}>
        <PolicyBlocks blocks={b.intro} />
        <DetailsTable
          rows={[
            ["Employee name", user.name],
            ["Employee number", user.id.toUpperCase()],
            ["Position and department", `${user.title} · ${user.team}`],
            ["Line manager", manager?.name ?? "—"],
            ["Employment status", `${EMPLOYMENT_META[profile.employmentType].label}${profile.employmentType === "fixed_term_contract" && profile.contractEndDate ? ` · contract ends ${formatDate(profile.contractEndDate, "medium")}` : ""}`],
            ["Maximum project time agreed with line manager", live.length ? `${timeAgreed}% of working time across ${live.length} live project role${live.length === 1 ? "" : "s"}` : "Agreed per project with your line manager (§7.1)"],
          ]}
        />
        <PolicyBlocks blocks={b.terms} />
        {probationary && (
          <div className="mt-5 border-t border-sg-line pt-4">
            <h3 className="font-display text-sm font-bold text-sg-white">Annex C · Probationary participation acknowledgment</h3>
            <PolicyBlocks blocks={c.intro} />
            <DetailsTable
              rows={[
                ["Employee name", user.name],
                ["Start date", formatDate(profile.hireDate, "medium")],
                ["Probation end date", formatDate(profile.probationEndDate, "medium")],
                ["First project code and role", firstProject ? `${firstProject.code || firstProject.trackingNo || firstProject.title} · ${rolesLabel(firstRow.roles)}` : "Not yet on a project"],
              ]}
            />
            <PolicyBlocks blocks={c.terms} />
          </div>
        )}
        {state === "current" ? (
          <p className="mt-4 rounded-lg border border-soft-green/30 bg-soft-green/[0.06] px-3 py-2 text-xs text-sg-text">
            Signed by {user.name} on {formatDate(profile.acknowledgmentSignedAt, "datetime")}.
          </p>
        ) : (
          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2.5 text-xs text-sg-text">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-3.5 accent-white" />
            <span>
              I, <span className="font-semibold text-sg-white">{user.name}</span>, confirm that I have read the{" "}
              <Link href="/policy" className="text-soft-cyan underline underline-offset-2">
                Project Initiative and Compensation Policy, Version {POLICY_VERSION}
              </Link>
              , and I understand and accept the terms above{probationary ? ", including Annex C" : ""}. Line manager and HR countersign through HR.
            </span>
          </label>
        )}
      </PolicyRenderProvider>
    </Modal>
  );
}
