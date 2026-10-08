import { isAbsolute } from 'node:path';
import type { CancellationToken, ClusterMetricDefinition, Disposable, HistogramDefinition, UriLike, ViewDefinition, ViewResult } from '@phy-vscode/api';
import { makeBuiltinViews } from '../views';
import { builtinHistograms } from '../views/stats/provider';
import type { HostViewContext } from '../views/types';
import { Emitter } from './emitter';

/** Columns every cluster table has; a metric may not reuse them. */
export const BASE_COLUMNS: readonly string[] = ['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate'];
const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export interface ViewEntry {
  id: string;
  title: string;
  provider(ctx: HostViewContext, token: CancellationToken): Promise<ViewResult>;
  /** Mod views only: the webview module that draws them. Built-in renderers are bundled into plot.js. */
  rendererScript?: UriLike;
  /** Bumps on every registration, so a re-registered view's renderer module is fetched afresh. */
  generation: number;
}
export interface RegistryChange {
  views: boolean;
  metrics: boolean;
  histograms: boolean;
}

function checkId(kind: string, id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(`${kind} id must match ${ID}, got ${JSON.stringify(id)}`);
}

/** Every view, cluster metric and histogram, built-in and from mods. Pure: no vscode, so it is unit-tested. */
export class ModRegistry {
  private readonly builtin: ViewEntry[];
  private mods: ViewEntry[] = [];
  private metricList: readonly ClusterMetricDefinition[] = [];
  private histogramList: readonly HistogramDefinition[] = builtinHistograms;
  private generation = 0;
  private holds = 0;
  private pending: RegistryChange | undefined;
  private readonly emitter = new Emitter<RegistryChange>();
  readonly onDidChange = this.emitter.event;

  constructor() {
    this.builtin = makeBuiltinViews(() => this.histogramList).map((v) => ({ ...v, generation: 0 }));
  }

  views(): readonly ViewEntry[] {
    return [...this.builtin, ...this.mods];
  }
  view(id: string): ViewEntry | undefined {
    return this.views().find((v) => v.id === id);
  }
  /** The same array object until the set changes. */
  metrics(): readonly ClusterMetricDefinition[] {
    return this.metricList;
  }
  /** The same array object until the set changes. */
  histograms(): readonly HistogramDefinition[] {
    return this.histogramList;
  }

  registerView(def: ViewDefinition): Disposable {
    checkId('view', def.id);
    if (!def.title) throw new Error(`view '${def.id}' needs a title`);
    if (!def.rendererScript?.fsPath) throw new Error(`view '${def.id}' needs a rendererScript`);
    if (!isAbsolute(def.rendererScript.fsPath)) throw new Error(`view '${def.id}' rendererScript must be an absolute path`);
    if (this.view(def.id)) throw new Error(`view '${def.id}' is already registered`);
    const entry: ViewEntry = {
      id: def.id,
      title: def.title,
      rendererScript: def.rendererScript,
      generation: ++this.generation,
      // async: a provider that throws synchronously must reject, not escape the scheduler
      provider: async ({ session, settings }, token) => def.provider({ session, settings }, token),
    };
    this.mods = [...this.mods, entry];
    this.changed({ views: true });
    return {
      dispose: () => {
        if (!this.mods.includes(entry)) return;
        this.mods = this.mods.filter((e) => e !== entry);
        this.changed({ views: true });
      },
    };
  }

  registerClusterMetric(def: ClusterMetricDefinition): Disposable {
    checkId('cluster metric', def.id);
    if (BASE_COLUMNS.includes(def.id)) throw new Error(`cluster metric id '${def.id}' is a built-in table column`);
    if (typeof def.compute !== 'function') throw new Error(`cluster metric '${def.id}' needs a compute function`);
    if (this.metricList.some((m) => m.id === def.id)) throw new Error(`cluster metric '${def.id}' is already registered`);
    this.metricList = [...this.metricList, def];
    this.changed({ metrics: true });
    return {
      dispose: () => {
        if (!this.metricList.includes(def)) return;
        this.metricList = this.metricList.filter((m) => m !== def);
        this.changed({ metrics: true });
      },
    };
  }

  registerHistogram(def: HistogramDefinition): Disposable {
    checkId('histogram', def.id);
    if (typeof def.compute !== 'function') throw new Error(`histogram '${def.id}' needs a compute function`);
    if (this.histogramList.some((h) => h.id === def.id)) throw new Error(`histogram '${def.id}' is already registered`);
    this.histogramList = [...this.histogramList, def];
    this.changed({ histograms: true });
    return {
      dispose: () => {
        if (!this.histogramList.includes(def)) return;
        this.histogramList = this.histogramList.filter((h) => h !== def);
        this.changed({ histograms: true });
      },
    };
  }

  /** Defer change events until the returned function is called (it merges them into one event). Holds nest. */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holds === 0) this.flush();
    };
  }

  private changed(c: Partial<RegistryChange>): void {
    const p = this.pending ?? { views: false, metrics: false, histograms: false };
    this.pending = { views: p.views || !!c.views, metrics: p.metrics || !!c.metrics, histograms: p.histograms || !!c.histograms };
    if (this.holds === 0) this.flush();
  }

  private flush(): void {
    const p = this.pending;
    this.pending = undefined;
    if (p) this.emitter.fire(p);
  }
}
