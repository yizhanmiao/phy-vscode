import type { Plot, RendererHost, SelectionMsg } from '@phy-vscode/api';
import { describe, expect, it, vi } from 'vitest';
import { moduleRenderer } from '../src/webview/plot/moduleRenderer';

const el = {} as HTMLElement;
const plot = {} as Plot;
const host = {} as RendererHost;
const sel: SelectionMsg = { ids: [], colors: [] };
const flush = () => new Promise((r) => setTimeout(r, 0));
const mod = () => ({ mount: vi.fn(), update: vi.fn(), dispose: vi.fn() });

describe('moduleRenderer', () => {
  it('mounts after the module loads and replays only the latest update held meanwhile', async () => {
    const m = mod();
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => m);
    r.mount(el, plot, host);
    r.update(1, [], sel);
    r.update(2, [], sel);
    expect(m.mount).not.toHaveBeenCalled();
    await flush();
    expect(m.mount).toHaveBeenCalledWith(el, plot, host);
    expect(m.update.mock.calls).toEqual([[2, [], sel]]);
    expect(report).toHaveBeenCalledWith(undefined);
    r.update(3, [], sel);
    expect(m.update).toHaveBeenLastCalledWith(3, [], sel);
    r.dispose();
    expect(m.dispose).toHaveBeenCalledOnce();
  });

  it('accepts a default factory', async () => {
    const m = mod();
    const r = moduleRenderer('u', vi.fn(), async () => ({ default: () => m }));
    r.mount(el, plot, host);
    await flush();
    r.update(1, [], sel);
    expect(m.update).toHaveBeenCalledOnce();
  });

  it('reports a load failure once and ignores later updates', async () => {
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => {
      throw new Error('404');
    });
    r.mount(el, plot, host);
    r.update(1, [], sel);
    await flush();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toMatch(/could not load.*404/);
    expect(() => r.update(2, [], sel)).not.toThrow();
  });

  it('rejects a module without the renderer contract', async () => {
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => ({ mount() {} }));
    r.mount(el, plot, host);
    await flush();
    expect(report.mock.calls[0][0]).toMatch(/mount, update and dispose/);
  });

  it('rejects a default factory that returns nothing, reporting once', async () => {
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => ({ default: () => undefined }));
    r.mount(el, plot, host);
    await flush();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toMatch(/mount, update and dispose/);
    expect(() => r.update(1, [], sel)).not.toThrow();
  });

  it('reports a throw from the replayed update', async () => {
    const m = mod();
    m.update.mockImplementation(() => {
      throw new Error('bad meta');
    });
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => m);
    r.mount(el, plot, host);
    r.update(1, [], sel);
    await flush();
    expect(report.mock.calls[0][0]).toMatch(/render error: bad meta/);
  });

  it('reports a throwing default factory once and ignores later updates', async () => {
    const report = vi.fn();
    const r = moduleRenderer('u', report, async () => ({
      default: () => {
        throw new Error('boom');
      },
    }));
    r.mount(el, plot, host);
    await flush();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toMatch(/could not start.*boom/);
    expect(() => r.update(1, [], sel)).not.toThrow();
  });

  it('does not mount a module that arrives after dispose', async () => {
    const m = mod();
    const r = moduleRenderer('u', vi.fn(), async () => m);
    r.mount(el, plot, host);
    r.dispose();
    await flush();
    expect(m.mount).not.toHaveBeenCalled();
  });
});
