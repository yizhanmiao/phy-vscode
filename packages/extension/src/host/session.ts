import type { Cell, ClusterTable, ClusterUpdate, PhySession } from '@theia-phy/api';
import { bsearch, buildClusterIndex, spikesOf, type ClusterIndex } from '../compute/spikes';
import { bestChannels, clusterMeanTemplate } from '../compute/templates';
import type { Dataset } from './dataset/dataset';
import { Emitter } from './emitter';

/** phy's selection colours (colorcet glasbey_bw_minc_20_minl_30, reordered as in phy.utils.color). */
export const PALETTE = [
  '#0892fc', '#ff0202', '#98ff00', '#ffa530', '#b600ff', '#028800', '#ff8fc8', '#79525f',
  '#00fecf', '#b0a5ff', '#94ad84', '#9a6900', '#376a62', '#d3008c', '#fef590', '#c86f66',
];

export class Session implements PhySession {
  readonly index: ClusterIndex;
  readonly clusters: ClusterTable;
  private _selection: number[] = [];
  private readonly selectionEmitter = new Emitter<readonly number[]>();
  private readonly clustersEmitter = new Emitter<ClusterUpdate>();
  readonly onDidChangeSelection = this.selectionEmitter.event;
  readonly onDidChangeClusters = this.clustersEmitter.event;
  private readonly channelCache = new Map<number, Int32Array>();

  constructor(readonly dataset: Dataset) {
    this.index = buildClusterIndex(dataset.spikeClusters);
    this.clusters = this.buildTable();
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
