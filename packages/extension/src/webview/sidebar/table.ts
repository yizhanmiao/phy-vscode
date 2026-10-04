import type { Cell } from '@theia-phy/api';

/** Stable sort by one column; numbers numerically, strings lexically, empty cells last either way. */
export function sortRows(rows: Cell[][], col: number, descending: boolean): Cell[][] {
  const dir = descending ? -1 : 1;
  return [...rows].sort((ra, rb) => {
    const a = ra[col];
    const b = rb[col];
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
    const sa = String(a);
    const sb = String(b);
    return (sa === sb ? 0 : sa < sb ? -1 : 1) * dir;
  });
}

/** Row index window to render for a virtualized list. */
export function visibleRange(scrollTop: number, viewport: number, rowH: number, n: number, overscan = 5): { start: number; end: number } {
  return {
    start: Math.max(0, Math.floor(scrollTop / rowH) - overscan),
    end: Math.min(n, Math.ceil((scrollTop + viewport) / rowH) + overscan),
  };
}

/** New scrollTop that brings row `index` fully into view, or undefined when it already is. */
export function scrollTopFor(index: number, scrollTop: number, viewport: number, rowH: number): number | undefined {
  const top = index * rowH;
  if (top < scrollTop) return top;
  if (top + rowH > scrollTop + viewport) return top + rowH - viewport;
  return undefined;
}

export function formatCell(c: Cell): string {
  if (c === null) return '';
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(Number(c.toPrecision(4)));
  return c;
}

/** Row background by phy cluster group. */
export function groupTint(g: Cell): string {
  if (g === 'good') return 'rgba(134, 209, 109, 0.15)';
  if (g === 'mua') return 'rgba(128, 128, 128, 0.15)';
  if (g === 'noise') return 'rgba(102, 102, 102, 0.35)';
  return '';
}
