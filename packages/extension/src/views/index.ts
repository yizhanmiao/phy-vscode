import { amplitudeView } from './amplitude/provider';
import { correlogramView } from './correlogram/provider';
import { featureView } from './feature/provider';
import { builtinHistograms, clusterStatsView } from './stats/provider';
import type { BuiltinView } from './types';
import { waveformView } from './waveform/provider';

export const builtinViews: BuiltinView[] = [waveformView, featureView, correlogramView, amplitudeView, clusterStatsView(builtinHistograms)];
