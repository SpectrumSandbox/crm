/* Store slice "Automation" — state + actions mixed into useCrm. Owned by one workstream; extend freely. */
import type { GetFn, SetFn, Uid } from "./types";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AutomationSlice {}

export function createAutomationSlice<S extends AutomationSlice>(_set: SetFn<S>, _get: GetFn<S>, _uid: Uid): AutomationSlice {
  return {};
}
