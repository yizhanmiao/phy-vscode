import { describe, expect, it } from 'vitest';
import { NeedsFileError } from '../src/host/dataset/dataset';
import { amplitudeView, type AmplitudeMeta } from '../src/views/amplitude/provider';
import { correlogramView, type CorrelogramMeta } from '../src/views/correlogram/provider';
import { builtinViews } from '../src/views';
import { builtinHistograms, clusterStatsView, type StatsMeta } from '../src/views/stats/provider';
import { SR } from './fixtures/makeFixture';
import { expectClose, flat, golden, live, openSession, viewContext } from './helpers';

describe('correlogram provider', () => {
  it('matches phylib for the selected clusters', async () => {
    const { session, ds } = await openSession('base', [2, 7, 40]);
    const r = await correlogramView.provider(viewContext(session), live);
    const meta = r.meta as CorrelogramMeta;
    expect(meta.nBins).toBe(51);
    expect(Array.from(new Int32Array(r.buffers[0]))).toEqual(flat(golden('correlograms.json').counts));
    const [n2, n7] = [2, 7].map((id) => session.spikesOf(id).length);
    expect(meta.baseline[1]).toBeCloseTo((n2 * n7 * 0.001) / ds.duration, 12);
    expect(meta.firingRates[0]).toBeCloseTo(n2 / ds.duration, 12);
  });

  it('honours bin and window settings', async () => {
    const { session } = await openSession('base', [7]);
    const r = await correlogramView.provider(viewContext(session, { binSec: 0.002, windowSec: 0.05 }), live);
    expect((r.meta as CorrelogramMeta).nBins).toBe(25);
  });

  it('returns zeros for a single-spike cluster', async () => {
    const { session } = await openSession('base', [50]);
    const r = await correlogramView.provider(viewContext(session), live);
    expect(new Int32Array(r.buffers[0]).every((x) => x === 0)).toBe(true);
  });
});

describe('amplitude provider', () => {
  it('returns times and amplitudes of sampled spikes', async () => {
    const { session, ds } = await openSession('base', [2]);
    const r = await amplitudeView.provider(viewContext(session), live);
    const spikes = session.spikesOf(2);
    expect((r.meta as AmplitudeMeta).clusters).toEqual([{ id: 2, n: spikes.length }]);
    expect(Array.from(new Float32Array(r.buffers[1]))).toEqual(Array.from(spikes, (s) => ds.amplitudes![s]));
    expect(new Float32Array(r.buffers[0])[0]).toBeCloseTo(ds.spikeTimes[spikes[0]] / SR, 6);
  });

  it('needs amplitudes.npy', async () => {
    const { session } = await openSession('minimal', [0]);
    await expect(amplitudeView.provider(viewContext(session), live)).rejects.toThrow(NeedsFileError);
  });
});

describe('cluster statistics provider', () => {
  it('computes ISI and firing-rate histograms per cluster', async () => {
    const { session, ds } = await openSession('base', [7, 2]);
    const r = await clusterStatsView(builtinHistograms).provider(viewContext(session), live);
    const meta = r.meta as StatsMeta;
    expect(meta.clusters).toEqual([7, 2]);
    expect(meta.histograms.map((h) => h.id)).toEqual(['isi', 'firing_rate']);
    expect(meta.histograms[1].range).toEqual([0, ds.duration]);
    expect(r.buffers).toHaveLength(4);
    const g = golden('histograms.json');
    expect(Array.from(new Float64Array(r.buffers[0]))).toEqual(g.isi);
    expectClose(new Float64Array(r.buffers[2]), g.firingRate, 1e-9);
  });

  it('returns nothing for an empty selection', async () => {
    const { session } = await openSession('base');
    expect((await clusterStatsView(builtinHistograms).provider(viewContext(session), live)).buffers).toEqual([]);
  });
});

describe('builtinViews', () => {
  it('lists the five v1 plot views', () => {
    expect(builtinViews.map((v) => v.id)).toEqual(['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics']);
  });
});
