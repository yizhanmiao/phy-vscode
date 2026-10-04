import type { SelectionMsg } from '@phy-vscode/api';
import type { Plot } from '../../webview/plot/plot';
import type { RendererHost, ViewRenderer } from '../../webview/plot/renderer';
import type { FeatureMeta } from './provider';
import { buildFeatureScene, cycleDim, DEFAULT_GRID, validGrid } from './scene';

/** Click a subplot to cycle its y feature's PC; shift-click cycles its channel. */
export default (): ViewRenderer => {
  let plot: Plot | undefined;
  let host: RendererHost | undefined;
  let last: { meta: FeatureMeta; buffers: ArrayBuffer[]; selection: SelectionMsg } | undefined;
  const grid = (): string[][] => validGrid(host?.getState<{ grid: unknown }>()?.grid) ?? DEFAULT_GRID;
  const redraw = () => {
    if (plot && last) plot.setScene(buildFeatureScene(last.meta, last.buffers, last.selection, plot.theme(), grid()));
  };
  return {
    mount(_el, p, h) {
      plot = p;
      host = h;
      p.onClick((e) => {
        if (!last) return;
        const g = grid().map((row) => [...row]);
        const cols = g[0].length;
        const r = Math.floor(e.panel / cols);
        const c = e.panel % cols;
        const [x, y] = g[r][c].split(',');
        g[r][c] = `${x},${cycleDim(y, e.shift ? 'channel' : 'pc', last.meta.channels.length, last.meta.nPcs)}`;
        h.setState({ grid: g });
        redraw();
      });
    },
    update(meta, buffers, selection) {
      last = { meta: meta as FeatureMeta, buffers, selection };
      redraw();
    },
    dispose() {
      last = undefined;
      plot = undefined;
    },
  };
};
