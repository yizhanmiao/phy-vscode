import type { SelectionMsg } from '@theia-phy/api';
import type { Plot } from '../../webview/plot/plot';
import { addToolbar, type RendererHost, type ViewRenderer } from '../../webview/plot/renderer';
import type { WaveformMeta } from './provider';
import { buildWaveformScene, type WaveformOptions } from './scene';

export default (): ViewRenderer => {
  let plot: Plot | undefined;
  let host: RendererHost | undefined;
  let last: { meta: WaveformMeta; buffers: ArrayBuffer[]; selection: SelectionMsg } | undefined;
  const opts = (): WaveformOptions => ({ meanOnly: false, showTemplate: false, ...host?.getState<Partial<WaveformOptions>>() });
  const redraw = () => {
    if (plot && last) plot.setScene(buildWaveformScene(last.meta, last.buffers, last.selection, plot.theme(), opts()));
  };
  return {
    mount(el, p, h) {
      plot = p;
      host = h;
      const bar = addToolbar(el);
      for (const [key, label] of [['meanOnly', 'mean only'], ['showTemplate', 'template']] as const) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = opts()[key];
        box.onchange = () => {
          h.setState({ ...opts(), [key]: box.checked });
          redraw();
        };
        const lab = document.createElement('label');
        lab.append(box, ` ${label}`);
        bar.append(lab);
      }
    },
    update(meta, buffers, selection) {
      last = { meta: meta as WaveformMeta, buffers, selection };
      redraw();
    },
    dispose() {
      last = undefined;
      plot = undefined;
    },
  };
};
