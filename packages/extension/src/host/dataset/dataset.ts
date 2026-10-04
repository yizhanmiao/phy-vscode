import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Cell, DatasetReader } from '@theia-phy/api';
import { invert } from '../../compute/linalg';
import { cOrderCopy } from './fortranCache';
import { convert, NpyFile, readNpy, type NpyArray } from './npy';
import { readParams, type Params } from './params';
import { RawData, type RawStatus } from './raw';
import { readClusterMetadata } from './tsv';

export class DatasetError extends Error {}
export class NeedsFileError extends Error {
  constructor(readonly file: string) {
    super(`needs ${file}`);
  }
}

export interface Templates {
  data: Float32Array; // nTemplates × nSamples × nCols, whitened
  nTemplates: number;
  nSamples: number;
  nCols: number;
  cols?: Int32Array; // sparse only: nTemplates × nCols channel ids, -1 = unused
}
export interface Features {
  file: NpyFile; // (nRows, nPcs, nLoc), C order
  ind: Int32Array; // nTemplates × nLoc channel ids
  nPcs: number;
  nLoc: number;
  spikeIds?: Int32Array; // sorted; row r holds spike spikeIds[r]
}
export interface SpikeSubset {
  spikes: Int32Array; // sorted
  channels: Int32Array; // nSubset × nChannels
  waveforms: NpyFile; // (nSubset, nSamples, nChannels)
  nSamples: number;
  nChannels: number;
}
export interface Dataset extends DatasetReader {
  readonly paramsPath: string;
  readonly params: Params;
  readonly templates?: Templates;
  readonly wmi: Float64Array; // nChannels × nChannels
  readonly features?: Features;
  readonly spikeSubset?: SpikeSubset;
  readonly raw: RawStatus;
  readonly metadata: Map<string, Map<number, Cell>>;
  close(): Promise<void>;
}
export interface OpenOptions {
  cacheDir?: string;
  onProgress?: (message: string, fraction?: number) => void;
}

type Ctor<T> = { new (buffer: ArrayBufferLike): T; BYTES_PER_ELEMENT: number };

function perSpike<T extends Int32Array | Float32Array | Float64Array>(a: NpyArray, name: string, C: Ctor<T>, n?: number): T {
  const [len, cols = 1, ...more] = a.shape;
  if (len === undefined || more.length > 0 || (cols !== 1 && !(cols === 2 && name === 'spike_templates.npy'))) {
    throw new DatasetError(`${name} has unsupported shape (${a.shape.join(', ')})`);
  }
  if (n !== undefined && len !== n) throw new DatasetError(`${name} has shape (${a.shape.join(', ')}) but spike_times.npy has ${n} spikes`);
  return convert(a.data, C, { shared: true, stride: cols });
}

const isSorted = (a: ArrayLike<number>) => {
  for (let i = 1; i < a.length; i++) if (a[i] < a[i - 1]) return false;
  return true;
};

