/**
 * Auto/cross-correlograms, identical to phylib.stats.ccg.correlograms(symmetrize=True).
 * `times`: all spike times in samples (may be shared memory); `spikes`: the selected clusters' spikes merged
 * in ascending order; `labels`: selection index per entry. Result [i][j][k] counts spikes of j at lag
 * (k − halfBins)·bin relative to spikes of i.
 */
export function correlograms(
  times: Float64Array,
  spikes: Int32Array,
  labels: Int32Array,
  nClusters: number,
  binSamples: number,
  halfBins: number,
): Int32Array {
  const nb = halfBins + 1;
  const c = new Int32Array(nClusters * nClusters * nb);
  for (let i = 0; i < spikes.length; i++) {
    const ti = times[spikes[i]];
    const li = labels[i] * nClusters;
    for (let j = i + 1; j < spikes.length; j++) {
      const d = Math.floor((times[spikes[j]] - ti) / binSamples);
      if (d > halfBins) break;
      c[(li + labels[j]) * nb + d]++;
    }
  }
  const w = 2 * halfBins + 1;
  const out = new Int32Array(nClusters * nClusters * w);
  for (let a = 0; a < nClusters; a++) {
    for (let b = 0; b < nClusters; b++) {
      const o = (a * nClusters + b) * w;
      const ab = (a * nClusters + b) * nb;
      const ba = (b * nClusters + a) * nb;
      for (let k = 1; k < nb; k++) {
        out[o + halfBins - k] = c[ba + k];
        out[o + halfBins + k] = c[ab + k];
      }
      out[o + halfBins] = Math.max(c[ab], c[ba]);
    }
  }
  return out;
}

export function mergeSpikeTrains(lists: Int32Array[]): { spikes: Int32Array; labels: Int32Array } {
  const k = lists.length;
  const keys = new Float64Array(lists.reduce((s, l) => s + l.length, 0));
  let o = 0;
  lists.forEach((l, label) => {
    for (const s of l) keys[o++] = s * k + label;
  });
  keys.sort();
  const spikes = new Int32Array(keys.length);
  const labels = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    labels[i] = keys[i] % k;
    spikes[i] = (keys[i] - labels[i]) / k;
  }
  return { spikes, labels };
}

/** phylib's binning: bin = int(sr·binSec) samples; window = 2·int(.5·window/bin) + 1 bins. */
export function ccgBins(binSec: number, windowSec: number, sampleRate: number): { binSamples: number; halfBins: number } {
  return {
    binSamples: Math.max(1, Math.floor(sampleRate * binSec + 1e-9)),
    halfBins: Math.floor((0.5 * windowSec) / binSec + 1e-9),
  };
}
