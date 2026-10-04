import type { SelectionMsg } from '@theia-phy/api';
import { withAlpha } from '../../webview/plot/geometry';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Layer, type Scene } from '../../webview/plot/scene';
import type { WaveformMeta } from './provider';

export interface WaveformOptions {
  meanOnly: boolean;
  showTemplate: boolean;
}

const BUFFERS_PER_CLUSTER = 3; // waveforms, mean, template
const MEAN_WIDTH = 2.5; // mean is bold; spikes stay thin (width 1)

/** Box per channel: 90 % of the smallest spacing between distinct x (and y) positions; 40 µm when single. */
export function boxSize(positions: number[], channels: number[]): { w: number; h: number } {
  const gap = (axis: 0 | 1) => {
    const v = [...new Set(channels.map((c) => positions[2 * c + axis]))].sort((a, b) => a - b);
    let g = Infinity;
    for (let i = 1; i < v.length; i++) g = Math.min(g, v[i] - v[i - 1]);
    return Number.isFinite(g) ? g : 40;
  };
  return { w: 0.9 * gap(0), h: 0.9 * gap(1) };
}

/** phy Waveform view: every channel's traces drawn in a box at its probe position. */
export function buildWaveformScene(meta: WaveformMeta, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme, opts: WaveformOptions): Scene {
  if (meta.clusters.length === 0) return EMPTY('Select a cluster');
  const pos = meta.channelPositions;
  const all = [...new Set(meta.clusters.flatMap((c) => c.channels))];
  if (all.length === 0) return EMPTY('No channels for this selection');
  const box = boxSize(pos, all);
  const means = meta.clusters.map((_, k) => new Float32Array(buffers[k * BUFFERS_PER_CLUSTER + 1]));
  let maxAbs = 0;
  for (const m of means) for (const v of m) if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  const yScale = maxAbs > 0 ? box.h / 2 / maxAbs : 1;
  const xs = all.map((c) => pos[2 * c]);
  const ys = all.map((c) => pos[2 * c + 1]);
  const layers: Layer[] = [];

  meta.clusters.forEach((cluster, k) => {
    const nc = cluster.channels.length;
    const traces = (data: Float32Array, nTraces: number, nSamp: number) => {
      const n = nTraces * nc * (nSamp + 1);
      const x = new Float32Array(n);
      const y = new Float32Array(n);
      let o = 0;
      for (let t = 0; t < nTraces; t++) {
        for (let j = 0; j < nc; j++) {
          const cx = pos[2 * cluster.channels[j]];
          const cy = pos[2 * cluster.channels[j] + 1];
          for (let s = 0; s < nSamp; s++) {
            x[o] = cx - box.w / 2 + (nSamp > 1 ? (box.w * s) / (nSamp - 1) : 0);
            y[o] = cy + data[(t * nSamp + s) * nc + j] * yScale;
            o++;
          }
          x[o] = NaN;
          y[o] = NaN;
          o++;
        }
      }
      return { x, y };
    };
    const color = colorOf(selection, cluster.id);
    if (!opts.meanOnly && cluster.spikeIds.length) {
      layers.push({ kind: 'lines', ...traces(new Float32Array(buffers[k * BUFFERS_PER_CLUSTER]), cluster.spikeIds.length, meta.nSamples), color: withAlpha(color, 0.15) });
    }
    layers.push({ kind: 'lines', ...traces(means[k], 1, meta.nSamples), color, width: MEAN_WIDTH });
    const tmpl = new Float32Array(buffers[k * BUFFERS_PER_CLUSTER + 2] ?? new ArrayBuffer(0));
    if (opts.showTemplate && tmpl.length && meta.templateSamples) {
      layers.push({ kind: 'lines', ...traces(tmpl, 1, meta.templateSamples), color: withAlpha(theme.fg, 0.7) });
    }
  });

  return {
    rows: 1,
    cols: 1,
    panels: [
      {
        row: 0,
        col: 0,
        x: { min: Math.min(...xs) - box.w, max: Math.max(...xs) + box.w },
        y: { min: Math.min(...ys) - box.h, max: Math.max(...ys) + box.h },
        layers,
        axes: false,
      },
    ],
  };
}
