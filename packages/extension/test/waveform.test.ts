import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NeedsFileError } from '../src/host/dataset/dataset';
import { readNpy } from '../src/host/dataset/npy';
import { Cancelled } from '../src/views/types';
import { rawWaveforms, waveformView, type WaveformMeta } from '../src/views/waveform/provider';
import { fixtureDir, NS_TEMPLATE } from './fixtures/makeFixture';
import { expectClose, flat, golden, live, openSession, viewContext } from './helpers';

const g = golden('waveforms.json');

describe('waveform provider', () => {
  it('extracts filtered raw waveforms on the best channels', async () => {
    const { session } = await openSession('base', [7]);
    const r = await waveformView.provider(viewContext(session), live);
    const meta = r.meta as WaveformMeta;
    expect(meta.source).toBe('raw');
    expect(meta.notice).toBeUndefined();
    expect(meta.nSamples).toBe(82);
    const c = meta.clusters[0];
    expect(c.channels).toEqual(g.cluster.channels);
    expect(c.spikeIds.slice(0, 3)).toEqual(g.cluster.spikeIds);
    const size = 82 * c.channels.length;
    const wf = new Float32Array(r.buffers[0]);
    expectClose(wf.subarray(0, 3 * size), flat(g.cluster.waveforms), 1e-3);
    const mean = new Float32Array(r.buffers[1]);
    expect(mean).toHaveLength(size);
    const avg0 = c.spikeIds.reduce((s, _, i) => s + wf[i * size], 0) / c.spikeIds.length;
    expect(mean[0]).toBeCloseTo(avg0, 3);
  });

  it('zero-pads windows of spikes at the recording edges', async () => {
    const { session } = await openSession('base');
    const raw = session.dataset.raw;
    if (!raw.ok) throw new Error(raw.reason);
    const wf = await rawWaveforms(viewContext(session), raw.raw, Int32Array.from(g.edge.spikeIds), Int32Array.from(g.edge.channels));
    expectClose(wf, flat(g.edge.waveforms), 1e-3);
  });

  it.each([
    ['noraw', /^raw data not found: .*missing\.bin — showing templates$/],
    ['badraw', /inconsistent with n_channels_dat=8, dtype=i2, offset=0 — showing templates$/],
  ] as const)('falls back to templates when raw data is unusable (%s)', async (v, notice) => {
    const { session, ds } = await openSession(v, [7]);
    const meta = (await waveformView.provider(viewContext(session), live)) as { meta: WaveformMeta; buffers: ArrayBuffer[] };
    expect(meta.meta.source).toBe('template');
    expect(meta.meta.notice).toMatch(notice);
    expect(meta.meta.nSamples).toBe(NS_TEMPLATE);
    // Cluster 7 has a single template, so each waveform is that template × the spike's amplitude.
    const tmpl = golden('templates.json').base['7'].mean as number[][];
    const c = meta.meta.clusters[0];
    const wf = new Float32Array(meta.buffers[0]);
    c.channels.forEach((ch, j) => expect(wf[10 * c.channels.length + j]).toBeCloseTo(tmpl[10][ch] * ds.amplitudes![c.spikeIds[0]], 2));
  });

  it('prefers precomputed _phy_spikes_subset waveforms', async () => {
    const { session } = await openSession('precomputed', [7]);
    const r = await waveformView.provider(viewContext(session), live);
    const meta = r.meta as WaveformMeta;
    expect(meta.source).toBe('precomputed');
    expect(meta.nSamples).toBe(41);
    const c = meta.clusters[0];
    expect(c.spikeIds.every((s) => s % 3 === 0)).toBe(true);
    const chans = (await readNpy(join(fixtureDir('precomputed'), '_phy_spikes_subset.channels.npy'))).data as Int32Array;
    const row = c.spikeIds[0] / 3;
    const rowCh = Array.from(chans.subarray(row * 4, row * 4 + 4));
    const wf = new Float32Array(r.buffers[0]);
    c.channels.forEach((ch, j) => {
      const k = rowCh.indexOf(ch);
      expect(wf[5 * c.channels.length + j]).toBe(k < 0 ? 0 : ((row * 41 + 5) * 4 + k) % 997);
    });
  });

  it('needs templates.npy', async () => {
    const { session } = await openSession('minimal', [0]);
    await expect(waveformView.provider(viewContext(session), live)).rejects.toThrow(NeedsFileError);
    await expect(waveformView.provider(viewContext(session), live)).rejects.toThrow('needs templates.npy');
  });

  it('handles an empty selection and a single-spike cluster', async () => {
    const { session } = await openSession('base');
    expect(await waveformView.provider(viewContext(session), live)).toMatchObject({ buffers: [] });
    session.select([50]);
    const r = await waveformView.provider(viewContext(session), live);
    expect((r.meta as WaveformMeta).clusters[0].spikeIds).toHaveLength(1);
    expect(r.buffers).toHaveLength(2);
  });

  it('stops when cancelled', async () => {
    const { session } = await openSession('base', [7]);
    await expect(waveformView.provider(viewContext(session), { isCancellationRequested: true })).rejects.toBeInstanceOf(Cancelled);
  });
});
