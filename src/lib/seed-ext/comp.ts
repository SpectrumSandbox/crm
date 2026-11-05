/* Extra persisted + synced collections for the "comp" workstream (W8). Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot). */
import type { CycleNote, ExceptionReview, LedgerConfirmation, ReleaseApproval } from "../slices/comp-extras";

export const compSeed = {
  ledgerConfirmations: [] as LedgerConfirmation[],
  exceptionReviews: [] as ExceptionReview[],
  releaseApprovals: [] as ReleaseApproval[],
  cycleNotes: [] as CycleNote[],
};
