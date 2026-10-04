import { describe, expect, it } from 'vitest';
import { buildClusterIndex, spikesOf } from '../src/compute/spikes';
import { bestChannels, clusterMeanTemplate, unwhitenedTemplate } from '../src/compute/templates';
import { openDataset } from '../src/host/dataset/dataset';
import { fixtureParams } from './fixtures/makeFixture';
import { expectClose, flat, golden } from './helpers';

describe.each(['base', 'sparse'] as const)('cluster templates (%s)', (v) => {
  it('match the numpy reference', async () => {
    const ds = await openDataset(fixtureParams(v));
    try {
      const idx = buildClusterIndex(ds.spikeClusters);
      const g = golden('templates.json')[v];
      for (const [id, exp] of Object.entries<{ channels: number[]; mean: number[][]; ptp: number }>(g)) {
        const mean = clusterMeanTemplate(ds.templates!, ds.wmi, ds.nChannels, ds.spikeTemplates!, spikesOf(idx, Number(id)));
        expectClose(mean, flat(exp.mean), 1e-5);
        const { channels, amplitude } = bestChannels(mean, ds.templates!.nSamples, ds.channelPositions, ds.channelShanks);
        expect(Array.from(channels), `cluster ${id}`).toEqual(exp.channels);
        expect(amplitude[channels[0]]).toBeCloseTo(exp.ptp, 5);
      }
    } finally {
      await ds.close();
    }
  });
});

describe('bestChannels', () => {
  // 4 channels on a line; peak-to-peak 1, 5, 3, 4.
  const mean = Float64Array.from([0, 0, 0, 0, 1, 5, 3, 4]);
  const pos = Float32Array.from([0, 0, 0, 1, 0, 2, 0, 3]);
  it('keeps the n nearest channels on the peak shank, ordered by amplitude', () => {
    expect(Array.from(bestChannels(mean, 2, pos, Int32Array.from([0, 0, 0, 1]), 3).channels)).toEqual([1, 2, 0]);
    expect(Array.from(bestChannels(mean, 2, pos, Int32Array.from([0, 0, 0, 1]), 4).channels)).toEqual([1, 2, 0]);
    expect(Array.from(bestChannels(mean, 2, pos, undefined, 4).channels)).toEqual([1, 3, 2, 0]);
  });
});

describe('unwhitenedTemplate', () => {
  it('multiplies the whitened template by the inverse whitening matrix', () => {
    const T = { data: Float32Array.from([1, 2]), nTemplates: 1, nSamples: 1, nCols: 2 };
    expect(Array.from(unwhitenedTemplate(T, 0, Float64Array.from([1, 0.5, 0, 2]), 2))).toEqual([1, 4.5]);
  });
});
