/* Extra persisted + synced collections for the "governance" workstream. Every key must be an array (it is spread into
 * the seed bundle in src/lib/seed.ts, persisted to localStorage and synced to the D1 workspace snapshot). */
import type { ChangeOrder, CloseOutReport, CoiDeclaration, ProjectUpdate } from "../initiatives/types";

export const governanceSeed = {
  /** §6.1 monthly project status updates with RAG health */
  projectUpdates: [] as ProjectUpdate[],
  /** §5.6 change orders (approved ones add to project revenue; > 10 % move in x → §5.1 rate reset) */
  changeOrders: [] as ChangeOrder[],
  /** Annex G close-out reports (§8.3) */
  closeOutReports: [] as CloseOutReport[],
  /** Annex F conflict-of-interest declarations (§12.2) */
  coiDeclarations: [] as CoiDeclaration[],
};
