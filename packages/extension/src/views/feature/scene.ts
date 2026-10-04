import type { SelectionMsg } from '@phy-vscode/api';
import { withAlpha } from '../../webview/plot/geometry';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Layer, type Panel, type Scene } from '../../webview/plot/scene';
import { paddedRange } from '../../webview/plot/view';
import type { FeatureMeta } from './provider';

export type Dim = { kind: 'time' } | { kind: 'pc'; ch: number; pc: number };

/** phy's default feature grid: "<x>,<y>" per cell; <ch index><PC letter> or "time". */
export const DEFAULT_GRID: string[][] = [
  ['time,0A', '1A,0A', '0B,0A', '1B,0A'],
  ['0A,1A', 'time,1A', '0B,1A', '1B,1A'],
  ['0A,0B', '1A,0B', 'time,0B', '1B,0B'],
  ['0A,1B', '1A,1B', '0B,1B', 'time,1B'],
];

const CELL = /^(time|\d+[A-Z]),(time|\d+[A-Z])$/;

/** `x` if it is a non-empty rectangular grid of well-formed "<x>,<y>" cells (e.g. persisted state), else undefined. */
export function validGrid(x: unknown): string[][] | undefined {
  if (!Array.isArray(x) || !Array.isArray(x[0]) || x[0].length === 0) return undefined;
  const n = x[0].length;
  return x.every((row) => Array.isArray(row) && row.length === n && row.every((c) => typeof c === 'string' && CELL.test(c))) ? (x as string[][]) : undefined;
}

export function parseDim(s: string): Dim {
  if (s === 'time') return { kind: 'time' };
  const m = /^(\d+)([A-Z])$/.exec(s);
  if (!m) throw new Error(`bad feature dimension '${s}'`);
  return { kind: 'pc', ch: Number(m[1]), pc: m[2].charCodeAt(0) - 65 };
}

export const formatDim = (d: Dim): string => (d.kind === 'time' ? 'time' : `${d.ch}${String.fromCharCode(65 + d.pc)}`);

export function dimValues(d: Dim, feats: Float32Array, times: Float32Array, nCh: number, nPcs: number): Float32Array {
  if (d.kind === 'time') return times;
  const out = new Float32Array(times.length);
  if (d.ch >= nCh || d.pc >= nPcs) return out.fill(NaN);
  for (let i = 0; i < times.length; i++) out[i] = feats[(i * nCh + d.ch) * nPcs + d.pc];
  return out;
}

export function cycleDim(s: string, by: 'pc' | 'channel', nCh: number, nPcs: number): string {
  const d = parseDim(s);
  if (d.kind === 'time') return s;
  return formatDim(by === 'pc' ? { ...d, pc: (d.pc + 1) % Math.max(1, nPcs) } : { ...d, ch: (d.ch + 1) % Math.max(1, nCh) });
}

export function buildFeatureScene(meta: FeatureMeta, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme, grid: string[][] = DEFAULT_GRID): Scene {
  if (meta.groups.length === 0 || meta.nPcs === 0) return EMPTY('Select a cluster');
  const nCh = meta.channels.length;
  const nPcs = meta.nPcs;
  const groups = meta.groups.map((g, k) => ({ g, feats: new Float32Array(buffers[2 * k]), times: new Float32Array(buffers[2 * k + 1]) }));
  const label = (d: Dim) => (d.kind === 'time' ? 'time' : `ch${meta.channels[d.ch] ?? '?'}${String.fromCharCode(65 + d.pc)}`);
  const panels: Panel[] = [];
  grid.forEach((row, r) =>
    row.forEach((cell, c) => {
      const [sx, sy] = cell.split(',');
      const dx = parseDim(sx);
      const dy = parseDim(sy);
      const xs: Float32Array[] = [];
      const ys: Float32Array[] = [];
      const layers: Layer[] = groups.map(({ g, feats, times }) => {
        const x = dimValues(dx, feats, times, nCh, nPcs);
        const y = dimValues(dy, feats, times, nCh, nPcs);
        xs.push(x);
        ys.push(y);
        return g.id === null
          ? { kind: 'scatter', x, y, color: withAlpha(theme.muted, 0.35), size: 2 }
          : { kind: 'scatter', x, y, color: colorOf(selection, g.id, 0.8), size: 3 };
      });
      panels.push({ row: r, col: c, x: paddedRange(...xs), y: paddedRange(...ys), layers, axes: false, title: `${label(dx)} / ${label(dy)}` });
    }),
  );
  return { rows: grid.length, cols: grid[0]?.length ?? 0, panels };
}
