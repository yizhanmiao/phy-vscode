/** Inverse of a row-major n×n matrix (Gauss–Jordan with partial pivoting). */
export function invert(m: Float64Array, n: number): Float64Array {
  const a = Float64Array.from(m);
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) inv[i * n + i] = 1;
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r * n + col]) > Math.abs(a[p * n + col])) p = r;
    if (Math.abs(a[p * n + col]) < 1e-12) throw new Error('matrix is singular');
    if (p !== col) {
      for (let k = 0; k < n; k++) {
        [a[p * n + k], a[col * n + k]] = [a[col * n + k], a[p * n + k]];
        [inv[p * n + k], inv[col * n + k]] = [inv[col * n + k], inv[p * n + k]];
      }
    }
    const d = a[col * n + col];
    for (let k = 0; k < n; k++) {
      a[col * n + k] /= d;
      inv[col * n + k] /= d;
    }
    for (let r = 0; r < n; r++) {
      const f = a[r * n + col];
      if (r === col || f === 0) continue;
      for (let k = 0; k < n; k++) {
        a[r * n + k] -= f * a[col * n + k];
        inv[r * n + k] -= f * inv[col * n + k];
      }
    }
  }
  return inv;
}
