import type { HistogramDefinition } from '@phy-vscode/api';
import { firingRateHistogram, isiHistogram, ISI } from '../../compute/histograms';
import { checkCancel, type BuiltinView } from '../types';

export interface StatsMeta {
  clusters: number[];
  histograms: { id: string; label: string; unit?: string; range?: [number, number] }[];
}

export const builtinHistograms: HistogramDefinition[] = [
  {
    id: 'isi',
    label: 'ISI',
    unit: 'ms',
    range: () => [0, ISI.maxMs],
    compute: (spikes, { session }) => isiHistogram(session.dataset.spikeTimes, spikes, session.dataset.sampleRate),
  },
  {
    id: 'firing_rate',
    label: 'Firing rate (Hz)',
    unit: 's',
    range: ({ session }) => [0, session.dataset.duration],
    compute: (spikes, { session }) => {
      const ds = session.dataset;
      return firingRateHistogram(ds.spikeTimes, spikes, ds.sampleRate, ds.duration);
    },
  },
];

export function clusterStatsView(histograms: readonly HistogramDefinition[]): BuiltinView {
  return {
    id: 'cluster_statistics',
    title: 'Cluster statistics',
    async provider({ session }, token) {
      const ctx = { session };
      const buffers: ArrayBufferLike[] = [];
      for (const h of histograms) {
        for (const id of session.selection) {
          checkCancel(token);
          buffers.push(h.compute(session.spikesOf(id), ctx).buffer);
        }
      }
      const meta: StatsMeta = {
        clusters: [...session.selection],
        histograms: histograms.map((h) => ({ id: h.id, label: h.label, unit: h.unit, range: h.range?.(ctx) })),
      };
      return { meta, buffers };
    },
  };
}
