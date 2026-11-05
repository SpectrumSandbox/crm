/* Store slice "CompExtras" — state + actions mixed into useCrm. Owned by one workstream; extend freely. */
import type { GetFn, SetFn, Uid } from "./types";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CompExtrasSlice {}

export function createCompExtrasSlice<S extends CompExtrasSlice>(_set: SetFn<S>, _get: GetFn<S>, _uid: Uid): CompExtrasSlice {
  return {};
}
