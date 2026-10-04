import { regularSubset } from '../../compute/spikes';
import { NeedsFileError } from '../../host/dataset/dataset';
import { checkCancel, type BuiltinView } from '../types';

export const AMPLITUDE = { maxSpikes: 20_000 } as const;
export interface AmplitudeMeta {
  clusters: { id: number; n: number }[];
}

export const amplitudeView: BuiltinView = {
  id: 'amplitude',
  title: 'Amplitude',
  async provider({ session }, token) {
    const ds = session.dataset;
    const amps = ds.amplitudes;
    if (!amps) throw new NeedsFileError('amplitudes.npy');
    const meta: AmplitudeMeta = { clusters: [] };
    const buffers: ArrayBufferLike[] = [];
    for (const id of session.selection) {
      checkCancel(token);
      const ids = regularSubset(session.spikesOf(id), AMPLITUDE.maxSpikes);
      buffers.push(Float32Array.from(ids, (s) => ds.spikeTimes[s] / ds.sampleRate).buffer, Float32Array.from(ids, (s) => amps[s]).buffer);
      meta.clusters.push({ id, n: ids.length });
    }
    return { meta, buffers };
  },
};
