import { colorOf, emptyScene, type Plot, type RendererHost, type SelectionMsg } from '@phy-vscode/api';

let plot: Plot | undefined;

export function mount(_el: HTMLElement, p: Plot, _host: RendererHost): void {
  plot = p;
}

export function update(_meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg): void {
  const counts = new Float32Array(buffers[0] ?? new ArrayBuffer(0));
  if (!plot) return;
  if (counts.length === 0) {
    plot.setScene(emptyScene('Select a cluster'));
    return;
  }
  plot.setScene({
    rows: 1,
    cols: 1,
    panels: [
      {
        row: 0,
        col: 0,
        title: 'Spikes per selected cluster',
        x: { min: 0, max: counts.length },
        y: { min: 0, max: Math.max(...counts) * 1.05 || 1 },
        layers: Array.from(counts, (c, i) => ({ kind: 'bars' as const, x0: i + 0.1, dx: 0.8, heights: Float32Array.of(c), color: colorOf(selection, selection.ids[i]) })),
      },
    ],
  });
}

export function dispose(): void {
  plot = undefined;
}
