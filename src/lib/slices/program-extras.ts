/* Store slice "ProgramExtras" — state + actions mixed into useCrm. Owned by one workstream; extend freely. */
import type { GetFn, SetFn, Uid } from "./types";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProgramExtrasSlice {}

export function createProgramExtrasSlice<S extends ProgramExtrasSlice>(_set: SetFn<S>, _get: GetFn<S>, _uid: Uid): ProgramExtrasSlice {
  return {};
}
