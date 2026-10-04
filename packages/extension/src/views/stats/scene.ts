import type { SelectionMsg } from '@theia-phy/api';
import type { Theme } from '../../webview/plot/plot';
import { colorOf } from '../../webview/plot/renderer';
import { EMPTY, type Panel, type Scene } from '../../webview/plot/scene';
import type { StatsMeta } from './provider';

/** Outline of a histogram as a polyline: each bin's top edge, joined by vertical steps. */
export function stepLine(h: Float64Array, x0: number, dx: number): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(2 * h.length);
  const y = new Float32Array(2 * h.length);
  for (let i = 0; i < h.length; i++) {
    x[2 * i] = x0 + i * dx;
    x[2 * i + 1] = x0 + (i + 1) * dx;
    y[2 * i] = h[i];
    y[2 * i + 1] = h[i];
  }
  return { x, y };
}

export function buildStatsScene(meta: StatsMeta, buffers: ArrayBuffer[], selection: SelectionMsg, _theme: Theme): Scene {
  const nc = meta.clusters.length;
  if (nc === 0 || meta.histograms.length === 0) return EMPTY('Select a cluster');
  const panels: Panel[] = meta.histograms.map((def, r) => {
    const hs = meta.clusters.map((_, k) => new Float64Array(buffers[r * nc + k] ?? new ArrayBuffer(0)));
    const nb = hs[0]?.length ?? 0;
    const [lo, hiRaw] = def.range ?? [0, nb];
    const hi = hiRaw > lo ? hiRaw : lo + 1;
    const dx = nb ? (hi - lo) / nb : 1;
    let ymax = 0;
    for (const h of hs) for (const v of h) if (v > ymax) ymax = v;
    return {
      row: r,
      col: 0,
      x: { min: lo, max: hi },
      y: { min: 0, max: (ymax > 0 ? ymax : 1) * 1.05 },
      layers: hs.map((h, k) => ({ kind: 'lines' as const, ...stepLine(h, lo, dx), color: colorOf(selection, meta.clusters[k]) })),
      title: def.label,
      xLabel: def.unit,
    };
  });
  return { rows: panels.length, cols: 1, panels };
}
