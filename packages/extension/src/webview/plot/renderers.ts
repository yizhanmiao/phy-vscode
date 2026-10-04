import amplitude from '../../views/amplitude/renderer';
import correlogram from '../../views/correlogram/renderer';
import feature from '../../views/feature/renderer';
import stats from '../../views/stats/renderer';
import waveform from '../../views/waveform/renderer';
import { sceneRenderer, type ViewRenderer } from './renderer';
import { EMPTY } from './scene';

export const renderers: Record<string, () => ViewRenderer> = { waveform, feature, correlogram, amplitude, cluster_statistics: stats };
export const missingRenderer = sceneRenderer(() => EMPTY('No renderer for this view'));
