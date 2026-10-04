import type { CancellationToken, HostToPlot, SelectionMsg, ViewResult } from '@theia-phy/api';
import { Cancelled } from '../views/types';

export type RunView = (viewId: string, settings: Readonly<Record<string, unknown>>, token: CancellationToken) => Promise<ViewResult>;

class TokenSource {
  private cancelled = false;
  readonly token: CancellationToken;
  constructor() {
    const self = this;
    this.token = {
      get isCancellationRequested() {
        return self.cancelled;
      },
    };
  }
  cancel(): void {
    this.cancelled = true;
  }
}

/** Webviews accept plain ArrayBuffers only (no SharedArrayBuffer). */
export const toArrayBuffer = (b: ArrayBufferLike): ArrayBuffer => (b instanceof ArrayBuffer ? b : new Uint8Array(b).slice().buffer);

/**
 * Runs view providers for the visible views only. Every run gets a fresh seq and token; a newer run for the
 * same view cancels the older one, and only the newest result is posted (spec §4).
 */
export class ViewScheduler {
  private visible = new Set<string>();
  private seq = 0;
  private version = 0; // bumps on every selection change
  private readonly current = new Map<string, { seq: number; source: TokenSource }>();
  private readonly computedFor = new Map<string, number>(); // viewId → selection version last computed
  private readonly settings: Record<string, Record<string, unknown>>;
  private disposed = false;

  constructor(
    private readonly run: RunView,
    private readonly post: (m: HostToPlot) => void,
    private readonly selection: () => SelectionMsg,
    settings: Record<string, Record<string, unknown>> = {},
  ) {
    this.settings = { ...settings };
  }

  settingsOf(viewId: string): Record<string, unknown> {
    return this.settings[viewId] ?? {};
  }

  setVisible(viewIds: string[]): void {
    // A view that left the visible set may have been removed from the webview: recompute it on return unless its run is still in flight.
    for (const id of this.visible) if (!viewIds.includes(id) && !this.current.has(id)) this.computedFor.delete(id);
    this.visible = new Set(viewIds);
    for (const id of viewIds) if (this.computedFor.get(id) !== this.version) this.refresh(id);
  }

  selectionChanged(): void {
    this.version++;
    for (const [id, c] of this.current) if (!this.visible.has(id)) { c.source.cancel(); this.current.delete(id); }
    for (const id of this.visible) this.refresh(id);
  }

  setSettings(viewId: string, patch: Record<string, unknown>): void {
    this.settings[viewId] = { ...this.settingsOf(viewId), ...patch };
    this.computedFor.delete(viewId);
    if (this.visible.has(viewId)) this.refresh(viewId);
    else { this.current.get(viewId)?.source.cancel(); this.current.delete(viewId); }
  }

  refresh(viewId: string): void {
    if (this.disposed) return;
    this.current.get(viewId)?.source.cancel();
    const seq = ++this.seq;
    const source = new TokenSource();
    this.current.set(viewId, { seq, source });
    this.computedFor.set(viewId, this.version);
    const selection = this.selection();
    const isCurrent = () => !this.disposed && this.current.get(viewId)?.seq === seq;
    /** The run finished: it is no longer in flight, and a view hidden meanwhile may have missed the result, so recompute on show. */
    const settle = () => {
      this.current.delete(viewId);
      if (!this.visible.has(viewId)) this.computedFor.delete(viewId);
    };
    this.run(viewId, this.settingsOf(viewId), source.token).then(
      (r) => {
        if (!isCurrent()) return;
        settle();
        this.post({ type: 'viewData', viewId, seq, meta: r.meta, buffers: r.buffers.map(toArrayBuffer), selection });
      },
      (e: unknown) => {
        if (!isCurrent()) return;
        settle();
        if (!(e instanceof Cancelled)) this.post({ type: 'viewError', viewId, seq, message: e instanceof Error ? e.message : String(e) });
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.current.values()) c.source.cancel();
  }
}
