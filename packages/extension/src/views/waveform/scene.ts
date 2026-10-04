import type { SelectionMsg } from '@phy-vscode/api';
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

/**
 * Box per channel: 90 % of the smallest spacing between distinct x positions for the width, and of the smallest y gap between
 * channels sharing a column (x distance < box width) for the height, so a staggered probe's other column cannot shrink it.
 * 40 µm when there is no such spacing.
 */
export function boxSize(positions: number[], channels: number[]): { w: number; h: number } {
  const xs = [...new Set(channels.map((c) => positions[2 * c]))].sort((a, b) => a - b);
  let gx = Infinity;
  for (let i = 1; i < xs.length; i++) gx = Math.min(gx, xs[i] - xs[i - 1]);
  const w = 0.9 * (Number.isFinite(gx) ? gx : 40);
  let gy = Infinity;
  for (let i = 0; i < channels.length; i++) {
    for (let j = i + 1; j < channels.length; j++) {
      const dy = Math.abs(positions[2 * channels[i] + 1] - positions[2 * channels[j] + 1]);
      if (dy > 0 && Math.abs(positions[2 * channels[i]] - positions[2 * channels[j]]) < w) gy = Math.min(gy, dy);
    }
  }
  return { w, h: 0.9 * (Number.isFinite(gy) ? gy : 40) };
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
