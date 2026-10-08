import type { Cell, ClusterMetricDefinition, ClusterTable, ClusterUpdate, PhySession } from '@phy-vscode/api';
import { bsearch, buildClusterIndex, spikesOf, type ClusterIndex } from '../compute/spikes';
import { bestChannels, clusterMeanTemplate } from '../compute/templates';
import type { Dataset } from './dataset/dataset';
import { Emitter } from './emitter';

/** phy's selection colours (colorcet glasbey_bw_minc_20_minl_30, reordered as in phy.utils.color). */
export const PALETTE = [
  '#0892fc', '#ff0202', '#98ff00', '#ffa530', '#b600ff', '#028800', '#ff8fc8', '#79525f',
  '#00fecf', '#b0a5ff', '#94ad84', '#9a6900', '#376a62', '#d3008c', '#fef590', '#c86f66',
];

export interface SessionMods {
  /** Registered cluster metrics. Must return the same array object until the set changes. */
  metrics?(): readonly ClusterMetricDefinition[];
  warn?(message: string): void;
}
const NO_METRICS: readonly ClusterMetricDefinition[] = [];

export class Session implements PhySession {
  readonly index: ClusterIndex;
  private readonly base: ClusterTable;
  private table: ClusterTable;
  private tableFor = NO_METRICS;
  private labels: Record<string, string> = {};
  private readonly metricColumns = new WeakMap<ClusterMetricDefinition, Cell[]>();
  private readonly warned = new Set<string>();
  private building = false;
  private _selection: number[] = [];
  private readonly selectionEmitter = new Emitter<readonly number[]>();
  private readonly clustersEmitter = new Emitter<ClusterUpdate>();
  readonly onDidChangeSelection = this.selectionEmitter.event;
  readonly onDidChangeClusters = this.clustersEmitter.event;
  private readonly channelCache = new Map<number, Int32Array>();

  constructor(readonly dataset: Dataset, private readonly mods: SessionMods = {}) {
    this.index = buildClusterIndex(dataset.spikeClusters);
    this.base = this.table = this.buildTable();
  }

  /** The dataset's columns plus one per registered cluster metric. */
  get clusters(): ClusterTable {
    // a metric reading session.clusters while the table is being built gets the previous table, not a rebuild
    if (this.building) return this.table;
    const defs = this.mods.metrics?.() ?? NO_METRICS;
    if (defs !== this.tableFor) {
      this.building = true;
      try {
        this.table = this.withMetrics(defs);
        this.tableFor = defs;
      } finally {
        this.building = false;
      }
    }
    return this.table;
  }

  /** Column name → tooltip text for the metric columns. */
  metricLabels(): Record<string, string> {
    void this.clusters;
    return this.labels;
  }

  /** Reports `message` at most once per `key`. */
  private warn(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    (this.mods.warn ?? console.warn)(message);
  }

  private withMetrics(defs: readonly ClusterMetricDefinition[]): ClusterTable {
    const live = defs.filter((d) => {
      if (!this.base.columns.includes(d.id)) return true;
      const message = `cluster metric '${d.id}' skipped: the dataset already has a column of that name`;
      this.warn(message, message);
      return false;
    });
    this.labels = Object.fromEntries(live.map((d) => [d.id, d.label]));
    if (live.length === 0) return this.base;
    const columns = live.map((d) => this.metricColumn(d));
    return {
      columns: [...this.base.columns, ...live.map((d) => d.id)],
      rows: this.base.rows.map((r, i) => [...r, ...columns.map((c) => c[i])]),
    };
  }

  // ponytail: metrics run synchronously on the extension host, once per cluster; a heavy one blocks it. Move to a worker if one ever needs to.
  private metricColumn(d: ClusterMetricDefinition): Cell[] {
    let col = this.metricColumns.get(d);
    if (col) return col;
    const ctx = { session: this };
    col = this.base.rows.map((r) => {
      try {
        const v = d.compute(r[0] as number, ctx);
        if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return v;
        this.warn(`metric:${d.id}`, `cluster metric '${d.id}' returned a non-finite number or a value that is not a number or string for cluster ${r[0]} (further problems with this metric are not reported)`);
        return null;
      } catch (e) {
        this.warn(`metric:${d.id}`, `cluster metric '${d.id}' failed for cluster ${r[0]}: ${e instanceof Error ? e.message : String(e)} (further problems with this metric are not reported)`);
        return null;
      }
    });
    this.metricColumns.set(d, col);
    return col;
  }

  get selection(): readonly number[] {
    return this._selection;
  }

  select(ids: number[]): void {
    const next = [...new Set(ids)].filter((id) => bsearch(this.index.ids, id) >= 0);
    if (next.length === this._selection.length && next.every((id, i) => id === this._selection[i])) return;
    this._selection = next;
    this.selectionEmitter.fire(next);
  }

  spikesOf(id: number): Int32Array {
    return spikesOf(this.index, id);
  }

  colorOf(id: number): string {
    const i = this._selection.indexOf(id);
    return i < 0 ? '#808080' : PALETTE[i % PALETTE.length];
  }

  meanTemplate(id: number): Float64Array | undefined {
    const ds = this.dataset;
    if (!ds.templates || !ds.spikeTemplates) return undefined;
    return clusterMeanTemplate(ds.templates, ds.wmi, ds.nChannels, ds.spikeTemplates, this.spikesOf(id));
  }

  bestChannels(id: number): Int32Array | undefined {
    const cached = this.channelCache.get(id);
    if (cached) return cached;
    const mean = this.meanTemplate(id);
    if (!mean) return undefined;
    const ds = this.dataset;
    const { channels } = bestChannels(mean, ds.templates!.nSamples, ds.channelPositions, ds.channelShanks);
    this.channelCache.set(id, channels);
    return channels;
  }

  private buildTable(): ClusterTable {
    const ds = this.dataset;
    const builtin = ['n_spikes', 'depth', 'amplitude', 'firing_rate'];
    // cluster_<builtin>.tsv overrides that column's computed value; a field named id is ignored
    const extra = [...ds.metadata.keys()].filter((k) => k !== 'group' && k !== 'id' && !builtin.includes(k));
    const columns = ['id', 'n_spikes', 'group', 'depth', 'amplitude', 'firing_rate', ...extra];
    const over = (k: string, id: number, computed: Cell): Cell => ds.metadata.get(k)?.get(id) ?? computed;
    const rows = Array.from(this.index.ids, (id): Cell[] => {
      const spikes = this.spikesOf(id);
      let depth: Cell = null;
      let amplitude: Cell = null;
      const mean = this.meanTemplate(id);
      if (mean) {
        const best = bestChannels(mean, ds.templates!.nSamples, ds.channelPositions, ds.channelShanks);
        this.channelCache.set(id, best.channels);
        depth = ds.channelPositions[best.channels[0] * 2 + 1];
        amplitude = best.amplitude[best.channels[0]];
      }
      if (ds.amplitudes) {
        let s = 0;
        for (const i of spikes) s += ds.amplitudes[i];
        amplitude = s / spikes.length;
      }
      return [
        id,
        over('n_spikes', id, spikes.length),
        ds.metadata.get('group')?.get(id) ?? null,
        over('depth', id, depth),
        over('amplitude', id, amplitude),
        over('firing_rate', id, spikes.length / ds.duration),
        ...extra.map((k) => ds.metadata.get(k)!.get(id) ?? null),
      ];
    });
    return { columns, rows };
  }

  dispose(): void {
    this.selectionEmitter.dispose();
    this.clustersEmitter.dispose();
  }
}
