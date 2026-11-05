/* Annex B (Project Participation Agreement) reminders for the Policy v4.0 rollout (§3.1, §15.1, §15.2). */
import type { ActivityLinks, User } from "@/lib/types";
import { POLICY_VERSION } from "@/lib/initiatives/policy";

/** §15.2 first pilot bonus payment, with the January 2027 salary. */
export const FIRST_V4_PAYMENT = "2027-01-25T00:00:00+07:00";
export const SIGN_URL = "https://crm.spectrumgroup.id/me";
export const REMINDER_SUBJECT = `Action required: sign the Project Participation Agreement (Policy v${POLICY_VERSION})`;

export function reminderBody(senderName: string) {
  return [
    "Dear colleague,",
    "",
    `The Project Initiative and Compensation Policy Version ${POLICY_VERSION} replaces Version 3.0. Under Section 3.1, every employee who proposes, joins or is paid for a project must sign the Project Participation Agreement (Annex B) as an addendum to their employment agreement.`,
    "",
    `Section 15.1 requires all participants to sign the updated agreement before the first payment under Version ${POLICY_VERSION}. Until it is signed, any project bonus due to you is held, not paid. The first Version ${POLICY_VERSION} payment is planned with the January salary on 25 January 2027 (Section 15.2).`,
    "",
    `Please read the policy and sign the agreement here: ${SIGN_URL}`,
    "",
    "If anything in the agreement is unclear, reply to this email or contact HR.",
    "",
    "Thank you,",
    senderName,
  ].join("\n");
}

type AddActivity = (input: { type: "note"; subject: string; body: string; links: ActivityLinks }) => string;

/** Mail clients (Outlook, Gmail) drop mailto links over ~2,000 characters — send BCC drafts in batches of this size. */
export const REMINDER_BATCH = 10;

export function reminderBatches(recipients: Pick<User, "name" | "email">[]) {
  const withEmail = recipients.filter((r) => r.email.trim());
  const out: Pick<User, "name" | "email">[][] = [];
  for (let i = 0; i < withEmail.length; i += REMINDER_BATCH) out.push(withEmail.slice(i, i + REMINDER_BATCH));
  return out;
}

/** A short mailto draft (BCC + subject + link) that stays well under the mailto length limit. */
export function reminderHref(batch: Pick<User, "email">[]) {
  const bcc = batch.map((r) => r.email.trim()).join(",");
  const short = `Please sign the Project Participation Agreement (Annex B, Policy v${POLICY_VERSION}) before the first v${POLICY_VERSION} payment on 25 January 2027 — until it is signed, project bonuses are held (§3.1, §15.1). Sign here: ${SIGN_URL}`;
  return `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(REMINDER_SUBJECT)}&body=${encodeURIComponent(short)}`;
}

/** Records that HR sent the reminder (one activity note for all batches). Returns the number of recipients. */
export function logAnnexBReminder(recipients: Pick<User, "name" | "email">[], senderName: string, addActivity: AddActivity, how: string) {
  const withEmail = recipients.filter((r) => r.email.trim());
  if (!withEmail.length) return 0;
  addActivity({
    type: "note",
    subject: `Annex B reminder sent to ${withEmail.length} ${withEmail.length === 1 ? "person" : "people"} (Policy v${POLICY_VERSION} §15.1)`,
    body: `${senderName} ${how} "${REMINDER_SUBJECT}" to: ${withEmail.map((r) => `${r.name} <${r.email.trim()}>`).join(", ")}. Payments stay held until each person signs the Project Participation Agreement (§3.1, §15.1). Signing link: ${SIGN_URL}`,
    links: { contactIds: [], companyIds: [], dealIds: [], ticketIds: [] },
  });
  return withEmail.length;
}
