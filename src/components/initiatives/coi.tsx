"use client";

/* Annex F conflict-of-interest declarations (§12.2): every proposed team member declares before approval, and again within
 * 2 business days of any new conflict; the PRC decides how each conflict is managed. Declared conflicts recuse PRC voters (§13.1). */
import { useMemo, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { useUserMap } from "@/lib/selectors";
import { COI_QUESTIONS, type CoiDeclaration, type CoiQuestion, type Initiative } from "@/lib/initiatives/types";
import { ROLE_META } from "@/lib/initiatives/policy";
import { coiDeclaresConflict, isOpenRow, latestCoi } from "@/lib/initiatives/team-rules";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Chip } from "@/components/ui/misc";
import { Modal } from "@/components/ui/overlays";
import { Cite } from "./shared";
import { Card } from "./detail/ui";

const ACTIONS: { value: NonNullable<CoiDeclaration["prc"]>["action"]; label: string }[] = [
  { value: "none", label: "None needed" },
  { value: "team_change", label: "Team change" },
  { value: "price_check", label: "Independent price check" },
  { value: "rejected", label: "Project rejected" },
];

const blankAnswers = () => Object.fromEntries(COI_QUESTIONS.map((q) => [q.key, { yes: false, details: "" }])) as CoiDeclaration["answers"];

