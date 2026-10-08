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

/** Registered views the layout has never been offered: they get a tab. Views the user closed stay in `known`, so they stay closed. */
export function newViews(registered: readonly string[], known: Iterable<string>): string[] {
  const seen = new Set(known);
  return registered.filter((id) => !seen.has(id));
}
