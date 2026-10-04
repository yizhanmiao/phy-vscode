import { AXIS_INSET, BARE_INSET, barTriangles, gridRects, inset, interleave, lineJitter, parseColor, polylineSegments, toCss, withAlpha, type Rect } from './geometry';
import type { Layer, Panel, Rgba, Scene } from './scene';
import { formatTick, niceTicks } from './ticks';
import { carryView, panRange, zoomRange, type Range } from './view';

export interface Theme {
  fg: Rgba;
  muted: Rgba;
  bg: Rgba;
}
export interface PlotClick {
  panel: number;
  x: number;
  y: number;
  shift: boolean;
  button: number;
}
export interface Plot {
  setScene(scene: Scene): void;
  onClick(listener: (e: PlotClick) => void): void;
  theme(): Theme;
  dispose(): void;
}

const VS = `#version 300 es
in vec2 a_pos;
uniform vec2 u_min;
uniform vec2 u_max;
uniform float u_size;
uniform vec2 u_px;
void main() {
  gl_Position = vec4((a_pos - u_min) / (u_max - u_min) * 2.0 - 1.0 + u_px, 0.0, 1.0);
  gl_PointSize = u_size;
}`;
const FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform float u_round;
out vec4 outColor;
void main() {
  if (u_round > 0.5 && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
  outColor = u_color;
}`;

interface GpuLayer {
  mode: number;
  buffer: WebGLBuffer;
  count: number;
  color: Rgba;
  size: number;
  round: boolean;
  width: number; // line width, CSS px
}
interface PanelState {
  panel: Panel;
  view: { x: Range; y: Range };
  gpu: GpuLayer[];
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile error');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'shader link error');
  return p;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    fg: parseColor(v('--vscode-editor-foreground', '#cccccc')),
    muted: parseColor(v('--vscode-descriptionForeground', '#888888')),
    bg: parseColor(v('--vscode-editor-background', '#1e1e1e')),
  };
}

export function createPlot(container: HTMLElement): Plot {
  const glCanvas = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  for (const c of [glCanvas, overlay]) Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
  overlay.style.pointerEvents = 'none';
  container.append(glCanvas, overlay);
  const gl = glCanvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is not available in this webview');
  const ctx = overlay.getContext('2d')!;
  const program = link(gl);
  const loc = {
    pos: gl.getAttribLocation(program, 'a_pos'),
    min: gl.getUniformLocation(program, 'u_min'),
    max: gl.getUniformLocation(program, 'u_max'),
    size: gl.getUniformLocation(program, 'u_size'),
    px: gl.getUniformLocation(program, 'u_px'),
    color: gl.getUniformLocation(program, 'u_color'),
    round: gl.getUniformLocation(program, 'u_round'),
  };
  const vao = gl.createVertexArray();
  let scene: Scene = { rows: 1, cols: 1, panels: [] };
  let panels: PanelState[] = [];
  let areas: Rect[] = [];
  const listeners: ((e: PlotClick) => void)[] = [];
  let pending = 0;

  const upload = (layer: Layer): GpuLayer => {
    const data =
      layer.kind === 'scatter' ? interleave(layer.x, layer.y)
      : layer.kind === 'lines' ? polylineSegments(layer.x, layer.y)
      : barTriangles(layer.x0, layer.dx, layer.heights, !!layer.horizontal);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return {
      mode: layer.kind === 'scatter' ? gl.POINTS : layer.kind === 'lines' ? gl.LINES : gl.TRIANGLES,
      buffer,
      count: data.length / 2,
      color: layer.color,
      size: layer.kind === 'scatter' ? layer.size : 1,
      round: layer.kind === 'scatter',
      width: layer.kind === 'lines' ? layer.width ?? 1 : 1,
    };
  };
  const release = () => panels.forEach((p) => p.gpu.forEach((g) => gl.deleteBuffer(g.buffer)));

  const layout = () => {
    const cells = gridRects(container.clientWidth, container.clientHeight, scene.rows, scene.cols, 4, scene.colWeights, scene.rowWeights);
    areas = panels.map(({ panel }) => inset(cells[panel.row * scene.cols + panel.col] ?? { x: 0, y: 0, w: 0, h: 0 }, panel.axes === false ? BARE_INSET : AXIS_INSET));
  };

  const draw = () => {
    pending = 0;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const c of [glCanvas, overlay]) {
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
    }
    layout();
    const theme = readTheme();
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(loc.pos);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px sans-serif';
    panels.forEach((p, i) => {
      const a = areas[i];
      if (a.w < 2 || a.h < 2) return;
      const vx = Math.round(a.x * dpr);
      const vy = Math.round((h - a.y - a.h) * dpr);
      const vw = Math.round(a.w * dpr);
      const vh = Math.round(a.h * dpr);
      gl.viewport(vx, vy, vw, vh);
      gl.scissor(vx, vy, vw, vh);
      gl.uniform2f(loc.min, p.view.x.min, p.view.y.min);
      gl.uniform2f(loc.max, p.view.x.max, p.view.y.max);
      for (const g of p.gpu) {
        if (g.count === 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, g.buffer);
        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(loc.color, g.color[0], g.color[1], g.color[2], g.color[3]);
        gl.uniform1f(loc.size, g.size * dpr);
        gl.uniform1f(loc.round, g.round ? 1 : 0);
        // one pass per jitter offset (CSS px -> device px -> clip space); u_px is set for every layer so offsets never leak
        for (const [dx, dy] of lineJitter(g.width)) {
          gl.uniform2f(loc.px, (dx * dpr * 2) / vw, (dy * dpr * 2) / vh);
          gl.drawArrays(g.mode, 0, g.count);
        }
      }
      decorate(p, a, theme);
    });
    gl.disable(gl.SCISSOR_TEST);
    if (scene.message) {
      ctx.fillStyle = toCss(theme.muted);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '12px sans-serif';
      ctx.fillText(scene.message, w / 2, h / 2);
    }
  };

  const decorate = (p: PanelState, a: Rect, theme: Theme) => {
    const { x, y } = p.view;
    const px = (v: number) => a.x + ((v - x.min) / (x.max - x.min)) * a.w;
    const py = (v: number) => a.y + a.h - ((v - y.min) / (y.max - y.min)) * a.h;
    ctx.strokeStyle = toCss(withAlpha(theme.muted, 0.5));
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = toCss(withAlpha(theme.fg, 0.6));
    for (const v of p.panel.vlines ?? []) {
      ctx.beginPath();
      ctx.moveTo(px(v), a.y);
      ctx.lineTo(px(v), a.y + a.h);
      ctx.stroke();
    }
    for (const v of p.panel.hlines ?? []) {
      ctx.beginPath();
      ctx.moveTo(a.x, py(v));
      ctx.lineTo(a.x + a.w, py(v));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = toCss(theme.muted);
    if (p.panel.title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.panel.title, a.x + 2, a.y - 2);
    }
    if (p.panel.axes === false) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of niceTicks(x.min, x.max, Math.max(2, Math.floor(a.w / 60)))) ctx.fillText(formatTick(t), px(t), a.y + a.h + 3);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of niceTicks(y.min, y.max, Math.max(2, Math.floor(a.h / 30)))) ctx.fillText(formatTick(t), a.x - 3, py(t));
    if (p.panel.xLabel) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.panel.xLabel, a.x + a.w - 2, a.y + a.h - 2);
    }
    if (p.panel.yLabel) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(p.panel.yLabel, a.x + 3, a.y + 2);
    }
  };

  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(draw);
  };

  const hit = (ev: MouseEvent) => {
    const b = glCanvas.getBoundingClientRect();
    const cx = ev.clientX - b.left;
    const cy = ev.clientY - b.top;
    const i = areas.findIndex((a) => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h);
    if (i < 0) return undefined;
    const a = areas[i];
    const { x, y } = panels[i].view;
    return { i, a, dataX: x.min + ((cx - a.x) / a.w) * (x.max - x.min), dataY: y.max - ((cy - a.y) / a.h) * (y.max - y.min) };
  };

  glCanvas.addEventListener('wheel', (ev) => {
    const t = hit(ev);
    if (!t) return;
    ev.preventDefault();
    const p = panels[t.i];
    const f = Math.exp(ev.deltaY * 0.002);
    p.view = { x: zoomRange(p.view.x, f, t.dataX), y: ev.shiftKey ? p.view.y : zoomRange(p.view.y, f, t.dataY) };
    schedule();
  }, { passive: false });

  let drag: { i: number; a: Rect; sx: number; sy: number; view: PanelState['view']; moved: boolean } | undefined;
  glCanvas.addEventListener('mousedown', (ev) => {
    const t = hit(ev);
    if (t) drag = { i: t.i, a: t.a, sx: ev.clientX, sy: ev.clientY, view: panels[t.i].view, moved: false };
  });
  const handleMouseMove = (ev: MouseEvent) => {
    if (!drag) return;
    const dx = ev.clientX - drag.sx;
    const dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    panels[drag.i].view = { x: panRange(drag.view.x, -dx / drag.a.w), y: panRange(drag.view.y, dy / drag.a.h) };
    schedule();
  };
  const handleMouseUp = (ev: MouseEvent) => {
    if (drag && !drag.moved && ev.detail <= 1) {
      const t = hit(ev);
      if (t) for (const l of listeners) l({ panel: t.i, x: t.dataX, y: t.dataY, shift: ev.shiftKey, button: ev.button });
    }
    drag = undefined;
  };
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  glCanvas.addEventListener('dblclick', (ev) => {
    const t = hit(ev);
    if (!t) return;
    const p = panels[t.i];
    p.view = { x: p.panel.x, y: p.panel.y };
    schedule();
  });

  const resize = new ResizeObserver(schedule);
  resize.observe(container);

  return {
    setScene(next) {
      release();
      const prev = panels.length === next.panels.length ? panels : []; // a different panel count resets every view
      scene = next;
      panels = next.panels.map((panel, i) => {
        const was = prev[i];
        return { panel, view: carryView(was && { x: was.panel.x, y: was.panel.y, view: was.view }, panel), gpu: panel.layers.map(upload) };
      });
      schedule();
    },
    onClick(listener) {
      listeners.push(listener);
    },
    theme: readTheme,
    dispose() {
      resize.disconnect();
      if (pending) cancelAnimationFrame(pending);
      release();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      glCanvas.remove();
      overlay.remove();
    },
  };
}
