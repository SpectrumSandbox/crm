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

/**
 * Opens a mailto draft with every recipient in BCC and records an audit-style activity note.
 * Returns the number of recipients (0 when nobody has an email address).
 */
export function sendAnnexBReminder(recipients: Pick<User, "name" | "email">[], senderName: string, addActivity: AddActivity) {
  const withEmail = recipients.filter((r) => r.email.trim());
  if (!withEmail.length) return 0;
  const bcc = withEmail.map((r) => r.email.trim()).join(",");
  const href = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(REMINDER_SUBJECT)}&body=${encodeURIComponent(reminderBody(senderName))}`;
  if (typeof window !== "undefined") window.location.href = href;
  addActivity({
    type: "note",
    subject: `Annex B reminder sent to ${withEmail.length} ${withEmail.length === 1 ? "person" : "people"} (Policy v${POLICY_VERSION} §15.1)`,
    body: `${senderName} drafted the reminder "${REMINDER_SUBJECT}" (BCC) to: ${withEmail.map((r) => `${r.name} <${r.email.trim()}>`).join(", ")}. Payments stay held until each person signs the Project Participation Agreement (§3.1, §15.1). Signing link: ${SIGN_URL}`,
    links: { contactIds: [], companyIds: [], dealIds: [], ticketIds: [] },
  });
  return withEmail.length;
}
