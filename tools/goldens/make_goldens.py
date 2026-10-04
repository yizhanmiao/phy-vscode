"""Dev-only golden values for Theia-Phy unit tests.

Reads the TypeScript-generated fixture and writes JSON goldens that vitest compares
against. Python is never needed to run the tests; rerun only when the fixture or an
algorithm definition changes:

    npm run fixtures -w packages/extension
    uv run --project tools/goldens python tools/goldens/make_goldens.py
"""
import ast
import json
import math
from pathlib import Path

import numpy as np
from phylib.stats.ccg import correlograms
from scipy.signal import butter, filtfilt

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "packages/extension/test/fixtures/out"
OUT = ROOT / "packages/extension/test/goldens"

# Definitions shared with the TypeScript code (spec §3 and §5).
N_BEST = 12
WF_BEFORE, WF_AFTER, WF_PAD, WF_MAX = 40, 42, 200, 100
FEAT_MAX, FEAT_CH, FEAT_PCS = 10000, 4, 3
HIGHPASS_HZ = 150


def read_params(path):
    tree = ast.parse(path.read_text())
    return {n.targets[0].id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)}


def regular_subset(spikes, cap):
    n = len(spikes)
    return spikes if n <= cap else spikes[(np.arange(cap) * n) // cap]


def unwhitened(templates, cols, wmi, t, n_ch):
    tw = templates[t].astype(np.float64)
    if cols is None:
        return tw @ wmi
    c = cols[t]
    m = np.abs(tw).max(axis=0)
    keep = (c >= 0) & (m > m.max() * 1e-6)
    ch = c[keep]
    out = np.zeros((tw.shape[0], n_ch))
    out[:, ch] = tw[:, keep] @ wmi[np.ix_(ch, ch)]
    return out


def mean_template(templates, cols, wmi, spike_templates, spikes, n_ch):
    ts, counts = np.unique(spike_templates[spikes], return_counts=True)
    u = np.stack([unwhitened(templates, cols, wmi, t, n_ch) for t in ts])
    return np.average(u, axis=0, weights=counts)


def best_channels(mean, pos, shanks, n=N_BEST):
    # ties in distance: the TS port breaks them by channel index (stable); np.argsort is unstable on equidistant channels
    amp = mean.max(axis=0) - mean.min(axis=0)
    best = int(np.argmax(amp))
    d = ((pos - pos[best]) ** 2).sum(axis=1)
    close = np.argsort(d, kind="stable")[:n]
    if shanks is not None:
        close = close[shanks[close] == shanks[best]]
    close = np.sort(close)
    return close[np.argsort(-amp[close], kind="stable")], amp


class Fixture:
    def __init__(self, d):
        self.d = Path(d)
        has = lambda f: (self.d / f).exists()
        load = lambda f: np.load(self.d / f)
        self.params = read_params(self.d / "params.py")
        self.sr = float(self.params["sample_rate"])
        self.st = load("spike_times.npy").ravel().astype(np.int64)
        stt = load("spike_templates.npy")
        self.stt = stt[:, 0] if stt.ndim == 2 else stt.ravel()
        self.sc = load("spike_clusters.npy").ravel() if has("spike_clusters.npy") else self.stt
        self.amps = load("amplitudes.npy").ravel() if has("amplitudes.npy") else None
        self.pos = load("channel_positions.npy").astype(np.float64)
        self.shanks = load("channel_shanks.npy").ravel() if has("channel_shanks.npy") else None
        self.cmap = load("channel_map.npy").ravel()
        self.templates = np.nan_to_num(load("templates.npy"))
        self.cols = load("template_ind.npy") if has("template_ind.npy") else None
        self.wmi = (load("whitening_mat_inv.npy") if has("whitening_mat_inv.npy") else np.linalg.inv(load("whitening_mat.npy"))).astype(np.float64)
        self.n_ch = len(self.cmap)
        self.duration = (self.st[-1] + 1) / self.sr

    def spikes(self, cid):
        return np.nonzero(self.sc == cid)[0]

    def channels(self, cid):
        mean = mean_template(self.templates, self.cols, self.wmi, self.stt, self.spikes(cid), self.n_ch)
        return best_channels(mean, self.pos, self.shanks)[0], mean


def filter_golden():
    fs = 30000.0
    b, a = butter(3, HIGHPASS_HZ, "highpass", fs=fs)
    rng = np.random.default_rng(0)
    x = 50 * np.sin(2 * np.pi * 3 * np.arange(300) / fs) + rng.normal(0, 5, 300)
    return {"fs": fs, "fc": HIGHPASS_HZ, "b": b, "a": a, "x": x, "y": filtfilt(b, a, x)}


def correlogram_golden(f):
    ids = np.array([2, 7, 40])
    mask = np.isin(f.sc, ids)
    counts = correlograms(f.st[mask].astype(np.float64), f.sc[mask], cluster_ids=ids,
                          sample_rate=1.0, bin_size=30.0, window_size=1500.0)
    return {"clusters": ids, "binSamples": 30, "halfBins": 25, "counts": counts}


def template_golden(f):
    out = {}
    for cid in np.unique(f.sc):
        ch, mean = f.channels(cid)
        amp = mean.max(axis=0) - mean.min(axis=0)
        out[str(cid)] = {"channels": ch, "mean": mean, "depth": f.pos[ch[0], 1], "ptp": amp[ch[0]]}
    return out


def raw_windows(raw, starts, length):
    out = np.zeros((len(starts), length, raw.shape[1]))
    for w, s in enumerate(starts):
        a, b = max(s, 0), min(s + length, raw.shape[0])
        if a < b:
            out[w, a - s : b - s] = raw[a:b]
    return out


def waveforms(f, raw, ids, chans):
    b, a = butter(3, HIGHPASS_HZ, "highpass", fs=f.sr)
    length = WF_BEFORE + WF_AFTER + 2 * WF_PAD
    win = raw_windows(raw, f.st[ids] - WF_BEFORE - WF_PAD, length)[:, :, f.cmap[chans]]
    y = filtfilt(b, a, win, axis=1)[:, WF_PAD : WF_PAD + WF_BEFORE + WF_AFTER]
    return y - np.median(y, axis=1, keepdims=True)


def waveform_golden(f):
    raw = np.fromfile(f.d / "raw.bin", dtype=np.int16).reshape(-1, f.params["n_channels_dat"])
    ch7, _ = f.channels(7)
    ids7 = regular_subset(f.spikes(7), WF_MAX)[:3]
    ch2, _ = f.channels(2)
    edge = np.array([np.nonzero(f.st == 5)[0][0], np.nonzero(f.st == raw.shape[0] - 3)[0][0]])
    return {
        "cluster": {"id": 7, "channels": ch7, "spikeIds": ids7, "waveforms": waveforms(f, raw, ids7, ch7)},
        "edge": {"channels": ch2, "spikeIds": edge, "waveforms": waveforms(f, raw, edge, ch2)},
    }


def feature_golden(f):
    pcf = np.load(f.d / "pc_features.npy")
    ind = np.load(f.d / "pc_feature_ind.npy")
    ch = f.channels(7)[0][:FEAT_CH]
    ids = regular_subset(f.spikes(7), FEAT_MAX)[:5]
    feats = np.full((len(ids), len(ch), FEAT_PCS), np.nan)
    for i, s in enumerate(ids):
        row = list(ind[f.stt[s]])
        for j, c in enumerate(ch):
            if c in row:
                feats[i, j] = pcf[s, :FEAT_PCS, row.index(c)]
    return {"cluster": 7, "channels": ch, "spikeIds": ids, "features": feats}


def histogram_golden(f):
    t = f.st[f.spikes(7)].astype(np.float64)
    isi = np.histogram(np.diff(t) / f.sr * 1000, bins=100, range=(0, 50))[0]
    fr = np.histogram(t / f.sr, bins=100, range=(0, f.duration))[0] / (f.duration / 100)
    return {"cluster": 7, "duration": f.duration, "isi": isi, "firingRate": fr}


def table_golden(f):
    out = {}
    for cid in np.unique(f.sc):
        s = f.spikes(cid)
        out[str(cid)] = {"n_spikes": len(s), "amplitude": f.amps[s].astype(np.float64).mean(),
                         "firing_rate": len(s) / f.duration}
    return out


def clean(x):
    if isinstance(x, np.ndarray):
        x = x.tolist()
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, float) and math.isnan(x):
        return None
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    return x


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base, sparse = Fixture(FIX / "base"), Fixture(FIX / "sparse")
    goldens = {
        "filter.json": filter_golden(),
        "correlograms.json": correlogram_golden(base),
        "templates.json": {"base": template_golden(base), "sparse": template_golden(sparse)},
        "waveforms.json": waveform_golden(base),
        "features.json": feature_golden(base),
        "histograms.json": histogram_golden(base),
        "table.json": table_golden(base),
    }
    for name, obj in goldens.items():
        (OUT / name).write_text(json.dumps(clean(obj), allow_nan=False))
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
