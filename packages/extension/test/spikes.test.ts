import { describe, expect, it } from 'vitest';
import { bsearch, buildClusterIndex, intersectSorted, regularRange, regularSubset, spikesOf } from '../src/compute/spikes';
import { rng } from './fixtures/makeFixture';

describe('cluster index', () => {
  it('groups spikes by sparse, large cluster ids in ascending spike order', () => {
    const r = rng(3);
    const pool = [5, 1_000_000_000, 7, 42];
    const clusters = Int32Array.from({ length: 1000 }, () => pool[Math.floor(r() * pool.length)]);
    const idx = buildClusterIndex(clusters);
    expect(Array.from(idx.ids)).toEqual([5, 7, 42, 1_000_000_000]);
    let total = 0;
    for (const id of pool) {
      const s = Array.from(spikesOf(idx, id));
      total += s.length;
      expect(s).toEqual(Array.from(clusters.keys()).filter((i) => clusters[i] === id));
    }
    expect(total).toBe(1000);
    expect(spikesOf(idx, 6)).toHaveLength(0);
  });
});

describe('subsets', () => {
  it('uses a deterministic regular stride', () => {
    const s = Int32Array.from({ length: 10 }, (_, i) => 100 + i);
    expect(Array.from(regularSubset(s, 3))).toEqual([100, 103, 106]);
    expect(regularSubset(s, 10)).toBe(s);
    expect(Array.from(regularRange(10, 4))).toEqual([0, 2, 5, 7]);
    expect(Array.from(regularRange(3, 10))).toEqual([0, 1, 2]);
  });
  it('searches and intersects sorted arrays', () => {
    const a = Int32Array.from([1, 3, 5, 7]);
    expect(bsearch(a, 5)).toBe(2);
    expect(bsearch(a, 4)).toBe(-1);
    expect(Array.from(intersectSorted(a, Int32Array.from([0, 3, 4, 7, 9])))).toEqual([3, 7]);
  });
});
