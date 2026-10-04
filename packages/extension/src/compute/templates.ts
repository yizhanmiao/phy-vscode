import type { Templates } from '../host/dataset/dataset';

export const N_BEST_CHANNELS = 12;

/**
 * phy's unwhitening (template_w · W⁻¹). Sparse templates use the W⁻¹ sub-block of their kept channels,
 * dropping -1 columns and columns without signal (phylib's KS2 hack).
 */
export function unwhitenedTemplate(T: Templates, t: number, wmi: Float64Array, nChannels: number): Float64Array {
  const { nSamples: ns, nCols } = T;
  const base = t * ns * nCols;
  const out = new Float64Array(ns * nChannels);
  let kept: number[];
  let ch: number[];
  if (!T.cols) {
    kept = ch = Array.from({ length: nCols }, (_, i) => i);
  } else {
    const cols = T.cols.subarray(t * nCols, (t + 1) * nCols);
    const colMax = new Float64Array(nCols);
    for (let s = 0; s < ns; s++) {
      for (let k = 0; k < nCols; k++) colMax[k] = Math.max(colMax[k], Math.abs(T.data[base + s * nCols + k]));
    }
    const max = Math.max(...colMax);
    kept = [];
    ch = [];
    for (let k = 0; k < nCols; k++) {
      if (cols[k] >= 0 && colMax[k] > max * 1e-6) {
        kept.push(k);
        ch.push(cols[k]);
      }
    }
  }
  for (let s = 0; s < ns; s++) {
    const row = base + s * nCols;
    for (let i = 0; i < kept.length; i++) {
      const x = T.data[row + kept[i]];
      if (x === 0) continue;
      const w = ch[i] * nChannels;
      for (let j = 0; j < ch.length; j++) out[s * nChannels + ch[j]] += x * wmi[w + ch[j]];
    }
  }
  return out;
}

/** Spike-count-weighted mean of the unwhitened templates of a cluster's spikes. */
// ponytail: O(templates·nS·nC²) per cluster at session open; move the cluster table to a worker if Neuropixels opens slowly.
export function clusterMeanTemplate(
  T: Templates,
  wmi: Float64Array,
  nChannels: number,
  spikeTemplates: Int32Array,
  spikes: Int32Array,
): Float64Array {
  const counts = new Map<number, number>();
  for (const s of spikes) counts.set(spikeTemplates[s], (counts.get(spikeTemplates[s]) ?? 0) + 1);
  const out = new Float64Array(T.nSamples * nChannels);
  for (const [t, c] of counts) {
    if (t < 0 || t >= T.nTemplates) continue;
    const u = unwhitenedTemplate(T, t, wmi, nChannels);
    const w = c / spikes.length;
    for (let i = 0; i < out.length; i++) out[i] += w * u[i];
  }
  return out;
}

/**
 * Peak channel by peak-to-peak amplitude plus its nearest neighbours on the same shank, by decreasing amplitude.
 * Distance ties are broken by channel index (stable sort); phylib's unstable np.argsort may order equidistant channels differently.
 */
export function bestChannels(
  mean: Float64Array,
  nSamples: number,
  positions: Float32Array,
  shanks: Int32Array | undefined,
  n = N_BEST_CHANNELS,
): { channels: Int32Array; amplitude: Float64Array } {
  const nC = positions.length / 2;
  const amplitude = new Float64Array(nC);
  for (let c = 0; c < nC; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = 0; s < nSamples; s++) {
      const v = mean[s * nC + c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    amplitude[c] = hi - lo;
  }
  let best = 0;
  for (let c = 1; c < nC; c++) if (amplitude[c] > amplitude[best]) best = c;
  const x0 = positions[2 * best];
  const y0 = positions[2 * best + 1];
  const d = (c: number) => (positions[2 * c] - x0) ** 2 + (positions[2 * c + 1] - y0) ** 2;
  const channels = Array.from({ length: nC }, (_, c) => c)
    .sort((a, b) => d(a) - d(b))
    .slice(0, n)
    .filter((c) => !shanks || shanks[c] === shanks[best])
    .sort((a, b) => a - b)
    .sort((a, b) => amplitude[b] - amplitude[a]);
  return { channels: Int32Array.from(channels), amplitude };
}
