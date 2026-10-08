import { describe, expect, it } from 'vitest';
import { LEGACY_KNOWN, newViews, packLayout, restorePlan, tileFor, unpackLayout } from '../src/webview/plot/layout';

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
  it('restores a layout: drops panels of unregistered views from known, keeps registered ones, adds only never-seen views', () => {
    const plan = restorePlan(['waveform', 'mine', 'new'], ['waveform', 'gone'], ['waveform', 'gone', 'mine', 'closed']);
    expect(plan.remove).toEqual(['gone']);
    expect(plan.add).toEqual(['new']); // 'mine' was seen and is not in the dock: the user closed it
    expect([...plan.known].sort()).toEqual(['closed', 'mine', 'new', 'waveform']);
    // the missing view comes back later: it is not known, so it is offered again
    expect(restorePlan(['waveform', 'gone'], ['waveform'], plan.known).add).toEqual(['gone']);
  });
  it('tiles a view at its default tile if that panel exists, else at the grid edge, never as a tab', () => {
    const own = { referencePanel: 'waveform', direction: 'below' } as const;
    expect(tileFor(own, (id) => id === 'waveform')).toBe(own);
    expect(tileFor(own, () => false)).toEqual({ direction: 'right' });
    expect(tileFor(undefined, () => true)).toEqual({ direction: 'right' });
  });
});
