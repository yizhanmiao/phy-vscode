export interface ClusterIndex {
  ids: Int32Array;
  starts: Int32Array;
  order: Int32Array;
}

export function bsearch(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid];
    if (v === x) return mid;
    if (v < x) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Counting sort of spikes by cluster; ids may be sparse and large. */
export function buildClusterIndex(clusters: Int32Array): ClusterIndex {
  const sorted = clusters.slice().sort();
  let nIds = 0;
  for (let i = 0; i < sorted.length; i++) if (nIds === 0 || sorted[i] !== sorted[nIds - 1]) sorted[nIds++] = sorted[i];
  const ids = sorted.slice(0, nIds);
  const starts = new Int32Array(nIds + 1);
  const slot = new Int32Array(clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    const k = bsearch(ids, clusters[i]);
    slot[i] = k;
    starts[k + 1]++;
  }
  for (let k = 0; k < nIds; k++) starts[k + 1] += starts[k];
  const fill = starts.slice(0, nIds);
  const order = new Int32Array(clusters.length);
  for (let i = 0; i < clusters.length; i++) order[fill[slot[i]]++] = i;
  return { ids, starts, order };
}

export function spikesOf(index: ClusterIndex, id: number): Int32Array {
  const k = bsearch(index.ids, id);
  return k < 0 ? new Int32Array(0) : index.order.subarray(index.starts[k], index.starts[k + 1]);
}

/** At most `max` spikes at a regular stride (stable across re-selection). */
export function regularSubset(spikes: Int32Array, max: number): Int32Array {
  const n = spikes.length;
  if (n <= max) return spikes;
  const out = new Int32Array(max);
  for (let i = 0; i < max; i++) out[i] = spikes[Math.floor((i * n) / max)];
  return out;
}

export function regularRange(n: number, max: number): Int32Array {
  const m = Math.min(n, max);
  const out = new Int32Array(m);
  for (let i = 0; i < m; i++) out[i] = Math.floor((i * n) / m);
  return out;
}

export function intersectSorted(a: Int32Array, b: Int32Array): Int32Array {
  const out: number[] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return Int32Array.from(out);
}
