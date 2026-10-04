import type { Range } from './view';

export type Rgba = readonly [number, number, number, number];

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

export const EMPTY = (message: string): Scene => ({ rows: 1, cols: 1, panels: [], message });
