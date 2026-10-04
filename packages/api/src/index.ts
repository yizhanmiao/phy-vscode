// @phy-vscode/api — public types shared by phy-vscode and its mods. Types only; follows semver.

export interface Disposable {
  dispose(): void;
}
export type Event<T> = (listener: (e: T) => void) => Disposable;
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

export type Cell = number | string | null;
/** Cluster table: `rows[i][k]` is the value of `columns[k]` for one cluster; column 0 is `id`. */
export interface ClusterTable {
  readonly columns: string[];
  readonly rows: Cell[][];
}
/** Fired by curation (not in v1). */
export interface ClusterUpdate {
  added: number[];
  deleted: number[];
  descendants: [number, number][];
}

/** Read-only view of a loaded dataset. Per-spike arrays may live in SharedArrayBuffers. */
export interface DatasetReader {
  readonly dir: string;
  readonly sampleRate: number;
  readonly nSpikes: number;
  readonly nChannels: number;
  /** Seconds: (last spike time + 1) / sampleRate. */
  readonly duration: number;
  /** Spike times in samples. */
  readonly spikeTimes: Float64Array;
  readonly spikeClusters: Int32Array;
  readonly spikeTemplates?: Int32Array;
  readonly amplitudes?: Float32Array;
  readonly channelMap: Int32Array;
  /** nChannels × 2 (x, y), row-major. */
  readonly channelPositions: Float32Array;
  readonly channelShanks?: Int32Array;
}

export interface PhySession {
  readonly dataset: DatasetReader;
  readonly clusters: ClusterTable;
  readonly selection: readonly number[];
  select(ids: number[]): void;
  /** Spike indices of a cluster, ascending. Empty for unknown ids. Do not mutate. */
  spikesOf(clusterId: number): Int32Array;
  /** CSS colour of a cluster: phy palette by selection order, grey when not selected. */
  colorOf(clusterId: number): string;
  readonly onDidChangeSelection: Event<readonly number[]>;
  readonly onDidChangeClusters: Event<ClusterUpdate>;
}

export interface ComputeContext {
  readonly session: PhySession;
}
export interface ViewContext extends ComputeContext {
  readonly settings: Readonly<Record<string, unknown>>;
}
export interface ViewResult {
  meta: unknown;
  buffers: ArrayBufferLike[];
}

export interface HistogramDefinition {
  id: string;
  label: string;
  /** Unit of the x axis (e.g. 'ms' for ISI, 's' for firing rate over time). */
  unit?: string;
  /** x range covered by the bins; renderers fall back to bin indices when absent. */
  range?(ctx: ComputeContext): [number, number];
  compute(spikeIds: Int32Array, ctx: ComputeContext): Float64Array;
}

export type * from './protocol';
