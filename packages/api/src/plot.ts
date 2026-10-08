import type { SelectionMsg } from './protocol';

export type Rgba = readonly [number, number, number, number];
export interface Range {
  min: number;
  max: number;
}

export interface ScatterLayer {
  kind: 'scatter';
  x: Float32Array;
  y: Float32Array;
  color: Rgba;
  size: number; // CSS px
}
/** Polylines; consecutive polylines are separated by a NaN vertex. `width` is in CSS px (default 1); widths above 1 are approximated by repeated passes at pixel offsets, are capped at 8, and look uniform only when the colour is opaque, so use them on opaque lines. */
export interface LinesLayer {
  kind: 'lines';
  x: Float32Array;
  y: Float32Array;
  color: Rgba;
  width?: number;
}
/** Bars starting at x0 with width dx; `horizontal` swaps axes (bars grow along x). */
export interface BarsLayer {
  kind: 'bars';
  x0: number;
  dx: number;
  heights: Float32Array;
  color: Rgba;
  horizontal?: boolean;
}
export type Layer = ScatterLayer | LinesLayer | BarsLayer;

export interface Panel {
  row: number;
  col: number;
  x: Range;
  y: Range;
  layers: Layer[];
  axes?: boolean; // default true
  title?: string;
  xLabel?: string;
  yLabel?: string;
  vlines?: number[]; // dashed guides at these x (data units)
  hlines?: number[]; // dashed guides at these y
}

export interface Scene {
  rows: number;
  cols: number;
  panels: Panel[];
  colWeights?: number[];
  rowWeights?: number[];
  message?: string; // centred text, e.g. "Select a cluster"
}

export interface Theme {
  fg: Rgba;
  muted: Rgba;
  bg: Rgba;
}
export interface PlotClick {
  panel: number;
  x: number;
  y: number;
  shift: boolean;
  button: number;
}
/** The shared WebGL2 + Canvas2D plot layer a renderer draws a `Scene` with. */
export interface Plot {
  setScene(scene: Scene): void;
  onClick(listener: (e: PlotClick) => void): void;
  theme(): Theme;
  dispose(): void;
}

/** What a renderer can ask of its host (the plot webview shell). */
export interface RendererHost {
  /** Provider settings for this view; `setSettings` recomputes the view on the host. */
  readonly settings: Readonly<Record<string, unknown>>;
  setSettings(settings: Record<string, unknown>): void;
  /** Renderer-only UI state, persisted per dataset; no recompute. */
  getState<T>(): T | undefined;
  setState(state: unknown): void;
}

/** Webview half of a view: a mod's renderer module exports `mount`, `update` and `dispose` (or a default factory returning them). */
export interface ViewRenderer {
  mount(el: HTMLElement, plot: Plot, host: RendererHost): void;
  update(meta: unknown, buffers: ArrayBuffer[], selection: SelectionMsg): void;
  dispose(): void;
}
