import { describe, expect, it } from 'vitest';
import { firingRateHistogram, histogram, isiHistogram } from '../src/compute/histograms';
import { buildClusterIndex, spikesOf } from '../src/compute/spikes';
import { openDataset } from '../src/host/dataset/dataset';
import { fixtureParams, SR } from './fixtures/makeFixture';
import { expectClose, golden } from './helpers';

describe('histograms', () => {
  it('follows numpy.histogram edge rules', () => {
    expect(Array.from(histogram([0, 0.5, 1, 1.5, 2, 2.5, -1], 0, 2, 2))).toEqual([2, 3]);
  });

  it('matches numpy for ISI and firing rate', async () => {
    const ds = await openDataset(fixtureParams('base'));
    const g = golden('histograms.json');
    const s = spikesOf(buildClusterIndex(ds.spikeClusters), g.cluster);
    expect(ds.duration).toBeCloseTo(g.duration, 12);
    expect(Array.from(isiHistogram(ds.spikeTimes, s, SR))).toEqual(g.isi);
    expectClose(firingRateHistogram(ds.spikeTimes, s, SR, ds.duration), g.firingRate, 1e-9);
    await ds.close();
  });

  it('returns zeros for a single spike', () => {
    const h = isiHistogram(Float64Array.from([10, 20]), Int32Array.from([1]), SR);
    expect(h).toHaveLength(100);
    expect(h.every((x) => x === 0)).toBe(true);
  });
});
