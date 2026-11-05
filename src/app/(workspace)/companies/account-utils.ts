/* Account-plan helpers shared by the companies list, the company record banner and the plan page. */
import type { ReviewCadence } from "@/lib/seed-ext/accounts";

export const CADENCE_DAYS: Record<ReviewCadence, number> = { monthly: 31, quarterly: 92, semiannual: 183 };
export const CADENCE_LABEL: Record<ReviewCadence, string> = { monthly: "Monthly", quarterly: "Quarterly", semiannual: "Every 6 months" };

/** is the account-plan review overdue for its cadence? */
export function reviewOverdue(cadence: ReviewCadence, lastReviewedAt: string | null, now = Date.now()) {
  return !lastReviewedAt || now - Date.parse(lastReviewedAt) > CADENCE_DAYS[cadence] * 86_400_000;
}

/** next review date for a plan (ISO), or null when it has never been reviewed */
export function nextReviewAt(cadence: ReviewCadence, lastReviewedAt: string | null) {
  return lastReviewedAt ? new Date(Date.parse(lastReviewedAt) + CADENCE_DAYS[cadence] * 86_400_000).toISOString() : null;
}

/** "2026-Q4" for a date in WIB */
export function quarterOf(ms: number) {
  const d = new Date(ms + 7 * 3_600_000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}
