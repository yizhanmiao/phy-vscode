import type { ClusterMetricDefinition } from '@phy-vscode/api';
import { expect, it, onTestFinished, vi } from 'vitest';
import { openDataset } from '../src/host/dataset/dataset';
import { Session } from '../src/host/session';
import { fixtureParams } from './fixtures/makeFixture';

async function sessionWith(initial: ClusterMetricDefinition[]) {
  let defs: readonly ClusterMetricDefinition[] = initial;
  const warn = vi.fn();
  const session = new Session(await openDataset(fixtureParams('base')), { metrics: () => defs, warn });
  onTestFinished(async () => {
    session.dispose();
    await session.dataset.close();
  });
  return { session, warn, set: (d: ClusterMetricDefinition[]) => (defs = d) };
}
const metric = (id: string, compute: ClusterMetricDefinition['compute']): ClusterMetricDefinition => ({ id, label: `L ${id}`, compute });
const col = (s: Session, id: string) => {
  const i = s.clusters.columns.indexOf(id);
  return s.clusters.rows.map((r) => r[i]);
};

it('appends a column per metric after the dataset columns, with its label', async () => {
  const { session } = await sessionWith([metric('double', (id) => id * 2)]);
  expect(session.clusters.columns.slice(-3)).toEqual(['ContamPct', 'KSLabel', 'double']);
  expect(col(session, 'double')).toEqual(session.clusters.rows.map((r) => (r[0] as number) * 2));
  expect(session.metricLabels()).toEqual({ double: 'L double' });
});

it('hands the metric the session', async () => {
  const { session } = await sessionWith([metric('count', (id, ctx) => ctx.session.spikesOf(id).length)]);
  expect(col(session, 'count')).toEqual(col(session, 'n_spikes'));
});

it('leaves a cell empty when the metric throws or returns something unusable, and warns once', async () => {
  const flaky = metric('flaky', (id) => {
    if (id === 2) throw new Error('boom');
    if (id === 7) return NaN;
    if (id === 11) return {} as never;
    return 'ok';
  });
  const { session, warn } = await sessionWith([flaky]);
  const ids = session.clusters.rows.map((r) => r[0]);
  const values = col(session, 'flaky');
  expect(values[ids.indexOf(2)]).toBeNull();
  expect(values[ids.indexOf(7)]).toBeNull();
  expect(values.filter((v) => v === 'ok').length).toBe(ids.length - 2 - (ids.includes(11) ? 1 : 0));
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/flaky.*cluster 2.*boom/);
});

it('skips a metric that reuses a dataset column, warning once', async () => {
  const { session, warn } = await sessionWith([metric('n_spikes', () => 0), metric('KSLabel', () => 'x')]);
  expect(session.clusters.columns.filter((c) => c === 'n_spikes')).toHaveLength(1);
  expect(session.clusters.rows.every((r) => r[1] !== 0)).toBe(true);
  void session.clusters;
  expect(warn).toHaveBeenCalledTimes(2);
  expect(session.metricLabels()).toEqual({});
});

it('computes a new metric without recomputing the existing ones, and keeps the table until the set changes', async () => {
  const a = vi.fn(() => 1);
  const first = metric('a', a);
  const { session, set } = await sessionWith([first]);
  const t1 = session.clusters;
  expect(session.clusters).toBe(t1);
  const calls = a.mock.calls.length;
  set([first, metric('b', () => 2)]);
  expect(col(session, 'b').every((v) => v === 2)).toBe(true);
  expect(a).toHaveBeenCalledTimes(calls);
  set([]);
  expect(session.clusters.columns).not.toContain('a');
});
