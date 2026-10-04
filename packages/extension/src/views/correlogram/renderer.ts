import type { SelectionMsg } from '@phy-vscode/api';
import type { Plot } from '../../webview/plot/plot';
import { addToolbar, type RendererHost, type ViewRenderer } from '../../webview/plot/renderer';
import type { CorrelogramMeta } from './provider';
import { buildCorrelogramScene } from './scene';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bin and window inputs (ms) recompute on the host via provider settings; values are clamped to sane ranges. */
export default (): ViewRenderer => {
  let plot: Plot | undefined;
  let bin: HTMLInputElement | undefined;
  let win: HTMLInputElement | undefined;
  return {
    mount(el, p, host: RendererHost) {
      plot = p;
      const bar = addToolbar(el);
      const input = (label: string, value: unknown, fallback: number) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.step = 'any';
        i.value = String(typeof value === 'number' ? value * 1000 : fallback);
        const l = document.createElement('label');
        l.append(`${label} `, i);
        bar.append(l);
        return i;
      };
      bin = input('bin ms', host.settings.binSec, 1);
      win = input('window ms', host.settings.windowSec, 50);
      const apply = () => {
        const b = clamp(Number(bin!.value) || 1, 0.1, 100);
        const w = clamp(Number(win!.value) || 50, 2 * b, 2000);
        bin!.value = String(b);
        win!.value = String(w);
        host.setSettings({ binSec: b / 1000, windowSec: w / 1000 });
      };
      bin.onchange = apply;
      win.onchange = apply;
    },
    update(meta, buffers, selection: SelectionMsg) {
      const m = meta as CorrelogramMeta;
      if (bin && document.activeElement !== bin) bin.value = String(m.binSec * 1000);
      if (win && document.activeElement !== win) win.value = String(m.windowSec * 1000);
      if (plot) plot.setScene(buildCorrelogramScene(m, buffers, selection, plot.theme()));
    },
    dispose() {
      plot = undefined;
    },
  };
};
