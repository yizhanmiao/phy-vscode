import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_VERSION, type ClusterUpdate, type PhyApi, type PhySession } from '@phy-vscode/api';
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/host/emitter';
import { ModRegistry, type RegistryChange } from '../src/host/modRegistry';
import { createPhyApi } from '../src/host/phyApi';
import { discoverPlugins, PluginHost, pluginRoots, requireLoader } from '../src/host/plugins';

const write = (file: string, body: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
};
const metricPlugin = (id: string) => `exports.activate = (api) => { api.registerClusterMetric({ id: '${id}', label: '${id}', compute: () => 1 }); };`;

const tmpDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'phy-plugins-'))); // real path: the module cache is keyed by it

function setup(timeoutMs?: number) {
  const dir = tmpDir();
  const mods = new ModRegistry();
  const sel = new Emitter<readonly number[]>();
  const opened = new Emitter<PhySession>();
  const session: PhySession = {
    dataset: {} as PhySession['dataset'],
    clusters: { columns: ['id'], rows: [] },
    selection: [],
    select: () => {},
    spikesOf: () => new Int32Array(0),
    colorOf: () => '#000',
    onDidChangeSelection: sel.event,
    onDidChangeClusters: new Emitter<ClusterUpdate>().event,
  };
  const api = createPhyApi(mods, { activeSession: () => session, onDidOpenSession: opened.event });
  const log = vi.fn();
  const host = new PluginHost({ api, loader: requireLoader(createRequire(import.meta.url)), roots: () => [dir], log, hold: () => mods.hold(), timeoutMs });
  const ids = () => mods.metrics().map((m) => m.id);
  return { dir, mods, host, log, ids, sel, opened, session };
}

