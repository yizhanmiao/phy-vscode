import { bsearch, intersectSorted, regularRange, regularSubset } from '../../compute/spikes';
import { NeedsFileError, type Dataset, type Features } from '../../host/dataset/dataset';
import { convert } from '../../host/dataset/npy';
import { checkCancel, type BuiltinView } from '../types';

export const FEATURE = { maxSpikes: 10_000, maxBackground: 10_000, nChannels: 4, nPcs: 3 } as const;
export interface FeatureMeta {
  channels: number[];
  nPcs: number;
  groups: { id: number | null; n: number }[];
}

export const featureView: BuiltinView = {
  id: 'feature',
  title: 'Feature',
  async provider({ session }, token) {
    const ds = session.dataset;
    const F = ds.features;
    const st = ds.spikeTemplates;
    if (!F) throw new NeedsFileError('pc_features.npy');
    if (!st) throw new NeedsFileError('spike_templates.npy');
    const sel = session.selection;
    if (sel.length === 0) return { meta: { channels: [], nPcs: 0, groups: [] } satisfies FeatureMeta, buffers: [] };

    const templateChannels = (s: number) => F.ind.subarray(st[s] * F.nLoc, (st[s] + 1) * F.nLoc);
    const withFeatures = (spikes: Int32Array) => (F.spikeIds ? intersectSorted(spikes, F.spikeIds) : spikes);
    const channels = (session.bestChannels(sel[0]) ?? templateChannels(session.spikesOf(sel[0])[0])).slice(0, FEATURE.nChannels);
    const nPcs = Math.min(FEATURE.nPcs, F.nPcs);
    const background = Int32Array.from(regularRange(F.spikeIds?.length ?? ds.nSpikes, FEATURE.maxBackground), (r) => F.spikeIds?.[r] ?? r)
      .filter((s) => templateChannels(s).includes(channels[0]));
    const groups = [
      { id: null as number | null, spikes: background },
      ...sel.map((id) => ({ id: id as number | null, spikes: regularSubset(withFeatures(session.spikesOf(id)), FEATURE.maxSpikes) })),
    ];

    const buffers: ArrayBufferLike[] = [];
    for (const g of groups) {
      checkCancel(token);
      const { feats, times } = await readFeatures(ds, F, g.spikes, channels, nPcs);
      buffers.push(feats.buffer, times.buffer);
    }
    checkCancel(token);
    const meta: FeatureMeta = { channels: Array.from(channels), nPcs, groups: groups.map((g) => ({ id: g.id, n: g.spikes.length })) };
    return { meta, buffers };
  },
};

async function readFeatures(ds: Dataset, F: Features, spikes: Int32Array, channels: Int32Array, nPcs: number) {
  const rows = F.spikeIds ? Array.from(spikes, (s) => bsearch(F.spikeIds!, s)) : spikes;
  const data = convert(await F.file.readRows(rows), Float32Array);
  const nc = channels.length;
  const rowLen = F.nPcs * F.nLoc;
  const feats = new Float32Array(spikes.length * nc * nPcs).fill(NaN);
  const times = new Float32Array(spikes.length);
  spikes.forEach((s, i) => {
    times[i] = ds.spikeTimes[s] / ds.sampleRate;
    const t = ds.spikeTemplates![s];
    const ind = F.ind.subarray(t * F.nLoc, (t + 1) * F.nLoc);
    for (let j = 0; j < nc; j++) {
      const l = ind.indexOf(channels[j]);
      if (l >= 0) for (let p = 0; p < nPcs; p++) feats[(i * nc + j) * nPcs + p] = data[i * rowLen + p * F.nLoc + l];
    }
  });
  return { feats, times };
}
