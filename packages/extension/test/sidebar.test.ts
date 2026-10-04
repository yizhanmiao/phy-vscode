import type { Cell } from '@theia-phy/api';
import { describe, expect, it } from 'vitest';
import { parseFilter } from '../src/webview/sidebar/filter';
import { clickSelect, isPlainArrow } from '../src/webview/sidebar/selection';
import { formatCell, groupTint, sortRows, visibleRange } from '../src/webview/sidebar/table';

const columns = ['id', 'n_spikes', 'group', 'ContamPct', 'KSLabel'];
const rows: Cell[][] = [
  [2, 250, 'good', 1.5, 'good'],
  [7, 130, 'mua', 20, 'mua'],
  [11, 30, 'noise', 85.4, 'mua'],
  [40, 200, 'good', 0, 'good'],
  [50, 1, null, null, 'mua'],
];
const ids = (rs: Cell[][]) => rs.map((r) => r[0]);
const filter = (text: string) => {
  const f = parseFilter(text, columns);
  if (!f.ok) throw new Error(f.error);
  return f.test ? ids(rows.filter(f.test)) : ids(rows);
};

describe('filter grammar', () => {
  it('compares numbers and words, with and binding tighter than or', () => {
    expect(filter('n_spikes > 100 and group == good')).toEqual([2, 40]);
    expect(filter('KSLabel == "mua" or ContamPct < 1')).toEqual([7, 11, 40, 50]);
    expect(filter('group == good or group == noise and n_spikes < 50')).toEqual([2, 11, 40]);
    expect(filter('  ')).toEqual([2, 7, 11, 40, 50]);
  });
  it('treats empty cells as matching only !=', () => {
    expect(filter('ContamPct >= 0')).toEqual([2, 7, 11, 40]);
    expect(filter('group != good')).toEqual([7, 11, 50]);
  });
  it('accepts quoted values with spaces and is case-insensitive for and/or', () => {
    expect(filter("group == 'good' OR id == 50")).toEqual([2, 40, 50]);
  });
  it('reports errors instead of evaluating anything', () => {
    expect(parseFilter('depth > 3', columns)).toEqual({ ok: false, error: "unknown column 'depth'" });
    expect(parseFilter('n_spikes >', columns)).toMatchObject({ ok: false, error: "expected a value after '>'" });
    expect(parseFilter('n_spikes ~ 3', columns).ok).toBe(false);
    expect(parseFilter('n_spikes > 3 junk', columns)).toMatchObject({ ok: false, error: "unexpected 'junk'" });
  });
});

describe('table', () => {
  it('sorts numbers and strings with empty cells last in both directions', () => {
    expect(ids(sortRows(rows, 3, false))).toEqual([40, 2, 7, 11, 50]);
    expect(ids(sortRows(rows, 3, true))).toEqual([11, 7, 2, 40, 50]);
    expect(ids(sortRows(rows, 2, false))).toEqual([2, 40, 7, 11, 50]);
  });
  it('renders only a window of rows for very large tables', () => {
    expect(visibleRange(0, 220, 22, 10_000)).toEqual({ start: 0, end: 15 });
    expect(visibleRange(22_000, 220, 22, 10_000)).toEqual({ start: 995, end: 1015 });
    expect(visibleRange(219_900, 220, 22, 10_000)).toEqual({ start: 9990, end: 10_000 });
  });
  it('sorts 10k rows quickly', () => {
    const big: Cell[][] = Array.from({ length: 10_000 }, (_, i) => [i, (i * 7919) % 10_007, i % 3 ? 'good' : 'mua']);
    const t = performance.now();
    sortRows(big, 1, true);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it('formats cells and tints rows by group', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(12)).toBe('12');
    expect(formatCell(3.14159)).toBe('3.142');
    expect(formatCell('mua')).toBe('mua');
    expect(groupTint('good')).toMatch(/^rgba\(134, 209, 109/);
    expect(groupTint(null)).toBe('');
  });
});

describe('clickSelect', () => {
  const order = [5, 2, 9, 4];
  it('replaces, toggles with ctrl, and ranges with shift from the anchor', () => {
    expect(clickSelect(order, [9], undefined, 2, { ctrl: false, shift: false })).toEqual({ selected: [2], anchor: 2 });
    expect(clickSelect(order, [2], 2, 9, { ctrl: true, shift: false })).toEqual({ selected: [2, 9], anchor: 9 });
    expect(clickSelect(order, [2, 9], 9, 2, { ctrl: true, shift: false })).toEqual({ selected: [9], anchor: 2 });
    expect(clickSelect(order, [2], 2, 4, { ctrl: false, shift: true })).toEqual({ selected: [2, 9, 4], anchor: 2 });
    expect(clickSelect(order, [9], 9, 5, { ctrl: false, shift: true })).toEqual({ selected: [9, 2, 5], anchor: 9 });
  });
});

describe('isPlainArrow', () => {
  const key = (k: string, mods: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    const ev = { key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods };
    return isPlainArrow(ev);
  };
  it('maps plain and shifted up/down arrows to a step', () => {
    expect(key('ArrowDown')).toBe(1);
    expect(key('ArrowUp')).toBe(-1);
    expect(key('ArrowDown', { shiftKey: true })).toBe(1);
  });
  it('leaves alt/ctrl/meta arrows to the extension keybindings and ignores other keys', () => {
    expect(key('ArrowDown', { altKey: true })).toBeUndefined();
    expect(key('ArrowUp', { ctrlKey: true })).toBeUndefined();
    expect(key('ArrowDown', { metaKey: true })).toBeUndefined();
    expect(key('Enter')).toBeUndefined();
    expect(key('ArrowLeft')).toBeUndefined();
  });
});