describe('PluginHost', () => {
  it('loads top-level .js files and folder plugins (index.js), in name order, and nothing else', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'b.js'), metricPlugin('b'));
    write(join(dir, 'a.js'), metricPlugin('a'));
    write(join(dir, 'folder', 'index.js'), metricPlugin('c'));
    write(join(dir, 'folder', 'other.js'), 'throw new Error("must not be loaded")');
    write(join(dir, 'node_modules', 'x', 'index.js'), 'throw new Error("must not be loaded")');
    write(join(dir, '.hidden.js'), 'throw new Error("must not be loaded")');
    write(join(dir, 'notes.txt'), 'not js');
    expect(await host.load()).toEqual({ loaded: 3, problems: [] });
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('skips a file without activate(), quietly', async () => {
    const { dir, host, log } = setup();
    write(join(dir, 'lib.js'), 'exports.x = 1;');
    expect(await host.load()).toEqual({ loaded: 0, problems: [] });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/lib\.js: no activate\(\) export/));
  });

  it('refuses a plugin that needs another API version, and accepts a compatible one', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'old.js'), `exports.apiVersion = '^9.0.0'; ${metricPlugin('old')}`);
    write(join(dir, 'ok.js'), `exports.apiVersion = '^${API_VERSION}'; ${metricPlugin('ok')}`);
    const r = await host.load();
    expect(r.loaded).toBe(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/old\.js: needs API \^9\.0\.0, this phy-vscode has /);
    expect(ids()).toEqual(['ok']);
  });

  it('isolates a failing plugin and undoes its partial registrations', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'bad.js'), `exports.activate = (api) => { api.registerClusterMetric({ id: 'half', label: 'h', compute: () => 1 }); throw new Error('boom'); };`);
    write(join(dir, 'broken.js'), 'this is not javascript');
    write(join(dir, 'good.js'), metricPlugin('good'));
    const r = await host.load();
    expect(r.loaded).toBe(1);
    expect(r.problems.map((p) => p.replace(dir, ''))).toEqual([expect.stringMatching(/bad\.js: boom/), expect.stringMatching(/broken\.js: /)]);
    expect(ids()).toEqual(['good']);
  });

  it('awaits an async activate and disposes what it returns on unload', async () => {
    const { dir, host, mods } = setup();
    delete (globalThis as { __phyDisposed?: boolean }).__phyDisposed;
    write(join(dir, 'a.js'), `exports.activate = async (api) => { await null; api.registerHistogram({ id: 'h', label: 'h', compute: () => new Float64Array(1) }); return { dispose() { globalThis.__phyDisposed = true; } }; };`);
    await host.load();
    expect(mods.histograms().some((h) => h.id === 'h')).toBe(true);
    await host.reload();
    expect((globalThis as { __phyDisposed?: boolean }).__phyDisposed).toBe(true);
  });

  it('load runs under one hold, so plugins registering during startup produce one merged change event', async () => {
    const { dir, host, mods } = setup();
    write(join(dir, 'a.js'), metricPlugin('a'));
    write(join(dir, 'b.js'), metricPlugin('b'));
    const events: RegistryChange[] = [];
    mods.onDidChange((c) => events.push(c));
    await host.load();
    expect(events).toEqual([{ views: false, metrics: true, histograms: false }]);
  });

  it('reports a plugin whose activate never settles, loads the others, and ignores a late registration', async () => {
    const { dir, host, ids } = setup(20);
    const g = globalThis as { __phyLate?: () => void; __phyLateErr?: string };
    delete g.__phyLate;
    delete g.__phyLateErr;
    write(
      join(dir, 'a-hung.js'),
      `exports.activate = (api) => new Promise((resolve) => { globalThis.__phyLate = () => { try { api.registerClusterMetric({ id: 'late', label: 'l', compute: () => 1 }); } catch (e) { globalThis.__phyLateErr = e.message; } resolve(); }; });`,
    );
    write(join(dir, 'b-ok.js'), metricPlugin('ok'));
    const r = await host.load();
    expect(r.loaded).toBe(1);
    expect(r.problems.map((p) => p.replace(dir, ''))).toEqual(['/a-hung.js: activate did not finish within 0.02 s']);
    expect(ids()).toEqual(['ok']);
    g.__phyLate!();
    expect(g.__phyLateErr).toBe('plugin unloaded');
    expect(ids()).toEqual(['ok']);
  });

  it('a deactivate that never settles is logged and reload still completes and releases its hold', async () => {
    const { dir, host, mods, log, ids } = setup(20);
    write(join(dir, 'a.js'), `${metricPlugin('a')} exports.deactivate = () => new Promise(() => {});`);
    await host.load();
    expect((await host.reload()).loaded).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/a\.js: deactivate failed: deactivate did not finish within 0\.02 s/));
    expect(ids()).toEqual(['a']);
    const events: RegistryChange[] = [];
    mods.onDidChange((c) => events.push(c));
    mods.registerClusterMetric({ id: 'z', label: 'z', compute: () => 1 });
    expect(events).toHaveLength(1); // not held back
  });

  it('reload picks up edited plugin and sibling files, drops the old registrations, and emits one change', async () => {
    const { dir, host, mods, ids } = setup();
    write(join(dir, 'p', 'helper.js'), `exports.id = 'v1';`);
    write(join(dir, 'p', 'index.js'), `const h = require('./helper'); exports.activate = (api) => { api.registerClusterMetric({ id: h.id, label: 'x', compute: () => 1 }); };`);
    await host.load();
    expect(ids()).toEqual(['v1']);
    write(join(dir, 'p', 'helper.js'), `exports.id = 'v2';`);
    const events: RegistryChange[] = [];
    mods.onDidChange((c) => events.push(c));
    expect((await host.reload()).loaded).toBe(1);
    expect(ids()).toEqual(['v2']);
    expect(events).toEqual([{ views: false, metrics: true, histograms: false }]);
  });

  it('reload picks up a fixed plugin whose activate threw', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'a.js'), `exports.activate = () => { throw new Error('boom'); };`);
    expect((await host.load()).problems).toHaveLength(1);
    write(join(dir, 'a.js'), metricPlugin('fixed'));
    expect((await host.reload()).loaded).toBe(1);
    expect(ids()).toEqual(['fixed']);
  });

  it('reload picks up a plugin that was refused for its apiVersion and then made compatible', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'a.js'), `exports.apiVersion = '^9.0.0'; ${metricPlugin('v')}`);
    expect((await host.load()).problems).toHaveLength(1);
    write(join(dir, 'a.js'), `exports.apiVersion = '^${API_VERSION}'; ${metricPlugin('v')}`);
    expect((await host.reload()).loaded).toBe(1);
    expect(ids()).toEqual(['v']);
  });

  it('reload picks up a plugin that had no activate() and now has one', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'a.js'), 'exports.x = 1;');
    await host.load();
    write(join(dir, 'a.js'), metricPlugin('now'));
    expect((await host.reload()).loaded).toBe(1);
    expect(ids()).toEqual(['now']);
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')('an unreadable root is logged and the other roots still load', async () => {
    const { dir, mods, log } = setup();
    mkdirSync(join(dir, 'locked'));
    write(join(dir, 'good', 'a.js'), metricPlugin('good'));
    const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: new Emitter<PhySession>().event });
    const host = new PluginHost({ api, loader: requireLoader(createRequire(import.meta.url)), roots: () => [join(dir, 'locked'), join(dir, 'good')], log, hold: () => mods.hold() });
    try {
      chmodSync(join(dir, 'locked'), 0o000); // cannot be listed
      expect(await host.load()).toEqual({ loaded: 1, problems: [] });
    } finally {
      chmodSync(join(dir, 'locked'), 0o755);
    }
    expect(mods.metrics().map((m) => m.id)).toEqual(['good']);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/plugin path unreadable: .*locked: /));
  });

  it('calls deactivate on unload', async () => {
    const { dir, host } = setup();
    delete (globalThis as { __phyDeactivated?: number }).__phyDeactivated;
    write(join(dir, 'a.js'), `${metricPlugin('a')} exports.deactivate = () => { globalThis.__phyDeactivated = (globalThis.__phyDeactivated ?? 0) + 1; };`);
    await host.load();
    await host.reload();
    expect((globalThis as { __phyDeactivated?: number }).__phyDeactivated).toBe(1);
  });

  it('removes onDidOpenSession listeners on unload', async () => {
    const { dir, host, opened, session } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { api.onDidOpenSession(() => { globalThis.__phyOpened = (globalThis.__phyOpened ?? 0) + 1; }); };`);
    (globalThis as { __phyOpened?: number }).__phyOpened = 0;
    await host.load();
    await host.reload();
    opened.fire(session);
    expect((globalThis as { __phyOpened?: number }).__phyOpened).toBe(1);
  });

  const count = (key: string) => (globalThis as Record<string, unknown>)[key] as number;
  const subscribe = (key: string) => `api.activeSession().onDidChangeSelection(() => { globalThis.${key} = (globalThis.${key} ?? 0) + 1; });`;

  it('undoes session subscriptions made by a plugin that then throws', async () => {
    const { dir, host, sel } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { ${subscribe('__phySelThrow')} throw new Error('boom'); };`);
    await host.load();
    sel.fire([1]);
    expect(count('__phySelThrow')).toBeUndefined();
  });

  it('removes session subscriptions (via activeSession and via onDidOpenSession) on reload', async () => {
    const { dir, host, sel, opened, session } = setup();
    write(
      join(dir, 'a.js'),
      `exports.activate = (api) => { ${subscribe('__phySelReload')} api.onDidOpenSession((s) => s.onDidChangeSelection(() => { globalThis.__phySelOpened = (globalThis.__phySelOpened ?? 0) + 1; })); };`,
    );
    await host.load();
    opened.fire(session);
    await host.reload();
    (globalThis as Record<string, unknown>).__phySelReload = 0;
    (globalThis as Record<string, unknown>).__phySelOpened = 0;
    opened.fire(session);
    sel.fire([1]);
    expect(count('__phySelReload')).toBe(1);
    expect(count('__phySelOpened')).toBe(1);
  });

  it('hands a plugin the same session object every time', async () => {
    const { dir, host, opened, session } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { api.onDidOpenSession((s) => { globalThis.__phySame = s === api.activeSession(); }); globalThis.__phySame0 = api.activeSession() === api.activeSession(); };`);
    await host.load();
    opened.fire(session);
    expect((globalThis as Record<string, unknown>).__phySame0).toBe(true);
    expect((globalThis as Record<string, unknown>).__phySame).toBe(true);
  });

  it('wraps the session without changing what it reads or does', async () => {
    const { dir, host } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { const s = api.activeSession(); globalThis.__phyRead = [s.clusters.columns[0], s.selection.length, s.colorOf(1), s.spikesOf(1).length, typeof s.select, typeof s.dataset]; };`);
    await host.load();
    expect((globalThis as Record<string, unknown>).__phyRead).toEqual(['id', 0, '#000', 0, 'function', 'object']);
  });

  it('a scoped API used after its plugin was unloaded throws and registers nothing', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { exports.late = () => api.registerClusterMetric({ id: 'late', label: 'l', compute: () => 1 }); };`);
    await host.load();
    const mod = createRequire(import.meta.url)(join(dir, 'a.js')) as { late(): void };
    await host.reload();
    expect(() => mod.late()).toThrow('plugin unloaded');
    expect(ids()).toEqual([]);
  });

  it('a scoped API used after its plugin failed to activate throws and registers nothing', async () => {
    const { dir, host, ids } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { globalThis.__phyLateApi = api; throw new Error('boom'); };`);
    await host.load();
    const api = (globalThis as unknown as { __phyLateApi: PhyApi }).__phyLateApi;
    expect(() => api.registerClusterMetric({ id: 'late', label: 'l', compute: () => 1 })).toThrow('plugin unloaded');
    expect(() => api.activeSession()?.onDidChangeSelection(() => {})).toThrow('plugin unloaded');
    expect(ids()).toEqual([]);
  });

  it('survives a plugin that throws a value that cannot be printed', async () => {
    const { dir, host } = setup();
    write(join(dir, 'a.js'), `exports.activate = () => { throw Object.create(null); };`);
    const r = await host.load();
    expect(r.problems).toEqual([expect.stringMatching(/a\.js: non-printable error/)]);
  });
});

