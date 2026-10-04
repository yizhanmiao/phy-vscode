import { describe, expect, it } from 'vitest';
import { ccgBins, correlograms, mergeSpikeTrains } from '../src/compute/correlograms';
import { buildClusterIndex, spikesOf } from '../src/compute/spikes';
import { openDataset } from '../src/host/dataset/dataset';
import { fixtureParams } from './fixtures/makeFixture';
import { flat, golden } from './helpers';

describe('correlograms', () => {
  it('matches phylib.correlograms on the fixture', async () => {
    const ds = await openDataset(fixtureParams('base'));
    const idx = buildClusterIndex(ds.spikeClusters);
    const g = golden('correlograms.json');
    const { spikes, labels } = mergeSpikeTrains(g.clusters.map((id: number) => spikesOf(idx, id)));
    const c = correlograms(ds.spikeTimes, spikes, labels, 3, g.binSamples, g.halfBins);
    expect(Array.from(c)).toEqual(flat(g.counts));
    await ds.close();
  });

  it('counts lags on a hand-checked train', () => {
    const times = Float64Array.from([0, 10, 20, 100]);
    const c = correlograms(times, Int32Array.from([0, 1, 2, 3]), Int32Array.from([0, 1, 0, 1]), 2, 10, 2);
    expect(Array.from(c)).toEqual([1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('returns zeros for a single-spike cluster', () => {
    const c = correlograms(Float64Array.from([7]), Int32Array.from([0]), Int32Array.from([0]), 1, 30, 25);
    expect(c).toHaveLength(51);
    expect(c.every((x) => x === 0)).toBe(true);
  });

  it('converts seconds to phy bins', () => {
    expect(ccgBins(0.001, 0.05, 30000)).toEqual({ binSamples: 30, halfBins: 25 });
  });

  it('merges spike trains by spike index', () => {
    const m = mergeSpikeTrains([Int32Array.from([1, 5]), Int32Array.from([2, 3])]);
    expect(Array.from(m.spikes)).toEqual([1, 2, 3, 5]);
    expect(Array.from(m.labels)).toEqual([0, 1, 1, 0]);
  });
});
