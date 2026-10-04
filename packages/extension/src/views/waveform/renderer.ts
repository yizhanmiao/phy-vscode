import { sceneRenderer } from '../../webview/plot/renderer';
import { EMPTY } from '../../webview/plot/scene';

export default sceneRenderer((_meta, buffers, selection) => EMPTY(selection.ids.length ? `Waveform: ${buffers.length} buffers received` : 'Select a cluster'));
