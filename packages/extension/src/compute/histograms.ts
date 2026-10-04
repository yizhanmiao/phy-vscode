/** numpy.histogram(values, bins=nBins, range=(lo, hi)) for uniform bins, including its edge corrections. */
export function histogram(values: ArrayLike<number>, lo: number, hi: number, nBins: number): Float64Array {
  const counts = new Float64Array(nBins);
  const step = (hi - lo) / nBins;
  const edge = (i: number) => (i === nBins ? hi : i * step + lo);
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (!(v >= lo && v <= hi)) continue;
    let i = Math.trunc(((v - lo) / (hi - lo)) * nBins);
    if (i === nBins) i--;
    if (v < edge(i)) i--;
    else if (i !== nBins - 1 && v >= edge(i + 1)) i++;
    counts[i]++;
  }
  return counts;
}

export const ISI = { maxMs: 50, nBins: 100 } as const;
export const FIRING_RATE_BINS = 100;

export function isiHistogram(times: Float64Array, spikes: Int32Array, sampleRate: number): Float64Array {
  const isi = new Float64Array(Math.max(0, spikes.length - 1));
  for (let i = 1; i < spikes.length; i++) isi[i - 1] = ((times[spikes[i]] - times[spikes[i - 1]]) / sampleRate) * 1000;
  return histogram(isi, 0, ISI.maxMs, ISI.nBins);
}

export function firingRateHistogram(times: Float64Array, spikes: Int32Array, sampleRate: number, duration: number): Float64Array {
  const t = Float64Array.from(spikes, (s) => times[s] / sampleRate);
  const width = duration / FIRING_RATE_BINS;
  return histogram(t, 0, duration, FIRING_RATE_BINS).map((c) => c / width);
}
