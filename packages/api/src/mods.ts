import type { CancellationToken, ComputeContext, Disposable, Event, HistogramDefinition, PhySession, ViewContext, ViewResult } from './index';

/** The semver of this API. A plugin may declare `apiVersion` (see `satisfiesApi`); a VS Code extension compares it to `PhyApi.version` itself. */
export const API_VERSION = '0.2.0';

const parse = (v: string): [number, number, number] | undefined => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

/**
 * Does `version` satisfy `range`? Only an exact `x.y.z` or a caret range `^x.y.z` is understood: for 0.x the minor must
 * match and the patch be at least the range's; from 1.0 the major must match and the rest be at least the range's.
 */
export function satisfiesApi(range: string, version: string = API_VERSION): boolean {
  const caret = range.trim().startsWith('^');
  const want = parse(caret ? range.trim().slice(1) : range);
  const have = parse(version);
  if (!want || !have) return false;
  const [wM, wm, wp] = want;
  const [hM, hm, hp] = have;
  if (!caret) return wM === hM && wm === hm && wp === hp;
  if (hM !== wM) return false;
  if (wM === 0) return hm === wm && hp >= wp;
  return hm > wm || (hm === wm && hp >= wp);
}

/** Anything with a file-system path; a `vscode.Uri` qualifies. */
export interface UriLike {
  readonly fsPath: string;
}

export interface ViewDefinition {
  /** Letters, digits, `_`, `.` and `-`, starting with a letter or `_`. Must be unique. */
  id: string;
  title: string;
  /** Runs in the extension host on every selection change while the view is visible. */
  provider(ctx: ViewContext, token: CancellationToken): Promise<ViewResult>;
  /**
   * Path of an ES module that runs in the plot webview and exports `{ mount(el, plot, host), update(meta, buffers, selection),
   * dispose() }` (or a default function returning that). Bundle it into one file: only its own folder is served.
   */
  rendererScript: UriLike;
}

export interface ClusterMetricDefinition {
  /** The table column's name, so it must be usable in the filter box: no spaces. Cannot reuse a built-in column. */
  id: string;
  /** Shown as the column header's tooltip. */
  label: string;
  /** Runs synchronously in the extension host, once per cluster. A non-finite number, a throw or any other type leaves the cell empty. */
  compute(clusterId: number, ctx: ComputeContext): number | string;
}

export interface PhyApi {
  /** `API_VERSION`. */
  readonly version: string;
  activeSession(): PhySession | undefined;
  readonly onDidOpenSession: Event<PhySession>;
  registerView(def: ViewDefinition): Disposable;
  registerClusterMetric(def: ClusterMetricDefinition): Disposable;
  /** Adds a panel to the Cluster statistics view. */
  registerHistogram(def: HistogramDefinition): Disposable;
}
