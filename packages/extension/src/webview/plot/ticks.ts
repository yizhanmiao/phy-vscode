export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  // the cap and the stall check keep a step below the floating-point spacing of v from looping forever
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9 && out.length < 1000; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    if (v + step === v) break;
  }
  return out;
}

export function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e4 || (a > 0 && a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(6)));
}
