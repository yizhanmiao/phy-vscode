import type { SelectionMsg } from '@phy-vscode/api';
import { histogram } from '../../compute/histograms';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Layer, type Scene } from '../../webview/plot/scene';
import { paddedRange } from '../../webview/plot/view';
import type { AmplitudeMeta } from './provider';

export const AMP_BINS = 50;

export function buildAmplitudeScene(meta: AmplitudeMeta, buffers: ArrayBuffer[], selection: SelectionMsg, _theme: Theme): Scene {
  if (meta.clusters.length === 0) return EMPTY('Select a cluster');
  const times = meta.clusters.map((_, k) => new Float32Array(buffers[2 * k]));
  const amps = meta.clusters.map((_, k) => new Float32Array(buffers[2 * k + 1]));
  const x = paddedRange(...times);
  const y = paddedRange(...amps);
  const dy = (y.max - y.min) / AMP_BINS;
  const scatter: Layer[] = meta.clusters.map((c, k) => ({ kind: 'scatter', x: times[k], y: amps[k], color: colorOf(selection, c.id, 0.6), size: 2 }));
  const hists: Layer[] = meta.clusters.map((c, k) => {
    const h = histogram(amps[k], y.min, y.max, AMP_BINS);
    let peak = 0;
    for (const v of h) if (v > peak) peak = v;
    return { kind: 'bars', x0: y.min, dx: dy, heights: Float32Array.from(h, (v) => v / (peak || 1)), color: colorOf(selection, c.id, 0.5), horizontal: true };
  });
  return {
    rows: 1,
    cols: 2,
    colWeights: [4, 1],
    panels: [
      { row: 0, col: 0, x, y, layers: scatter, xLabel: 'time (s)', yLabel: 'amplitude' },
      { row: 0, col: 1, x: { min: 0, max: 1.05 }, y, layers: hists, axes: false },
    ],
  };
}
