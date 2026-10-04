"""Print the same per-cluster summary as `npm run check:real`, computed with numpy, for cross-checking.

    uv run --project tools/goldens python tools/goldens/real_summary.py <dataset dir>
"""
import sys
from pathlib import Path

import numpy as np
from make_goldens import Fixture, best_channels, mean_template

d = Path(sys.argv[1])
f = Fixture(d.parent if d.name == "params.py" else d)
ids, counts = np.unique(f.sc, return_counts=True)
print(f"{len(f.st)} spikes, {f.n_ch} channels, {f.duration:.1f} s, {len(ids)} clusters")
for cid in ids[np.argsort(-counts, kind="stable")][:3]:
    s = f.spikes(cid)
    ch, _ = best_channels(mean_template(f.templates, f.cols, f.wmi, f.stt, s, f.n_ch), f.pos, f.shanks)
    print(f"cluster {cid}: n={len(s)} amplitude={f.amps[s].astype(np.float64).mean()} depth={f.pos[ch[0], 1]} channels={','.join(map(str, ch))}")
