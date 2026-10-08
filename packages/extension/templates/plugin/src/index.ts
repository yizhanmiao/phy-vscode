import { join } from 'node:path';
import type { PhyApi } from '@phy-vscode/api';

/** Refused at load if this phy-vscode's API is not compatible. */
export const apiVersion = '^0.2.0';

export function activate(api: PhyApi): void {
  // A column in the Clusters table. Return a number or a string; anything else leaves the cell empty.
  api.registerClusterMetric({
    id: 'spike_share',
    label: 'Share of all spikes',
    compute: (clusterId, { session }) => session.spikesOf(clusterId).length / session.dataset.nSpikes,
  });

  // A panel in the Cluster statistics view: counts of this cluster's spikes in 20 equal slices of the recording.
  const BINS = 20;
  api.registerHistogram({
    id: 'spikes_over_time',
    label: 'Spikes over time',
    unit: 's',
    range: ({ session }) => [0, session.dataset.duration],
    compute(spikeIds, { session }) {
      const { spikeTimes, sampleRate, duration } = session.dataset;
      const h = new Float64Array(BINS);
      for (const i of spikeIds) h[Math.min(BINS - 1, Math.floor((spikeTimes[i] / sampleRate / duration) * BINS))]++;
      return h;
    },
  });

  // A whole new view. The provider runs here and its result goes to renderer.js in the webview.
  api.registerView({
    id: 'spike_counts',
    title: 'Spike counts',
    rendererScript: { fsPath: join(__dirname, 'renderer.js') },
    async provider({ session }) {
      const counts = Float32Array.from(session.selection, (id) => session.spikesOf(id).length);
      return { meta: {}, buffers: [counts.buffer] };
    },
  });
}
