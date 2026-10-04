import type { SelectionMsg } from '@theia-phy/api';
import { withAlpha } from '../../webview/plot/geometry';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Panel, type Scene } from '../../webview/plot/scene';
import type { CorrelogramMeta } from './provider';

export const REFRACTORY_MS = 2;

/** n×n auto/cross-correlograms; bars centred on 0 lag, in ms. */
export function buildCorrelogramScene(meta: CorrelogramMeta, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme): Scene {
  const n = meta.clusters.length;
  if (n === 0) return EMPTY('Select a cluster');
  const counts = new Int32Array(buffers[0]);
  const nb = meta.nBins;
  const binMs = meta.binSec * 1000;
  const half = (nb * binMs) / 2;
  const showAxes = n <= 3;
  const panels: Panel[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const heights = Float32Array.from(counts.subarray((i * n + j) * nb, (i * n + j + 1) * nb));
      const base = meta.baseline[i * n + j] ?? 0;
      let ymax = base;
      for (const v of heights) if (v > ymax) ymax = v;
      panels.push({
        row: i,
        col: j,
        x: { min: -half, max: half },
        y: { min: 0, max: (ymax > 0 ? ymax : 1) * 1.05 },
        layers: [{ kind: 'bars', x0: -half, dx: binMs, heights, color: i === j ? colorOf(selection, meta.clusters[i]) : withAlpha(theme.fg, 0.55) }],
        vlines: [-REFRACTORY_MS, REFRACTORY_MS],
        hlines: [base],
        axes: showAxes,
        title: i === 0 ? String(meta.clusters[j]) : undefined,
        xLabel: showAxes && i === n - 1 ? 'ms' : undefined,
      });
    }
  }
  return { rows: n, cols: n, panels };
}
