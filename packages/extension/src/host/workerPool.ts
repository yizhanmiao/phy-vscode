import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Compute, ComputeFns, ComputeName } from '../compute';

const MAX_DEATHS = 3;

interface Job {
  name: ComputeName;
  args: unknown[];
  resolve(v: unknown): void;
  reject(e: Error): void;
}

export class WorkerPool implements Compute {
  private readonly idle: Worker[] = [];
  private readonly queue: Job[] = [];
  private readonly running = new Map<Worker, Job>();
  private disposed = false;
  private deaths = 0; // consecutive worker deaths with no job completed
  private broken: Error | undefined;

  constructor(private readonly script: string, size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  run<K extends ComputeName>(name: K, ...args: Parameters<ComputeFns[K]>): Promise<ReturnType<ComputeFns[K]>> {
    if (this.disposed) return Promise.reject(new Error('worker pool disposed'));
    if (this.broken) return Promise.reject(this.broken);
    return new Promise((resolve, reject) => {
      this.queue.push({ name, args, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const gone = new Error('worker pool disposed');
    for (const job of this.queue.splice(0)) job.reject(gone);
    for (const job of this.running.values()) job.reject(gone);
    const workers = [...this.idle, ...this.running.keys()];
    this.running.clear();
    this.idle.length = 0;
    await Promise.all(workers.map((w) => w.terminate()));
  }

  private spawn(): void {
    const w = new Worker(this.script);
    w.on('message', (m: { result?: unknown; error?: string }) => {
      this.deaths = 0;
      const job = this.running.get(w);
      this.running.delete(w);
      this.idle.push(w);
      if (job) {
        if (m.error !== undefined) job.reject(new Error(m.error));
        else job.resolve(m.result);
      }
      this.pump();
    });
    let cause: Error | undefined;
    w.on('error', (e: Error) => { cause = e; });
    w.on('exit', (code) => {
      const job = this.running.get(w);
      this.running.delete(w);
      const i = this.idle.indexOf(w);
      if (i >= 0) this.idle.splice(i, 1);
      job?.reject(cause ?? new Error(`worker exited with code ${code}`));
      if (this.disposed) return;
      if (++this.deaths >= MAX_DEATHS) {
        this.broken = new Error(`worker script ${this.script} keeps failing: ${cause?.message ?? `exit code ${code}`}`);
        for (const j of this.queue.splice(0)) j.reject(this.broken);
        return;
      }
      this.spawn();
      this.pump();
    });
    this.idle.push(w);
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(w, job);
      w.postMessage({ name: job.name, args: job.args });
    }
  }
}
