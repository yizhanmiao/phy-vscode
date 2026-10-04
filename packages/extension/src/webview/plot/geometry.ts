import type { Rgba } from './scene';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const AXIS_INSET: Insets = { left: 40, right: 6, top: 14, bottom: 18 };
export const BARE_INSET: Insets = { left: 2, right: 2, top: 12, bottom: 2 };

/** Cell rectangles (CSS px, y down), row-major. */
export function gridRects(width: number, height: number, rows: number, cols: number, gap = 4, colWeights?: number[], rowWeights?: number[]): Rect[] {
  const cw = colWeights ?? new Array<number>(cols).fill(1);
  const rw = rowWeights ?? new Array<number>(rows).fill(1);
  const tw = cw.reduce((a, b) => a + b, 0);
  const th = rw.reduce((a, b) => a + b, 0);
  const availW = Math.max(0, width - gap * (cols - 1));
  const availH = Math.max(0, height - gap * (rows - 1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let c = 0, x = 0; c < cols; c++) {
    xs.push(x);
    x += (availW * cw[c]) / tw + gap;
  }
  for (let r = 0, y = 0; r < rows; r++) {
    ys.push(y);
    y += (availH * rw[r]) / th + gap;
  }
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ x: xs[c], y: ys[r], w: (availW * cw[c]) / tw, h: (availH * rw[r]) / th });
  }
  return out;
}

export const inset = (r: Rect, m: Insets): Rect => ({
  x: r.x + m.left,
  y: r.y + m.top,
  w: Math.max(0, r.w - m.left - m.right),
  h: Math.max(0, r.h - m.top - m.bottom),
});

/** [x0,y0,x1,y1,…] for points whose x and y are finite. */
export function interleave(x: ArrayLike<number>, y: ArrayLike<number>): Float32Array {
  const out = new Float32Array(2 * x.length);
  let o = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      out[o++] = x[i];
      out[o++] = y[i];
    }
  }
  return out.slice(0, o);
}

/** Vertex pairs for gl.LINES from NaN-separated polylines. */
export function polylineSegments(x: ArrayLike<number>, y: ArrayLike<number>): Float32Array {
  const out = new Float32Array(4 * Math.max(0, x.length - 1));
  let o = 0;
  for (let i = 1; i < x.length; i++) {
    if (Number.isFinite(x[i - 1]) && Number.isFinite(y[i - 1]) && Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      out[o++] = x[i - 1];
      out[o++] = y[i - 1];
      out[o++] = x[i];
      out[o++] = y[i];
    }
  }
  return out.slice(0, o);
}

/** Two triangles per bar; horizontal bars swap x and y. */
export function barTriangles(x0: number, dx: number, heights: ArrayLike<number>, horizontal: boolean): Float32Array {
  const out = new Float32Array(12 * heights.length);
  for (let i = 0; i < heights.length; i++) {
    const a = x0 + i * dx;
    const b = a + dx;
    const h = heights[i];
    const quad = [a, 0, b, 0, b, h, a, 0, b, h, a, h];
    for (let k = 0; k < 12; k += 2) {
      out[12 * i + k] = horizontal ? quad[k + 1] : quad[k];
      out[12 * i + k + 1] = horizontal ? quad[k] : quad[k + 1];
    }
  }
  return out;
}

const GREY: Rgba = [0.5, 0.5, 0.5, 1];

/** CSS colour (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) → RGBA in 0..1. */
export function parseColor(css: string, alpha?: number): Rgba {
  const s = css.trim();
  let c: Rgba = GREY;
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) c = [...m[1].split('').map((h) => parseInt(h + h, 16) / 255), 1] as unknown as Rgba;
  else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) {
    const v = (i: number) => parseInt(m![1].slice(i, i + 2), 16) / 255;
    c = [v(0), v(2), v(4), m[2] ? parseInt(m[2], 16) / 255 : 1];
  } else if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s))) {
    c = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] === undefined ? 1 : Number(m[4])];
  }
  return alpha === undefined ? c : withAlpha(c, alpha);
}

export const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

export const toCss = (c: Rgba): string => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;
