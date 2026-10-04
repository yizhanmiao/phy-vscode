import { invert } from './linalg';

export const HIGHPASS_HZ = 150;

const conv = (p: number[], q: number[]) => {
  const r = new Float64Array(p.length + q.length - 1);
  p.forEach((x, i) => q.forEach((y, j) => (r[i + j] += x * y)));
  return r;
};

/**
 * scipy.signal.butter(3, fc, 'highpass', fs=fs): the analog prototype 1/((s+1)(s²+s+1)) with
 * s = Ω(1+z⁻¹)/(1−z⁻¹), Ω = tan(π·fc/fs) (high-pass transform + pre-warped bilinear).
 */
export function butterHighpass3(fc: number, fs: number): { b: Float64Array; a: Float64Array } {
  const W = Math.tan((Math.PI * fc) / fs);
  const d1 = 1 + W;
  const d2 = W * W + W + 1;
  return {
    b: conv([1 / d1, -1 / d1], [1 / d2, -2 / d2, 1 / d2]),
    a: conv([1, (W - 1) / d1], [1, (2 * W * W - 2) / d2, (W * W - W + 1) / d2]),
  };
}

/** scipy.signal.lfilter_zi for a[0] = 1 and len(b) = len(a). */
function lfilterZi(b: Float64Array, a: Float64Array): Float64Array {
  const m = a.length - 1;
  const M = new Float64Array(m * m); // I − companion(a)ᵀ
  for (let i = 0; i < m; i++) {
    M[i * m + i] = 1;
    M[i * m] += a[i + 1];
    if (i + 1 < m) M[i * m + i + 1] = -1;
  }
  const B = Array.from({ length: m }, (_, i) => b[i + 1] - a[i + 1] * b[0]);
  const Minv = invert(M, m);
  return Float64Array.from({ length: m }, (_, i) => B.reduce((s, x, j) => s + Minv[i * m + j] * x, 0));
}

/** In-place transposed direct form II, state `z` (scipy's convention). */
function lfilter(b: Float64Array, a: Float64Array, x: Float64Array, z: Float64Array): void {
  const m = z.length;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const y = b[0] * xn + z[0];
    for (let j = 0; j < m - 1; j++) z[j] = b[j + 1] * xn + z[j + 1] - a[j + 1] * y;
    z[m - 1] = b[m] * xn - a[m] * y;
    x[n] = y;
  }
}

/** scipy.signal.filtfilt with default arguments (padtype='odd'). */
export function filtfilt(b: Float64Array, a: Float64Array, x: Float64Array): Float64Array {
  const n = x.length;
  const padlen = 3 * Math.max(a.length, b.length);
  if (n <= padlen) throw new Error(`filtfilt needs more than ${padlen} samples, got ${n}`);
  const ext = new Float64Array(n + 2 * padlen);
  for (let i = 0; i < padlen; i++) {
    ext[i] = 2 * x[0] - x[padlen - i];
    ext[n + padlen + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  ext.set(x, padlen);
  const zi = lfilterZi(b, a);
  lfilter(b, a, ext, zi.map((v) => v * ext[0]));
  ext.reverse();
  lfilter(b, a, ext, zi.map((v) => v * ext[0]));
  ext.reverse();
  return ext.slice(padlen, padlen + n);
}

export interface WindowSpec {
  nWindows: number;
  length: number;
  nChannels: number;
  pad: number;
  sampleRate: number;
  highpass: boolean;
}

function median(x: Float64Array): number {
  const s = x.slice().sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Filter (optional), crop `pad` samples on each side, subtract each channel's median. */
export function processWindows(windows: Float32Array, spec: WindowSpec): Float32Array {
  const { nWindows, length, nChannels: nc, pad } = spec;
  const outLen = length - 2 * pad;
  const out = new Float32Array(nWindows * outLen * nc);
  const { b, a } = butterHighpass3(HIGHPASS_HZ, spec.sampleRate);
  const col = new Float64Array(length);
  for (let w = 0; w < nWindows; w++) {
    for (let c = 0; c < nc; c++) {
      for (let t = 0; t < length; t++) col[t] = windows[(w * length + t) * nc + c];
      const y = spec.highpass ? filtfilt(b, a, col) : col;
      const crop = y.slice(pad, pad + outLen);
      const med = median(crop);
      for (let t = 0; t < outLen; t++) out[(w * outLen + t) * nc + c] = crop[t] - med;
    }
  }
  return out;
}
