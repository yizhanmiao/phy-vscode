import { createDockview, themeDark, themeLight, type DockviewApi, type GroupPanelPartInitParameters, type IContentRenderer, type SerializedDockview } from 'dockview-core';
import type { HostToPlot, PlotToHost } from '@phy-vscode/api';
import { vscodeApi } from '../vscode';
import { newViews, packLayout, unpackLayout } from './layout';
import { moduleRenderer } from './moduleRenderer';
import { createPlot, type Plot } from './plot';
import type { RendererHost, ViewRenderer } from './renderer';
import { missingRenderer, renderers } from './renderers';
import { EMPTY } from './scene';

interface LocalState {
  layout?: unknown;
  settings: Record<string, Record<string, unknown>>;
  states: Record<string, unknown>;
}
interface Slot {
  viewId: string;
  renderer: ViewRenderer;
  plot: Plot;
  header: HTMLElement;
  visible: boolean;
  lastSeq: number;
}

const vscode = vscodeApi<LocalState>();
const post = (m: PlotToHost) => vscode.postMessage(m);
const root = document.getElementById('root')!;
const slots = new Map<string, Slot>();
let local: LocalState = vscode.getState() ?? { settings: {}, states: {} };
let titles = new Map<string, string>();
let rendererUris = new Map<string, string>();
const known = new Set<string>(); // every view this webview's layout has been offered; closed views stay in it
let api: DockviewApi | undefined;

/** Default tiling: Waveform left; Feature, Correlogram, Amplitude, Cluster statistics around it. */
const DEFAULT_POSITION: Record<string, { referencePanel: string; direction: 'right' | 'below' } | undefined> = {
  waveform: undefined,
  feature: { referencePanel: 'waveform', direction: 'right' },
  correlogram: { referencePanel: 'feature', direction: 'below' },
  amplitude: { referencePanel: 'waveform', direction: 'below' },
  cluster_statistics: { referencePanel: 'correlogram', direction: 'right' },
};

const saveLocal = () => vscode.setState({ ...local, layout: api && packLayout(api.toJSON(), known) });
const reportVisible = () => post({ type: 'visible', viewIds: [...slots.values()].filter((s) => s.visible).map((s) => s.viewId) });

function hostFor(viewId: string): RendererHost {
  return {
    get settings() {
      return local.settings[viewId] ?? {};
    },
    setSettings(settings) {
      local.settings = { ...local.settings, [viewId]: { ...local.settings[viewId], ...settings } };
      saveLocal();
      post({ type: 'viewEvent', viewId, payload: { kind: 'settings', settings } });
    },
    getState<T>() {
      return local.states[viewId] as T | undefined;
    },
    setState(state) {
      local.states = { ...local.states, [viewId]: state };
      saveLocal();
      post({ type: 'viewEvent', viewId, payload: { kind: 'state', state } });
    },
  };
}

function rendererFor(viewId: string): ViewRenderer {
  const builtin = renderers[viewId];
  if (builtin) return builtin();
  const uri = rendererUris.get(viewId);
  return uri ? moduleRenderer(uri, (error) => reportRendered(viewId, error)) : missingRenderer();
}

/** A mod renderer finished after its first `update` returned: say how it went (the host's render log and the header). */
function reportRendered(viewId: string, error?: string): void {
  const slot = slots.get(viewId);
  if (!slot) return;
  if (error) setHeader(slot, error, true);
  post({ type: 'rendered', viewId, seq: slot.lastSeq, error });
}

class ViewPanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private viewId = '';
  init(params: GroupPanelPartInitParameters): void {
    this.viewId = String(params.params.viewId);
    this.element.className = 'phy-view';
    const header = document.createElement('div');
    header.className = 'phy-header';
    const body = document.createElement('div');
    body.className = 'phy-body';
    this.element.append(header, body);
    const plot = createPlot(body);
    const renderer = rendererFor(this.viewId);
    const slot: Slot = { viewId: this.viewId, renderer, plot, header, visible: params.api.isVisible, lastSeq: 0 };
    slots.set(this.viewId, slot);
    renderer.mount(body, plot, hostFor(this.viewId));
    params.api.onDidVisibilityChange((e) => {
      slot.visible = e.isVisible;
      reportVisible();
    });
    reportVisible();
  }
  dispose(): void {
    const slot = slots.get(this.viewId);
    if (!slot) return;
    slot.renderer.dispose();
    slot.plot.dispose();
    slots.delete(this.viewId);
    reportVisible();
  }
}

function addView(id: string, position?: { referencePanel: string; direction: 'right' | 'below' }): void {
  if (!api || api.getPanel(id)) return;
  const usable = position && api.getPanel(position.referencePanel) ? position : undefined;
  api.addPanel({ id, component: 'view', title: titles.get(id) ?? id, params: { viewId: id }, ...(usable ? { position: usable } : {}) });
}

function init(m: Extract<HostToPlot, { type: 'init' }>): void {
  titles = new Map(m.views.map((v) => [v.id, v.title]));
  rendererUris = new Map(m.views.flatMap((v) => (v.rendererUri ? [[v.id, v.rendererUri] as const] : [])));
  local = { settings: { ...m.settings, ...local.settings }, states: { ...m.states, ...local.states }, layout: local.layout ?? m.layout };
  if (api) return;
  api = createDockview(root, {
    createComponent: () => new ViewPanel(),
    theme: document.body.classList.contains('vscode-light') ? themeLight : themeDark,
  });
  const registered = m.views.map((v) => v.id);
  const saved = unpackLayout(local.layout);
  let restored = false;
  if (saved) {
    try {
      api.fromJSON(saved.dock as SerializedDockview);
      restored = true;
      for (const k of saved.known) known.add(k);
    } catch {
      api.clear();
    }
  }
  if (restored) {
    for (const p of [...api.panels]) if (!registered.includes(p.id)) api.removePanel(p); // a plugin that is gone
    for (const id of newViews(registered, known)) addView(id, DEFAULT_POSITION[id]); // a plugin that is new
  } else {
    for (const id of registered) addView(id, DEFAULT_POSITION[id]);
  }
  for (const id of registered) known.add(id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  api.onDidLayoutChange(() => {
    saveLocal();
    clearTimeout(timer);
    timer = setTimeout(() => post({ type: 'persist', layout: packLayout(api!.toJSON(), known) }), 500);
  });
}

function setHeader(slot: Slot, text: string, error: boolean): void {
  slot.header.textContent = text;
  slot.header.classList.toggle('error', error);
}

window.addEventListener('message', (e: MessageEvent<HostToPlot>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      init(m);
      break;
    case 'viewData': {
      const slot = slots.get(m.viewId);
      if (!slot || m.seq < slot.lastSeq) return;
      slot.lastSeq = m.seq;
      const notice = (m.meta as { notice?: unknown } | null)?.notice;
      setHeader(slot, typeof notice === 'string' ? notice : '', false);
      try {
        slot.renderer.update(m.meta, m.buffers, m.selection);
        post({ type: 'rendered', viewId: m.viewId, seq: m.seq });
      } catch (err) {
        const message = `render error: ${err instanceof Error ? err.message : String(err)}`;
        setHeader(slot, message, true);
        post({ type: 'rendered', viewId: m.viewId, seq: m.seq, error: message });
      }
      break;
    }
    case 'viewError': {
      const slot = slots.get(m.viewId);
      if (!slot || m.seq < slot.lastSeq) return;
      slot.lastSeq = m.seq;
      setHeader(slot, m.message, true);
      slot.plot.setScene(EMPTY(m.message));
      post({ type: 'rendered', viewId: m.viewId, seq: m.seq, error: m.message });
      break;
    }
    case 'toggleView': {
      const panel = api?.getPanel(m.viewId);
      if (panel) api!.removePanel(panel);
      else addView(m.viewId);
      break;
    }
  }
});

post({ type: 'ready' });
