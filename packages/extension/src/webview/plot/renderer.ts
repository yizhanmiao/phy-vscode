import type { Plot, SelectionMsg, Theme, ViewRenderer } from '@phy-vscode/api';
import type { Scene } from './scene';

export type { RendererHost, ViewRenderer } from '@phy-vscode/api';
export { colorOf } from '@phy-vscode/api';

export type SceneBuilder = (meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg, theme: Theme) => Scene;

/** Renderer for views with no interaction: rebuild the scene on every update. */
export function sceneRenderer(build: SceneBuilder): () => ViewRenderer {
  return () => {
    let plot: Plot | undefined;
    return {
      mount(_el, p) {
        plot = p;
      },
      update(meta, buffers, selection) {
        if (plot) plot.setScene(build(meta, buffers, selection, plot.theme()));
      },
      dispose() {
        plot = undefined;
      },
    };
  };
}

/** Small control row between a view's header and its plot body (`el`); it takes layout space instead of covering the plot. */
export function addToolbar(el: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'phy-toolbar';
  if (el.parentElement) el.before(bar);
  else el.append(bar);
  return bar;
}
