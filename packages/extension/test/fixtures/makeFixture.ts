import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NumArray } from '../../src/host/dataset/npy';
import { writeNpy } from './npyWrite';

export const SR = 30000;
export const N_SAMPLES = 60000;
export const N_CHANNELS_DAT = 8;
export const NS_TEMPLATE = 31;
export const CHANNEL_MAP = [0, 1, 2, 3, 5, 6];
export const POSITIONS = [[0, 0], [16, 20], [0, 40], [16, 60], [0, 80], [16, 100]];
export const SHANKS = [0, 0, 0, 0, 1, 1];
export const CLUSTER_IDS = [2, 7, 11, 40, 50];
const PEAKS = [0, 2, 3, 4];
const RATES = [120, 100, 50, 30]; // Hz
const TEMPLATE_CLUSTER = [2, 7, 40, 40];

export const VARIANTS = ['base', 'fortran', 'sparse', 'subset', 'templates2d', 'noraw', 'badraw', 'precomputed', 'minimal'] as const;
export type Variant = (typeof VARIANTS)[number];
export const OUT = fileURLToPath(new URL('./out', import.meta.url));
export const fixtureDir = (v: Variant) => join(OUT, v);
export const fixtureParams = (v: Variant) => join(OUT, v, 'params.py');

/** mulberry32: small deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function nearest(c0: number): number[] {
  const [x0, y0] = POSITIONS[c0];
  const d = (c: number) => (POSITIONS[c][0] - x0) ** 2 + (POSITIONS[c][1] - y0) ** 2;
  return POSITIONS.map((_, c) => c).sort((a, b) => d(a) - d(b) || a - b);
}

interface Model {
  times: number[];
  templates: Int32Array;
  clusters: Int32Array;
  amps: Float32Array;
  tw: Float32Array;
  W: Float64Array;
  Winv: Float64Array;
  raw: Int16Array;
  pc: Float32Array;
  pcInd: Uint32Array;
}

function buildModel(): Model {
  const r = rng(42);
  const nC = CHANNEL_MAP.length;
  const nT = PEAKS.length;

  // Whitening: three 2×2 blocks [[1, .25], [.25, 1]] with a closed-form inverse.
  const W = new Float64Array(nC * nC);
  const Winv = new Float64Array(nC * nC);
  const det = 1 - 0.25 * 0.25;
  for (let b = 0; b < nC; b += 2) {
    W[b * nC + b] = W[(b + 1) * nC + b + 1] = 1;
    W[b * nC + b + 1] = W[(b + 1) * nC + b] = 0.25;
    Winv[b * nC + b] = Winv[(b + 1) * nC + b + 1] = 1 / det;
    Winv[b * nC + b + 1] = Winv[(b + 1) * nC + b] = -0.25 / det;
  }

  // Unwhitened templates: negative peak at sample 10, decaying with distance, zero on other shanks.
  const tu = new Float64Array(nT * NS_TEMPLATE * nC);
  for (let t = 0; t < nT; t++) {
    for (let c = 0; c < nC; c++) {
      const [px, py] = POSITIONS[PEAKS[t]];
      const [x, y] = POSITIONS[c];
      const g = SHANKS[c] === SHANKS[PEAKS[t]] ? Math.exp(-Math.hypot(x - px, y - py) / 30) : 0;
      for (let s = 0; s < NS_TEMPLATE; s++) {
        tu[(t * NS_TEMPLATE + s) * nC + c] = g * (-4 * Math.exp(-(((s - 10) / 2) ** 2)) + 1.6 * Math.exp(-(((s - 16) / 4) ** 2)));
      }
    }
  }
  // Kilosort stores whitened templates tw = tu · W; phy unwhitens with tw · W⁻¹.
  const tw = new Float32Array(tu.length);
  for (let row = 0; row < nT * NS_TEMPLATE; row++) {
    for (let j = 0; j < nC; j++) {
      let acc = 0;
      for (let k = 0; k < nC; k++) acc += tu[row * nC + k] * W[k * nC + j];
      tw[row * nC + j] = acc;
    }
  }

  // Spikes: Poisson trains with a 2 ms refractory period, plus one spike at each recording edge.
  const spikes: [number, number][] = [[5, 0], [N_SAMPLES - 3, 0]];
  for (let t = 0; t < nT; t++) {
    for (let s = 100 + Math.floor(r() * 300); s < N_SAMPLES - 100; s += 60 + Math.floor(-Math.log(1 - r()) * (SR / RATES[t]))) {
      spikes.push([s, t]);
    }
  }
  spikes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = spikes.length;
  const templates = Int32Array.from(spikes, ([, t]) => t);
  const clusters = Int32Array.from(spikes, ([, t]) => TEMPLATE_CLUSTER[t]);
  let k1 = 0;
  for (let i = 0; i < n; i++) if (templates[i] === 1 && k1++ % 5 === 0) clusters[i] = 11;
  clusters[templates.findIndex((t, i) => t === 0 && i >= 100)] = 50;

  const amps = Float32Array.from(spikes, () => 15 + 10 * r());
  const rawF = new Float64Array(N_SAMPLES * N_CHANNELS_DAT);
  for (let i = 0; i < N_SAMPLES; i++) {
    const drift = 100 * Math.sin((2 * Math.PI * 2 * i) / SR);
    for (let ch = 0; ch < N_CHANNELS_DAT; ch++) rawF[i * N_CHANNELS_DAT + ch] = drift + 3 * gauss(r);
  }
  spikes.forEach(([s, t], i) => {
    for (let k = 0; k < NS_TEMPLATE; k++) {
      const smp = s - 10 + k;
      if (smp < 0 || smp >= N_SAMPLES) continue;
      for (let c = 0; c < nC; c++) rawF[smp * N_CHANNELS_DAT + CHANNEL_MAP[c]] += amps[i] * tu[(t * NS_TEMPLATE + k) * nC + c];
    }
  });
  const raw = Int16Array.from(rawF, Math.round);

  const pcInd = new Uint32Array(nT * 4);
  for (let t = 0; t < nT; t++) pcInd.set(nearest(PEAKS[t]).slice(0, 4), t * 4);
  const pc = new Float32Array(n * 3 * 4);
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < 3; p++) {
      for (let j = 0; j < 4; j++) pc[(i * 3 + p) * 4 + j] = gauss(r) + (templates[i] + 1) * (p + 1) * (j === 0 ? 1 : 0.5);
    }
  }
  return { times: spikes.map(([s]) => s), templates, clusters, amps, tw, W, Winv, raw, pc, pcInd };
}

function writeVariant(v: Variant, m: Model): void {
  const dir = fixtureDir(v);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = m.times.length;
  const nC = CHANNEL_MAP.length;
  const nT = PEAKS.length;
  const F = v === 'fortran';
  const w = (name: string, data: NumArray, shape: number[], fortran = false) => writeNpy(join(dir, name), data, shape, { fortran });

  const datPath = v === 'noraw' ? 'missing.bin' : v === 'minimal' ? '' : 'raw.bin';
  writeFileSync(
    join(dir, 'params.py'),
    `# generated by test/fixtures/makeFixture.ts\ndat_path = r'${datPath}'\nn_channels_dat = ${N_CHANNELS_DAT}\ndtype = 'int16'\noffset = 0\nsample_rate = ${SR}.\nhp_filtered = False\n`,
  );

  if (v === 'subset') w('spike_times.npy', BigInt64Array.from(m.times, BigInt), [n]);
  else w('spike_times.npy', BigUint64Array.from(m.times, BigInt), F ? [n, 1] : [n], F);
  if (v === 'templates2d') w('spike_templates.npy', Int32Array.from({ length: 2 * n }, (_, i) => m.templates[i >> 1]), [n, 2]);
  else w('spike_templates.npy', m.templates, [n]);
  if (v !== 'templates2d' && v !== 'minimal') w('spike_clusters.npy', m.clusters, [n]);
  w('channel_map.npy', Int32Array.from(CHANNEL_MAP), [nC]);
  w('channel_positions.npy', Float32Array.from(POSITIONS.flat()), [nC, 2]);
  if (v === 'minimal') return;

  w('channel_shanks.npy', Int32Array.from(SHANKS), [nC]);
  w('amplitudes.npy', F ? Float64Array.from(m.amps) : m.amps, F ? [n, 1] : [n], F);
  w('whitening_mat.npy', Float32Array.from(m.W), [nC, nC]);
  if (v !== 'noraw') w('whitening_mat_inv.npy', Float32Array.from(m.Winv), [nC, nC], F);
  if (v === 'sparse') {
    const cols = new Int32Array(nT * 3);
    const data = new Float32Array(nT * NS_TEMPLATE * 3);
    for (let t = 0; t < nT; t++) {
      const near = nearest(PEAKS[t]).slice(0, 3);
      if (t === 1) near[2] = -1; // unused column (phy convention)
      cols.set(near, t * 3);
      for (let s = 0; s < NS_TEMPLATE; s++) {
        near.forEach((c, k) => {
          if (c >= 0) data[(t * NS_TEMPLATE + s) * 3 + k] = m.tw[(t * NS_TEMPLATE + s) * nC + c];
        });
      }
    }
    w('templates.npy', data, [nT, NS_TEMPLATE, 3]);
    w('template_ind.npy', cols, [nT, 3]);
  } else {
    w('templates.npy', m.tw, [nT, NS_TEMPLATE, nC], F);
  }
  // Kilosort's templates_ind.npy (with an s) must be ignored: phy treats templates as dense.
  w('templates_ind.npy', BigInt64Array.from({ length: nT * nC }, (_, i) => BigInt(i % nC)), [nT, nC]);
  if (v === 'subset') {
    const ids = Array.from({ length: Math.ceil(n / 2) }, (_, i) => 2 * i);
    w('pc_feature_spike_ids.npy', BigInt64Array.from(ids, BigInt), [ids.length]);
    const rows = new Float32Array(ids.length * 12);
    ids.forEach((s, i) => rows.set(m.pc.subarray(s * 12, s * 12 + 12), i * 12));
    w('pc_features.npy', rows, [ids.length, 3, 4]);
  } else {
    w('pc_features.npy', m.pc, [n, 3, 4], F);
  }
  w('pc_feature_ind.npy', m.pcInd, [nT, 4]);

  writeFileSync(join(dir, 'cluster_group.tsv'), 'cluster_id\tgroup\r\n2\tgood\r\n7\tmua\r\n11\tnoise\r\n40\tgood\r\n50\t\r\n99\tgood\r\n');
  writeFileSync(join(dir, 'cluster_KSLabel.tsv'), 'cluster_id\tKSLabel\n2\tgood\n7\tmua\n11\tmua\n40\tgood\n50\tmua\n');
  writeFileSync(join(dir, 'cluster_ContamPct.tsv'), 'cluster_id\tContamPct\n2\t1.5\n7\t20.0\n11\t85.4\n40\t0.0\n50\tnan\n');
  writeFileSync(join(dir, 'cluster_info.tsv'), 'cluster_id\tignored_field\n2\t1\n');

  if (datPath === 'raw.bin') {
    const bytes = Buffer.from(m.raw.buffer, m.raw.byteOffset, m.raw.byteLength);
    writeFileSync(join(dir, 'raw.bin'), v === 'badraw' ? bytes.subarray(0, bytes.length - 3) : bytes);
  }
  if (v === 'precomputed') {
    const sub = Array.from({ length: Math.ceil(n / 3) }, (_, i) => 3 * i);
    w('_phy_spikes_subset.spikes.npy', BigInt64Array.from(sub, BigInt), [sub.length]);
    w('_phy_spikes_subset.channels.npy', Int32Array.from({ length: sub.length * 4 }, (_, i) => m.pcInd[m.templates[sub[i >> 2]] * 4 + (i & 3)]), [sub.length, 4]);
    w('_phy_spikes_subset.waveforms.npy', Float32Array.from({ length: sub.length * 41 * 4 }, (_, i) => i % 997), [sub.length, 41, 4]);
  }
}

export function makeAllFixtures(): void {
  const m = buildModel();
  for (const v of VARIANTS) writeVariant(v, m);
}
