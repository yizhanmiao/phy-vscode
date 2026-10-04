import { ccgBins, mergeSpikeTrains } from '../../compute/correlograms';
import { checkCancel, type BuiltinView } from '../types';

export const CORRELOGRAM = { binSec: 0.001, windowSec: 0.05 } as const;
export interface CorrelogramMeta {
  clusters: number[];
  binSec: number;
  windowSec: number;
  nBins: number;
  firingRates: number[];
  baseline: number[];
}

const positive = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0 ? v : fallback);

export const correlogramView: BuiltinView = {
  id: 'correlogram',
  title: 'Correlogram',
  async provider({ session, compute, settings }, token) {
    const ds = session.dataset;
    const sel = [...session.selection];
    const binSec = positive(settings.binSec, CORRELOGRAM.binSec);
    const windowSec = positive(settings.windowSec, CORRELOGRAM.windowSec);
    const { binSamples, halfBins } = ccgBins(binSec, windowSec, ds.sampleRate);
    const lists = sel.map((id) => session.spikesOf(id));
    const { spikes, labels } = mergeSpikeTrains(lists);
    checkCancel(token);
    const counts = await compute.run('correlograms', ds.spikeTimes, spikes, labels, sel.length, binSamples, halfBins);
    checkCancel(token);
    const n = lists.map((l) => l.length);
    const meta: CorrelogramMeta = {
      clusters: sel,
      binSec,
      windowSec,
      nBins: 2 * halfBins + 1,
      firingRates: n.map((c) => c / ds.duration),
      baseline: n.flatMap((a) => n.map((b) => (a * b * binSec) / ds.duration)),
    };
    return { meta, buffers: [counts.buffer] };
  },
};
