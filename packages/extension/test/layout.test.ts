import { describe, expect, it } from 'vitest';
import { LEGACY_KNOWN, newViews, packLayout, tileFor, unpackLayout } from '../src/webview/plot/layout';

describe('layout', () => {
  it('reads nothing as no layout', () => {
    expect(unpackLayout(undefined)).toBeUndefined();
    expect(unpackLayout(null)).toBeUndefined();
  });
  it('reads a Plan 2 layout (bare dockview JSON) as having seen only the built-in views', () => {
    expect(unpackLayout({ grid: { root: 1 } })).toEqual({ dock: { grid: { root: 1 } }, known: LEGACY_KNOWN });
  });
  it('round-trips a packed layout', () => {
    expect(unpackLayout(packLayout({ grid: 2 }, new Set(['a', 'b'])))).toEqual({ dock: { grid: 2 }, known: ['a', 'b'] });
  });
  it('lists only registered views the layout has never seen, so closed views stay closed', () => {
    expect(newViews(['waveform', 'mine', 'other'], ['waveform', 'other'])).toEqual(['mine']);
    expect(newViews(['waveform'], LEGACY_KNOWN)).toEqual([]);
  });
  it('tiles a view with no default tile beside the last panel, never as a tab', () => {
    const own = { referencePanel: 'waveform', direction: 'below' } as const;
    expect(tileFor(own, 'amplitude')).toBe(own);
    expect(tileFor(undefined, 'amplitude')).toEqual({ referencePanel: 'amplitude', direction: 'right' });
    expect(tileFor(undefined, undefined)).toBeUndefined();
  });
});
