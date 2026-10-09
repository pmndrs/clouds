"""L1: promote ranked candidates of a target from the gitignored assets/clouds/local/<target>/ into the committed
assets/clouds/targets/<target>/ (each cloud < 4 MB), with an index.json holding their scores and best yaw.

  python3 scripts/targets/promote.py texas-tower v05 r2_03 ...      # names from work/captures/scratch/targets/<target>/ranking.txt
"""
import argparse, json, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('target'); ap.add_argument('names', nargs='+')
a = ap.parse_args()
src = os.path.join(REPO, 'assets', 'clouds', 'local', a.target)
dst = os.path.join(REPO, 'assets', 'clouds', 'targets', a.target)
scores = json.load(open(os.path.join(REPO, 'work', 'captures', 'scratch', 'targets', a.target, 'scores.json')))
os.makedirs(dst, exist_ok=True)
index = {'target': a.target, 'note': 'L1 target-loop picks; regenerate with scripts/vdb/authoring/sim/targets.py and scripts/targets/match.py', 'clouds': []}
for rank, n in enumerate(a.names, 1):
    shutil.rmtree(os.path.join(dst, n), ignore_errors=True)
    os.makedirs(os.path.join(dst, n))
    for f in ('cloud.json', 'nvdf.bin', 'sdf.bin', 'manifest.json'):
        shutil.copy2(os.path.join(src, n, f), os.path.join(dst, n, f))
    size = sum(os.path.getsize(os.path.join(dst, n, f)) for f in ('nvdf.bin', 'sdf.bin'))
    assert size < 4 * 1024 * 1024, f'{n}: {size} bytes is over 4 MB'
    best = max((s for s in scores if s.split('@')[0] == n), key=lambda s: scores[s]['total'])
    r = scores[best]
    m = json.load(open(os.path.join(dst, n, 'manifest.json')))
    index['clouds'].append(dict(name=n, rank=rank, bestYaw=int(best.split('@')[1]), total=r['total'], iou=r['iou'], features=r['features'],
                                sizeMeters=m['sizeMeters'], baseMeters=m['baseMeters'], topMeters=m['topMeters'], voxelSizeMeters=m['voxelSizeMeters'], bytes=size))
    print(f'{n}: rank {rank}, yaw {best.split("@")[1]}, total {r["total"]:.3f}, {size / 1048576:.2f} MiB')
json.dump(index, open(os.path.join(dst, 'index.json'), 'w'), indent=1)
# the page reads manifest.json + cloud.json from the folder; candidates.json lets match.py re-score the committed picks too
json.dump({'target': a.target, 'candidates': {c['name']: {} for c in index['clouds']}}, open(os.path.join(dst, 'candidates.json'), 'w'), indent=1)
