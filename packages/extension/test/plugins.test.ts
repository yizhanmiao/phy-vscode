import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_VERSION, type PhySession } from '@phy-vscode/api';
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

function setup() {
  const dir = tmpDir();
  const mods = new ModRegistry();
  const api = createPhyApi(mods, { activeSession: () => undefined, onDidOpenSession: new Emitter<PhySession>().event });
  const log = vi.fn();
  const host = new PluginHost({ api, loader: requireLoader(createRequire(import.meta.url)), roots: () => [dir], log, hold: () => mods.hold() });
  const ids = () => mods.metrics().map((m) => m.id);
  return { dir, mods, host, log, ids };
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
    write(join(dir, 'a.js'), `exports.activate = async (api) => { await null; api.registerHistogram({ id: 'h', label: 'h', compute: () => new Float64Array(1) }); return { dispose() { globalThis.__phyDisposed = true; } }; };`);
    await host.load();
    expect(mods.histograms().some((h) => h.id === 'h')).toBe(true);
    await host.reload();
    expect((globalThis as { __phyDisposed?: boolean }).__phyDisposed).toBe(true);
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

  it('calls deactivate on unload', async () => {
    const { dir, host } = setup();
    write(join(dir, 'a.js'), `${metricPlugin('a')} exports.deactivate = () => { globalThis.__phyDeactivated = (globalThis.__phyDeactivated ?? 0) + 1; };`);
    await host.load();
    await host.reload();
    expect((globalThis as { __phyDeactivated?: number }).__phyDeactivated).toBeGreaterThanOrEqual(1);
  });

  it('tracks onDidOpenSession listeners too', async () => {
    const { dir, host } = setup();
    write(join(dir, 'a.js'), `exports.activate = (api) => { api.onDidOpenSession(() => {}); };`);
    expect((await host.load()).loaded).toBe(1);
    await host.reload();
  });
});

describe('discoverPlugins and pluginRoots', () => {
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
