import { bsearch, intersectSorted, regularSubset } from '../../compute/spikes';
import { unwhitenedTemplate } from '../../compute/templates';
import { NeedsFileError, type SpikeSubset } from '../../host/dataset/dataset';
import { convert } from '../../host/dataset/npy';
import type { RawData } from '../../host/dataset/raw';
import { checkCancel, type BuiltinView, type HostViewContext } from '../types';

export const WAVEFORM = { maxSpikes: 100, before: 40, after: 42, pad: 200 } as const;
export type WaveformSource = 'precomputed' | 'raw' | 'template';
export interface WaveformMeta {
  source: WaveformSource;
  notice?: string;
  nSamples: number;
  templateSamples: number;
  channelPositions: number[];
  clusters: { id: number; channels: number[]; spikeIds: number[] }[];
}

export const waveformView: BuiltinView = {
  id: 'waveform',
  title: 'Waveform',
  async provider(ctx, token) {
    const { session } = ctx;
    const ds = session.dataset;
    if (!ds.templates) throw new NeedsFileError('templates.npy');
    if (!ds.spikeTemplates) throw new NeedsFileError('spike_templates.npy');
    const raw = ds.raw;
    const sub = ds.spikeSubset;
    const source: WaveformSource = sub ? 'precomputed' : raw.ok ? 'raw' : 'template';
    const nSamples = sub ? sub.nSamples : raw.ok ? WAVEFORM.before + WAVEFORM.after : ds.templates.nSamples;
    const meta: WaveformMeta = {
      source,
      notice: !sub && !raw.ok ? `${raw.reason} — showing templates` : undefined,
      nSamples,
      templateSamples: ds.templates.nSamples,
      channelPositions: Array.from(ds.channelPositions),
      clusters: [],
    };
    const buffers: ArrayBufferLike[] = [];
    for (const id of session.selection) {
      checkCancel(token);
      const channels = session.bestChannels(id)!;
      const spikes = sub ? intersectSorted(session.spikesOf(id), sub.spikes) : session.spikesOf(id);
      const ids = regularSubset(spikes, WAVEFORM.maxSpikes);
      const wf = sub
        ? await precomputedWaveforms(sub, ids, channels)
        : raw.ok
          ? await rawWaveforms(ctx, raw.raw, ids, channels)
          : templateWaveforms(ctx, ids, channels);
      checkCancel(token);
      meta.clusters.push({ id, channels: Array.from(channels), spikeIds: Array.from(ids) });
      buffers.push(wf.buffer, meanWaveform(wf, ids.length, nSamples * channels.length).buffer, templateOnChannels(ctx, id, ids, channels).buffer);
    }
    return { meta, buffers };
  },
};

function meanWaveform(wf: Float32Array, n: number, size: number): Float32Array {
  const m = new Float32Array(size);
  for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) m[k] += wf[i * size + k] / n;
  return m;
}

/** Mean unwhitened template of the cluster on `channels`, scaled by the mean amplitude of the sampled spikes. */
function templateOnChannels(ctx: HostViewContext, id: number, ids: Int32Array, channels: Int32Array): Float32Array {
  const { session } = ctx;
  const ds = session.dataset;
  const m = session.meanTemplate(id);
  if (!m || !ds.templates) return new Float32Array(0);
  let amp = 1;
  if (ds.amplitudes && ids.length) {
    amp = 0;
    for (const s of ids) amp += ds.amplitudes[s];
    amp /= ids.length;
  }
  const ns = ds.templates.nSamples;
  const nc = channels.length;
  const out = new Float32Array(ns * nc);
  for (let s = 0; s < ns; s++) for (let j = 0; j < nc; j++) out[s * nc + j] = m[s * ds.nChannels + channels[j]] * amp;
  return out;
}

/** Raw windows around each spike on `channels`, high-passed (unless hp_filtered) and median-subtracted. */
export async function rawWaveforms(ctx: HostViewContext, raw: RawData, ids: Int32Array, channels: Int32Array): Promise<Float32Array> {
  const ds = ctx.session.dataset;
  const { before, after, pad } = WAVEFORM;
  const length = before + after + 2 * pad;
  const nc = channels.length;
  const all = await raw.readWindows(Array.from(ids, (s) => ds.spikeTimes[s] - before - pad), length);
  const picked = new Float32Array(ids.length * length * nc);
  for (let r = 0; r < ids.length * length; r++) {
    for (let j = 0; j < nc; j++) picked[r * nc + j] = all[r * raw.nChannels + ds.channelMap[channels[j]]];
  }
  return ctx.compute.run('processWindows', picked, {
    nWindows: ids.length, length, nChannels: nc, pad, sampleRate: ds.sampleRate, highpass: !ds.params.hpFiltered,
  });
}

async function precomputedWaveforms(sub: SpikeSubset, ids: Int32Array, channels: Int32Array): Promise<Float32Array> {
  const rows = Array.from(ids, (s) => bsearch(sub.spikes, s));
  const data = convert(await sub.waveforms.readRows(rows), Float32Array);
  const { nSamples: ns, nChannels: nsc } = sub;
  const nc = channels.length;
  const out = new Float32Array(ids.length * ns * nc);
  rows.forEach((row, w) => {
    for (let j = 0; j < nc; j++) {
      let k = 0;
      while (k < nsc && sub.channels[row * nsc + k] !== channels[j]) k++;
      if (k === nsc) continue;
      for (let t = 0; t < ns; t++) out[(w * ns + t) * nc + j] = data[(w * ns + t) * nsc + k];
    }
  });
  return out;
}

/** Template fallback: each spike's unwhitened template × its amplitude (1 without amplitudes.npy). */
function templateWaveforms(ctx: HostViewContext, ids: Int32Array, channels: Int32Array): Float32Array {
  const ds = ctx.session.dataset;
  const T = ds.templates!;
  const ns = T.nSamples;
  const nc = channels.length;
  const cache = new Map<number, Float64Array>();
  const out = new Float32Array(ids.length * ns * nc);
  ids.forEach((s, w) => {
    const t = ds.spikeTemplates![s];
    let u = cache.get(t);
    if (!u) {
      u = unwhitenedTemplate(T, t, ds.wmi, ds.nChannels);
      cache.set(t, u);
    }
    const amp = ds.amplitudes ? ds.amplitudes[s] : 1;
    for (let k = 0; k < ns; k++) for (let j = 0; j < nc; j++) out[(w * ns + k) * nc + j] = u[k * ds.nChannels + channels[j]] * amp;
  });
  return out;
}
