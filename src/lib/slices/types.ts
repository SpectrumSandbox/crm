/* Shared typing for store slices mixed into useCrm (src/lib/store.ts). */
export type Uid = (prefix: string) => string;
export type GetFn<S> = () => S;
export type SetFn<S> = (partial: Partial<S> | ((s: S) => Partial<S>)) => void;
