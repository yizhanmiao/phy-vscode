/** The plot webview's persisted layout: dockview's JSON plus the ids of every view it has been offered. */
export interface SavedLayout {
  v: 2;
  dock: unknown;
  known: string[];
}

/** Layouts saved by Plan 2 were the bare dockview JSON, written when only the built-in views existed. */
export const LEGACY_KNOWN = ['waveform', 'feature', 'correlogram', 'amplitude', 'cluster_statistics'];

export function unpackLayout(saved: unknown): { dock: unknown; known: string[] } | undefined {
  if (saved === undefined || saved === null) return undefined;
  const s = saved as Partial<SavedLayout>;
  if (s.v === 2 && Array.isArray(s.known)) return { dock: s.dock, known: s.known.filter((k): k is string => typeof k === 'string') };
  return { dock: saved, known: LEGACY_KNOWN };
}

export const packLayout = (dock: unknown, known: Iterable<string>): SavedLayout => ({ v: 2, dock, known: [...known] });

/** Registered views the layout has never been offered: they get a pane of their own (see tileFor). Views the user closed stay in `known`, so they stay closed. */
export function newViews(registered: readonly string[], known: Iterable<string>): string[] {
  const seen = new Set(known);
  return registered.filter((id) => !seen.has(id));
}

export type Tile = { referencePanel?: string; direction: 'right' | 'below' };

/**
 * Where a view opens: its default tile when the panel it hangs off exists, else a new column at the grid edge. As a tab it would
 * hide, and so stop rendering, the view it lands behind.
 * ponytail: many plugin views each take a root-level column; the user rearranges them and the layout persists.
 */
export const tileFor = (tile: Tile | undefined, hasPanel: (id: string) => boolean): Tile =>
  tile?.referencePanel && hasPanel(tile.referencePanel) ? tile : { direction: 'right' };
