import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const golden = (name: string): any => JSON.parse(readFileSync(new URL(`./goldens/${name}`, import.meta.url), 'utf8'));

export const flat = (x: unknown): (number | null)[] => (Array.isArray(x) ? x.flatMap(flat) : [x as number | null]);

/** Element-wise closeness, relative to max(1, |expected|); `null` in expected means NaN. */
export function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number | null>, tol = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === null) {
      expect(Number.isNaN(a), `index ${i}: expected NaN, got ${a}`).toBe(true);
      continue;
    }
    expect(Math.abs(a - e), `index ${i}: ${a} vs ${e}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(e)));
  }
}

export const live = { isCancellationRequested: false } as const;
