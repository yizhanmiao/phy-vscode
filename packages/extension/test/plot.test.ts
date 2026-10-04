import { describe, expect, it } from 'vitest';
import { barTriangles, gridRects, inset, interleave, parseColor, polylineSegments, toCss, withAlpha } from '../src/webview/plot/geometry';
import { colorOf } from '../src/webview/plot/renderer';
import { formatTick, niceTicks } from '../src/webview/plot/ticks';
import { paddedRange, panRange, zoomRange } from '../src/webview/plot/view';

describe('ticks', () => {
  it('picks 1-2-5 steps', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(-0.023, 0.027)).toEqual([-0.02, -0.01, 0, 0.01, 0.02]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });
  it('formats compactly', () => {
    expect(formatTick(0.1 + 0.2)).toBe('0.3');
    expect(formatTick(25000)).toBe('2.5e+4');
    expect(formatTick(0)).toBe('0');
  });
});

describe('view ranges', () => {
  it('zooms around a point and pans by a fraction', () => {
    expect(zoomRange({ min: 0, max: 10 }, 0.5, 4)).toEqual({ min: 2, max: 7 });
    expect(panRange({ min: 0, max: 10 }, 0.1)).toEqual({ min: 1, max: 11 });
  });
  it('pads finite values and survives degenerate input', () => {
    expect(paddedRange(Float32Array.from([0, 10, NaN]))).toEqual({ min: -0.5, max: 10.5 });
    expect(paddedRange([2, 2])).toEqual({ min: 1, max: 3 });
    expect(paddedRange([], [NaN])).toEqual({ min: 0, max: 1 });
  });
});

describe('geometry', () => {
  it('lays out weighted grids row-major', () => {
    const r = gridRects(104, 50, 1, 2, 4, [3, 1]);
    expect(r).toEqual([{ x: 0, y: 0, w: 75, h: 50 }, { x: 79, y: 0, w: 25, h: 50 }]);
    expect(inset({ x: 0, y: 0, w: 10, h: 10 }, { left: 20, right: 0, top: 0, bottom: 0 }).w).toBe(0);
  });
  it('packs vertices, skipping NaN gaps', () => {
    expect(Array.from(interleave(Float32Array.from([1, NaN, 3]), Float32Array.from([4, 5, 6])))).toEqual([1, 4, 3, 6]);
    const seg = polylineSegments(Float32Array.from([0, 1, 2, NaN, 5, 6]), Float32Array.from([0, 1, 0, NaN, 5, 5]));
    expect(Array.from(seg)).toEqual([0, 0, 1, 1, 1, 1, 2, 0, 5, 5, 6, 5]);
  });
  it('builds two triangles per bar, optionally horizontal', () => {
    expect(Array.from(barTriangles(0, 1, Float32Array.from([2]), false))).toEqual([0, 0, 1, 0, 1, 2, 0, 0, 1, 2, 0, 2]);
    expect(Array.from(barTriangles(0, 1, Float32Array.from([2]), true))).toEqual([0, 0, 0, 1, 2, 1, 0, 0, 2, 1, 2, 0]);
  });
  it('parses theme colours', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(parseColor('#f00', 0.5)).toEqual([1, 0, 0, 0.5]);
    expect(parseColor('#00000080')[3]).toBeCloseTo(0.502, 3);
    expect(parseColor('rgba(0, 255, 0, 0.25)')).toEqual([0, 1, 0, 0.25]);
    expect(parseColor('nonsense')).toEqual([0.5, 0.5, 0.5, 1]);
    expect(toCss(withAlpha([1, 0, 0, 1], 0.5))).toBe('rgba(255,0,0,0.5)');
  });
  it('colours a cluster by its position in the selection', () => {
    const sel = { ids: [7, 2], colors: ['#0892fc', '#ff0202'] };
    expect(colorOf(sel, 2)).toEqual([1, 2 / 255, 2 / 255, 1]);
    expect(colorOf(sel, 99, 0.5)).toEqual([128 / 255, 128 / 255, 128 / 255, 0.5]);
  });
});