export async function openDataset(paramsPath: string, opts: OpenOptions = {}): Promise<Dataset> {
  const abs = resolve(paramsPath);
  const dir = dirname(abs);
  const params = await readParams(abs);
  const cacheDir = opts.cacheDir ?? join(tmpdir(), 'theia-phy-cache');
  const file = (name: string) => join(dir, name);
  const has = (name: string) => existsSync(file(name));
  const need = async (name: string, shared = false) => {
    if (!has(name)) throw new DatasetError(`missing required file ${name}`);
    return readNpy(file(name), { shared });
  };
  const maybe = async (name: string, shared = false) => (has(name) ? readNpy(file(name), { shared }) : undefined);
  const openRows = async (name: string) => {
    const f = await NpyFile.open(file(name));
    if (!f.header.fortranOrder) return f;
    await f.close();
    return NpyFile.open(await cOrderCopy(file(name), cacheDir, (fr) => opts.onProgress?.(`Converting ${name} to C order`, fr)));
  };

  opts.onProgress?.('Loading spikes');
  const spikeTimes = perSpike(await need('spike_times.npy', true), 'spike_times.npy', Float64Array);
  const nSpikes = spikeTimes.length;
  if (!isSorted(spikeTimes)) throw new DatasetError('spike_times.npy is not sorted');
  const tpl = await maybe('spike_templates.npy', true);
  const clu = await maybe('spike_clusters.npy', true);
  if (!tpl && !clu) throw new DatasetError('missing required file spike_clusters.npy or spike_templates.npy');
  const spikeTemplates = tpl && perSpike(tpl, 'spike_templates.npy', Int32Array, nSpikes);
  const spikeClusters = clu ? perSpike(clu, 'spike_clusters.npy', Int32Array, nSpikes) : spikeTemplates!;
  const amp = await maybe('amplitudes.npy', true);
  const amplitudes = amp && perSpike(amp, 'amplitudes.npy', Float32Array, nSpikes);

  const channelMap = convert((await need('channel_map.npy')).data, Int32Array);
  const nChannels = channelMap.length;
  const pos = await need('channel_positions.npy');
  if (pos.shape[0] !== nChannels || pos.shape[1] !== 2) {
    throw new DatasetError(`channel_positions.npy has shape (${pos.shape.join(', ')}) but channel_map.npy has ${nChannels} channels`);
  }
  const channelPositions = convert(pos.data, Float32Array);
  const sh = await maybe('channel_shanks.npy');
  const channelShanks = sh && convert(sh.data, Int32Array);
  if (channelShanks && channelShanks.length !== nChannels) {
    throw new DatasetError(`channel_shanks.npy has ${channelShanks.length} channels but channel_map.npy has ${nChannels}`);
  }

  opts.onProgress?.('Loading templates');
  let templates: Templates | undefined;
  const tArr = await maybe('templates.npy');
  if (tArr) {
    if (tArr.shape.length !== 3) throw new DatasetError(`templates.npy has unsupported shape (${tArr.shape.join(', ')})`);
    const [nTemplates, nSamples, nCols] = tArr.shape;
    const ind = await maybe('template_ind.npy'); // phy name; KS's templates_ind.npy is deliberately ignored
    const cols = ind && convert(ind.data, Int32Array);
    if (cols && cols.length !== nTemplates * nCols) {
      throw new DatasetError(`template_ind.npy has shape (${ind!.shape.join(', ')}) but templates.npy has (${tArr.shape.join(', ')})`);
    }
    if (!cols && nCols !== nChannels) throw new DatasetError(`templates.npy has ${nCols} channels but channel_map.npy has ${nChannels}`);
    const data = convert(tArr.data, Float32Array);
    for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) data[i] = 0; // phy zeroes empty (NaN) templates
    templates = { data, nTemplates, nSamples, nCols, cols };
  }

  const square = (a: NpyArray, name: string) => {
    if (a.shape[0] !== nChannels || a.shape[1] !== nChannels) {
      throw new DatasetError(`${name} has shape (${a.shape.join(', ')}) but channel_map.npy has ${nChannels} channels`);
    }
    return convert(a.data, Float64Array);
  };
  const wmiArr = await maybe('whitening_mat_inv.npy');
  const wmArr = wmiArr ? undefined : await maybe('whitening_mat.npy');
  let wmi: Float64Array;
  if (wmiArr) wmi = square(wmiArr, 'whitening_mat_inv.npy');
  else if (wmArr) {
    try {
      wmi = invert(square(wmArr, 'whitening_mat.npy'), nChannels);
    } catch {
      throw new DatasetError('whitening_mat.npy is singular');
    }
  } else {
    wmi = new Float64Array(nChannels * nChannels);
    for (let i = 0; i < nChannels; i++) wmi[i * nChannels + i] = 1;
  }

  let features: Features | undefined;
  if (has('pc_features.npy') && has('pc_feature_ind.npy')) {
    const f = await openRows('pc_features.npy');
    const shp = f.header.shape;
    const ids = await maybe('pc_feature_spike_ids.npy');
    const spikeIds = ids && convert(ids.data, Int32Array);
    if (spikeIds && !isSorted(spikeIds)) throw new DatasetError('pc_feature_spike_ids.npy is not sorted');
    const nRows = spikeIds?.length ?? nSpikes;
    if (shp.length !== 3 || shp[0] !== nRows) {
      throw new DatasetError(`pc_features.npy has shape (${shp.join(', ')}) but ${spikeIds ? 'pc_feature_spike_ids.npy' : 'spike_times.npy'} has ${nRows} spikes`);
    }
    const ind = convert((await need('pc_feature_ind.npy')).data, Int32Array);
    features = { file: f, ind, nPcs: shp[1], nLoc: shp[2], spikeIds };
  }

  let spikeSubset: SpikeSubset | undefined;
  const sub = '_phy_spikes_subset';
  if (has(`${sub}.waveforms.npy`) && has(`${sub}.channels.npy`) && has(`${sub}.spikes.npy`)) {
    const waveforms = await openRows(`${sub}.waveforms.npy`);
    const [, nSamples, nCh] = waveforms.header.shape;
    const spikes = convert((await need(`${sub}.spikes.npy`)).data, Int32Array);
    if (!isSorted(spikes)) throw new DatasetError(`${sub}.spikes.npy is not sorted`);
    spikeSubset = { spikes, channels: convert((await need(`${sub}.channels.npy`)).data, Int32Array), waveforms, nSamples, nChannels: nCh };
  }

  let raw = await RawData.open(params, dir);
  if (raw.ok) {
    const nDat = raw.raw.nChannels;
    const bad = channelMap.find((c) => c >= nDat);
    if (bad !== undefined) {
      await raw.raw.close();
      raw = { ok: false, reason: `channel_map.npy refers to channel ${bad} but n_channels_dat is ${params.nChannelsDat}` };
    }
  }
  const metadata = await readClusterMetadata(dir);

  return {
    dir,
    paramsPath: abs,
    params,
    sampleRate: params.sampleRate,
    nSpikes,
    nChannels,
    duration: nSpikes ? (spikeTimes[nSpikes - 1] + 1) / params.sampleRate : 0,
    spikeTimes,
    spikeClusters,
    spikeTemplates,
    amplitudes,
    channelMap,
    channelPositions,
    channelShanks,
    templates,
    wmi,
    features,
    spikeSubset,
    raw,
    metadata,
    async close() {
      await features?.file.close();
      await spikeSubset?.waveforms.close();
      if (raw.ok) await raw.raw.close();
    },
  };
}
