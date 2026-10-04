import type { SelectionMsg } from '@phy-vscode/api';
import { parseColor } from './geometry';
import type { Plot, Theme } from './plot';
import type { Rgba, Scene } from './scene';

/** What a renderer can ask of its host (the plot webview shell). */
export interface RendererHost {
  /** Provider settings for this view; `setSettings` recomputes the view on the host. */
  readonly settings: Readonly<Record<string, unknown>>;
  setSettings(settings: Record<string, unknown>): void;
  /** Renderer-only UI state, persisted per dataset; no recompute. */
  getState<T>(): T | undefined;
  setState(state: unknown): void;
}

/** Webview half of a view (spec §6: { mount(el, plot), update(meta, buffers, selection), dispose() }). */
export interface ViewRenderer {
  mount(el: HTMLElement, plot: Plot, host: RendererHost): void;
  update(meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg): void;
  dispose(): void;
}

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

/** The Session colour of `id` within this selection (grey when not selected). */
export function colorOf(selection: SelectionMsg, id: number, alpha?: number): Rgba {
  const i = selection.ids.indexOf(id);
  return parseColor(i < 0 ? '#808080' : selection.colors[i], alpha);
}
