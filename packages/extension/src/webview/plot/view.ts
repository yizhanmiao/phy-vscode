export interface Range {
  min: number;
  max: number;
}

/** Narrowest span zooming in may reach: below this the floating-point spacing of the values swallows tick steps and GPU precision. */
const minSpan = (r: Range): number => 1e-6 * Math.max(1, Math.abs((r.min + r.max) / 2));

/** Scale a range by `factor` around the data value `at` (factor < 1 zooms in, but never below the minimum span; zooming out always works). */
export const zoomRange = (r: Range, factor: number, at: number): Range => {
  const span = r.max - r.min;
  if (factor < 1) {
    if (span <= minSpan(r)) return r;
    factor = Math.max(factor, minSpan(r) / span);
  }
  return {
    min: at - (at - r.min) * factor,
    max: at + (r.max - at) * factor,
  };
};

const sameRange = (a: Range, b: Range): boolean => a.min === b.min && a.max === b.max; // NaN is never equal

/** View of a panel after a redraw: keep the user's zoom/pan while the data ranges are unchanged, otherwise reset to them. */
export function carryView(
  prev: { x: Range; y: Range; view: { x: Range; y: Range } } | undefined,
  next: { x: Range; y: Range },
): { x: Range; y: Range } {
  return prev && sameRange(prev.x, next.x) && sameRange(prev.y, next.y) ? prev.view : { x: next.x, y: next.y };
}

/** Shift a range by `fraction` of its width. */
export const panRange = (r: Range, fraction: number): Range => {
  const d = (r.max - r.min) * fraction;
  return { min: r.min + d, max: r.max + d };
};

/** Finite min/max of all values with 5 % padding; never degenerate. */
export function paddedRange(...arrays: ArrayLike<number>[]): Range {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (lo === Infinity) return { min: 0, max: 1 };
  if (lo === hi) return { min: lo - 1, max: hi + 1 };
  const pad = (hi - lo) * 0.05;
  return { min: lo - pad, max: hi + pad };
}
