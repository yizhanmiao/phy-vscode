import type { Plot, RendererHost, SelectionMsg, ViewRenderer } from '@phy-vscode/api';

type Loader = (url: string) => Promise<unknown>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A `ViewRenderer` backed by an ES module loaded from `url`. The module exports `mount`, `update` and `dispose`, or a default
 * function returning them. Updates that arrive while it loads are held (the latest wins) and replayed after `mount`.
 * `report` is called with no argument after a replayed update succeeds, and once with a message on any failure.
 */
export function moduleRenderer(url: string, report: (error?: string) => void, load: Loader = (u) => import(/* @vite-ignore */ u)): ViewRenderer {
  let inner: ViewRenderer | undefined;
  let failed = false;
  let disposed = false;
  let held: [unknown, ArrayBuffer[], SelectionMsg] | undefined;
  const fail = (text: string) => {
    failed = true;
    held = undefined;
    report(text);
  };
  return {
    mount(el: HTMLElement, plot: Plot, host: RendererHost) {
      load(url).then(
        (mod) => {
          if (disposed) return;
          const m = mod as { default?: unknown } & Partial<ViewRenderer>;
          let r: Partial<ViewRenderer> | null | undefined;
          try {
            r = typeof m.default === 'function' ? (m.default as () => Partial<ViewRenderer>)() : m;
          } catch (e) {
            fail(`could not start renderer ${url}: ${message(e)}`);
            return;
          }
          if (typeof r?.mount !== 'function' || typeof r?.update !== 'function' || typeof r?.dispose !== 'function') {
            fail(`renderer ${url} must export mount, update and dispose`);
            return;
          }
          inner = r as ViewRenderer;
          try {
            inner.mount(el, plot, host);
            if (held) {
              const h = held;
              held = undefined;
              inner.update(...h);
              report(undefined);
            }
          } catch (e) {
            fail(`render error: ${message(e)}`);
          }
        },
        (e) => {
          if (!disposed) fail(`could not load renderer ${url}: ${message(e)}`);
        },
      );
    },
    update(meta, buffers, selection) {
      if (failed) return;
      if (inner) inner.update(meta, buffers, selection);
      else held = [meta, buffers, selection];
    },
    dispose() {
      disposed = true;
      held = undefined;
      inner?.dispose();
      inner = undefined;
    },
  };
}