export function CoiCard({ ini }: { ini: Initiative }) {
  const members = useCrm((s) => s.initiativeMembers);
  const cois = useCrm((s) => s.coiDeclarations);
  const currentUserId = useCrm((s) => s.currentUserId);
  const userMap = useUserMap();
  const access = useAccess();
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<CoiDeclaration | null>(null);

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of members) if (m.initiativeId === ini.id && m.consent !== "declined" && isOpenRow(m) && !seen.has(m.userId)) seen.set(m.userId, m.roles.map((r) => ROLE_META[r].label).join(" + "));
    return [...seen.entries()].map(([userId, role]) => ({ userId, role, coi: latestCoi(cois, ini.id, userId) }));
  }, [members, cois, ini.id]);
  const missing = people.filter((p) => !p.coi).length;
  const open = people.filter((p) => coiDeclaresConflict(p.coi) && !p.coi?.prc).length;

  return (
    <Card
      title="Conflict-of-interest declarations"
      icon={ShieldAlert}
      cite={["12.2", "Annex F"]}
      actions={missing ? <Chip color="yellow">{missing} to declare</Chip> : open ? <Chip color="orange">{open} for the PRC</Chip> : people.length ? <Chip color="green">All declared</Chip> : null}
      bodyClassName="p-0"
    >
      {people.length ? (
        <ul className="divide-y divide-sg-line">
          {people.map(({ userId, role, coi }) => {
            const u = userMap.get(userId);
            const conflict = coiDeclaresConflict(coi);
            const canDeclare = userId === currentUserId || access.prc || access.manageHr;
            return (
              <li key={userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Avatar user={u} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sg-white">{u?.name ?? userId}</div>
                  <div className="text-2xs text-sg-dim">
                    {role}
                    {coi ? ` · declared ${formatDate(coi.signedAt, "medium")}${coi.recordedById !== coi.userId ? ` · recorded by ${userMap.get(coi.recordedById)?.name ?? coi.recordedById}${coi.formRef ? ` from ${coi.formRef}` : ""}` : ""}` : ""}
                  </div>
                  {conflict && coi ? (
                    <ul className="mt-0.5 text-2xs text-soft-orange">
                      {COI_QUESTIONS.filter((q) => coi.answers[q.key]?.yes).map((q) => (
                        <li key={q.key}>
                          {q.label}
                          {coi.answers[q.key].details ? ` — ${coi.answers[q.key].details}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {coi?.prc ? (
                    <div className="text-2xs text-sg-muted">
                      PRC: {coi.prc.conflict ? "conflict found" : "no conflict"} · {ACTIONS.find((a) => a.value === coi.prc!.action)?.label} · {userMap.get(coi.prc.decidedById)?.name ?? coi.prc.decidedById} {formatDate(coi.prc.decidedAt, "short")}
                      {coi.prc.note ? ` — ${coi.prc.note}` : ""}
                    </div>
                  ) : null}
                </div>
                {!coi ? <Chip color="yellow">Not declared</Chip> : conflict ? <Chip color="orange">Conflict declared</Chip> : <Chip color="green">No conflict</Chip>}
                {conflict && coi && !coi.prc && access.prc ? (
                  <Button size="xs" variant="primary" onClick={() => setDeciding(coi)}>
                    PRC decision
                  </Button>
                ) : null}
                {canDeclare ? (
                  <Button size="xs" variant="ghost" onClick={() => setDeclaring(userId)}>
                    {coi ? "New declaration" : "Declare"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-5 text-center text-xs text-sg-dim">Add the team first — every proposed member completes Annex F before approval.</p>
      )}
      <p className="border-t border-sg-line px-4 py-2 text-2xs text-sg-dim">An undisclosed conflict found later is treated as misconduct (§9.4). Update within 2 business days if anything changes. PRC members with a declared conflict are recused from decisions on this project (§13.1).</p>
      {declaring ? <DeclareModal ini={ini} userId={declaring} role={people.find((p) => p.userId === declaring)?.role ?? ""} onClose={() => setDeclaring(null)} /> : null}
      {deciding ? <DecideModal coi={deciding} onClose={() => setDeciding(null)} /> : null}
    </Card>
  );
}

function DeclareModal({ ini, userId, role, onClose }: { ini: Initiative; userId: string; role: string; onClose: () => void }) {
  const saveCoiDeclaration = useCrm((s) => s.saveCoiDeclaration);
  const currentUserId = useCrm((s) => s.currentUserId);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [answers, setAnswers] = useState(blankAnswers);
  const [confirm, setConfirm] = useState(false);
  const [formRef, setFormRef] = useState("");
  const self = userId === currentUserId;
  const name = userMap.get(userId)?.name ?? userId;
  const setA = (k: CoiQuestion, p: Partial<{ yes: boolean; details: string }>) => setAnswers((a) => ({ ...a, [k]: { ...a[k], ...p } }));
  const errors: string[] = [];
  for (const q of COI_QUESTIONS) if (answers[q.key].yes && answers[q.key].details.trim().length < 3) errors.push(`Details for “${q.label}”`);
  if (!confirm) errors.push("Confirm the declaration is complete and true");
  if (!self && formRef.trim().length < 3) errors.push("Reference of the signed Annex F form");
  const submit = () => {
    if (errors.length) return;
    saveCoiDeclaration({ initiativeId: ini.id, userId, role, formRef: self ? undefined : formRef.trim(), answers, signedAt: new Date().toISOString() });
    notify(Object.values(answers).some((a) => a.yes) ? `${name}'s conflict declared — the PRC decides how to manage it` : `${name} declared no conflict`);
    onClose();
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Annex F — ${name}`}
      description={`${ini.code ?? ini.trackingNo ?? ""} ${ini.title} · ${role}. Do you, or does a family member, have any of these with the client, a supplier or a subcontractor on this project?`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={errors.length > 0} title={errors.join("\n")} onClick={submit}>
            Sign declaration
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {COI_QUESTIONS.map((q) => (
          <div key={q.key} className="rounded-md border border-sg-line p-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 text-sm text-sg-text">{q.label}</span>
              <div role="radiogroup" aria-label={q.label} className="flex rounded border border-sg-line p-0.5 text-2xs font-semibold">
                <button type="button" role="radio" aria-checked={!answers[q.key].yes} onClick={() => setA(q.key, { yes: false })} className={!answers[q.key].yes ? "rounded-sm bg-sg-card-3 px-2 py-0.5 text-sg-white" : "px-2 py-0.5 text-sg-dim"}>
                  No
                </button>
                <button type="button" role="radio" aria-checked={answers[q.key].yes} onClick={() => setA(q.key, { yes: true })} className={answers[q.key].yes ? "rounded-sm bg-soft-orange px-2 py-0.5 text-sg-bg" : "px-2 py-0.5 text-sg-dim"}>
                  Yes
                </button>
              </div>
            </div>
            {answers[q.key].yes ? <Input value={answers[q.key].details} onChange={(e) => setA(q.key, { details: e.target.value })} placeholder="Details — who, which company, since when" className="mt-1.5 h-7 text-xs" aria-label={`Details: ${q.label}`} /> : null}
          </div>
        ))}
        {!self ? (
          <Field label="Signed form reference (recording on their behalf)">
            <Input value={formRef} onChange={(e) => setFormRef(e.target.value)} placeholder="e.g. scan in the project folder, email of 5 Nov" />
          </Field>
        ) : null}
        <label className="flex cursor-pointer items-start gap-2 text-xs text-sg-text">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-3.5 accent-sg-white" />
          {self ? "I confirm" : `${name} confirms`} that this declaration is complete and true, and will be updated within 2 business days if anything changes. An undisclosed conflict is treated as misconduct (§9.4).
        </label>
      </div>
    </Modal>
  );
}

function DecideModal({ coi, onClose }: { coi: CoiDeclaration; onClose: () => void }) {
  const decideCoi = useCrm((s) => s.decideCoi);
  const notify = useUi((s) => s.notify);
  const userMap = useUserMap();
  const [conflict, setConflict] = useState(true);
  const [action, setAction] = useState<NonNullable<CoiDeclaration["prc"]>["action"]>("price_check");
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`PRC decision — ${userMap.get(coi.userId)?.name ?? coi.userId}'s declaration`}
      description="The PRC decides how to manage each conflict: change the team, require an independent check of prices, or reject the project (§12.2)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={note.trim().length < 5}
            onClick={() => {
              decideCoi(coi.id, { conflict, action: conflict ? action : "none", note: note.trim() });
              notify("PRC decision on the conflict recorded");
              onClose();
            }}
          >
            <ShieldCheck /> Record PRC decision
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="flex items-center gap-2 text-sm text-sg-text">
          <input type="checkbox" checked={conflict} onChange={(e) => setConflict(e.target.checked)} className="size-3.5 accent-sg-white" /> Conflict found
        </label>
        {conflict ? (
          <Field label="Action taken">
            <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
              {ACTIONS.filter((a) => a.value !== "none").map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Reasons (required)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-2xs text-sg-dim">
          Recorded by you as PRC <Cite s="13.1" />
        </p>
      </div>
    </Modal>
  );
}
