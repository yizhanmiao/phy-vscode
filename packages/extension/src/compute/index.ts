import { correlograms } from './correlograms';
import { processWindows } from './filter';

/** Compute functions that may run in worker threads (the WASM seam: swap implementations, keep signatures). */
export const computeFns = { correlograms, processWindows };
export type ComputeFns = typeof computeFns;
export type ComputeName = keyof ComputeFns;

export interface Compute {
  run<K extends ComputeName>(name: K, ...args: Parameters<ComputeFns[K]>): Promise<ReturnType<ComputeFns[K]>>;
}

export const inlineCompute: Compute = {
  run: async (name, ...args) => (computeFns[name] as (...a: unknown[]) => never)(...args),
};