describe('discoverPlugins and pluginRoots', () => {
  it('reports a plugin once when two roots reach the same file', () => {
    const dir = tmpDir();
    write(join(dir, 'one.js'), metricPlugin('one'));
    const found = discoverPlugins([dir, join(dir, 'one.js')], vi.fn());
    expect(found).toEqual([{ file: join(dir, 'one.js'), scope: join(dir, 'one.js') }]);
  });

  it('logs a missing path instead of throwing, and accepts a single file as a root', () => {
    const dir = tmpDir();
    write(join(dir, 'one.js'), metricPlugin('one'));
    const log = vi.fn();
    const found = discoverPlugins([join(dir, 'missing'), join(dir, 'one.js')], log);
    expect(found).toEqual([{ file: join(dir, 'one.js'), scope: join(dir, 'one.js') }]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/plugin path not found: .*missing/));
  });

  it('uses the default folder, expands ~/, and ignores relative or non-string entries', () => {
    const log = vi.fn();
    expect(pluginRoots(['~/mine', '/abs/other', 'relative/dir', 5, '', '/abs/other'], '/home/u', log)).toEqual([
      '/home/u/.phy-vscode/plugins',
      '/home/u/mine',
      '/abs/other',
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/'relative\/dir' ignored/));
    expect(pluginRoots(undefined, '/home/u', log)).toEqual(['/home/u/.phy-vscode/plugins']);
  });
});
