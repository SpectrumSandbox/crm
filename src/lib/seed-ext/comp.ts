/* Extra persisted + synced collections for the "comp" workstream (W8). Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot).
 * The record types live here (no React / store imports) so the seed stays importable from scripts. */

export interface LedgerConfirmation {
  id: string;
  month: string;
  initiativeId: string;
  confirmedById: string;
  at: string;
  /** Finance confirmed without the Project Lead — reason recorded (§8.2) */
  override?: string;
}

export interface ExceptionReview {
  id: string;
  month: string;
  /** stable key of the exception, e.g. "joiner:u-rafi:ini-1" */
  key: string;
  reviewedById: string;
  at: string;
  note?: string;
}

/** A PRC member's recorded vote on releasing a certified run — passed to releaseRun as the §13.1 PRC vote. */
export interface ReleaseApproval {
  id: string;
  runId: string;
  month: string;
  userId: string;
  vote: "for" | "against";
  /** the certification this approval refers to — a re-certification invalidates earlier approvals */
  certifiedAt: string | null;
  at: string;
  /** recorded by someone else from the member's written approval */
  recordedById: string;
  withdrawnAt?: string | null;
}

export interface CycleNote {
  id: string;
  month: string;
  kind: "certification_reference";
  text: string;
  byId: string;
  at: string;
}

export const compSeed = {
  ledgerConfirmations: [] as LedgerConfirmation[],
  exceptionReviews: [] as ExceptionReview[],
  releaseApprovals: [] as ReleaseApproval[],
  cycleNotes: [] as CycleNote[],
};
