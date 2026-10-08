import type { Rgba, Scene } from './plot';
import type { SelectionMsg } from './protocol';

const GREY: Rgba = [0.5, 0.5, 0.5, 1];

export const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

/** `#rgb`, `#rrggbb[aa]` or `rgb[a](…)` to 0–1 components; anything else is grey. */
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

/** The Session colour of `id` within this selection (grey when not selected). */
export function colorOf(selection: SelectionMsg, id: number, alpha?: number): Rgba {
  const i = selection.ids.indexOf(id);
  return parseColor(i < 0 ? '#808080' : selection.colors[i], alpha);
}

/** A scene that shows only a centred message, e.g. "Select a cluster". */
export const emptyScene = (message: string): Scene => ({ rows: 1, cols: 1, panels: [], message });
