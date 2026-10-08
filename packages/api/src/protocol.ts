import type { Cell } from './index';

/** Selection snapshot: ids in selection order and their Session colours. */
export interface SelectionMsg {
  ids: number[];
  colors: string[];
}

/** Persisted Cluster-view state. */
export interface TableState {
  sort?: { column: string; descending: boolean };
  filter?: string;
}

export type ViewEventPayload =
  | { kind: 'settings'; settings: Record<string, unknown> } // provider settings: recompute
  | { kind: 'state'; state: unknown }; // renderer-only UI state: persist, no recompute

/** Plot webview → host. */
export type PlotToHost =
  | { type: 'ready' }
  | { type: 'visible'; viewIds: string[] }
  | { type: 'viewEvent'; viewId: string; payload: ViewEventPayload }
  | { type: 'persist'; layout: unknown }
  | { type: 'rendered'; viewId: string; seq: number; error?: string };

/** Host → plot webview. */
export type HostToPlot =
  | {
      type: 'init';
      views: { id: string; title: string }[];
      layout?: unknown;
      settings: Record<string, Record<string, unknown>>;
      states: Record<string, unknown>;
    }
  | { type: 'viewData'; viewId: string; seq: number; meta: unknown; buffers: ArrayBuffer[]; selection: SelectionMsg }
  | { type: 'viewError'; viewId: string; seq: number; message: string }
  | { type: 'toggleView'; viewId: string };

/** Cluster sidebar → host. */
export type SidebarToHost =
  | { type: 'ready' }
  | { type: 'select'; ids: number[] }
  | { type: 'order'; ids: number[] } // current sorted+filtered cluster order, for phy.selectNext/Previous
  | { type: 'persist'; table: TableState };

/** Host → Cluster sidebar. */
export type HostToSidebar =
  | { type: 'clusterTable'; columns: string[]; rows: Cell[][]; labels?: Record<string, string>; info: string; state: TableState }
  | { type: 'selection'; selection: SelectionMsg }
  | { type: 'empty' };
