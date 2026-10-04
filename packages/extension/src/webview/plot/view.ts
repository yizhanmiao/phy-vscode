export interface Range {
  min: number;
  max: number;
}

/** Scale a range by `factor` around the data value `at` (factor < 1 zooms in). */
export const zoomRange = (r: Range, factor: number, at: number): Range => ({
  min: at - (at - r.min) * factor,
  max: at + (r.max - at) * factor,
});

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
