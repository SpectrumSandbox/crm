/* Store slice "CrmService" — state + actions mixed into useCrm. Owned by one workstream; extend freely. */
import type { GetFn, SetFn, Uid } from "./types";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CrmServiceSlice {}

export function createCrmServiceSlice<S extends CrmServiceSlice>(_set: SetFn<S>, _get: GetFn<S>, _uid: Uid): CrmServiceSlice {
  return {};
}
