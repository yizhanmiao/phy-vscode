import { sceneRenderer } from '../../webview/plot/renderer';
import type { StatsMeta } from './provider';
import { buildStatsScene } from './scene';

export default sceneRenderer((meta, buffers, selection, theme) => buildStatsScene(meta as StatsMeta, buffers, selection, theme));
