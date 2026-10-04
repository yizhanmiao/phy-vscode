import { sceneRenderer } from '../../webview/plot/renderer';
import type { AmplitudeMeta } from './provider';
import { buildAmplitudeScene } from './scene';

export default sceneRenderer((meta, buffers, selection, theme) => buildAmplitudeScene(meta as AmplitudeMeta, buffers, selection, theme));
