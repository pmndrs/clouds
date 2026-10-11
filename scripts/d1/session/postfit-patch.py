# D1 round 11: POST_FIT from the cloud-only fit (scratchpad/d1/fit11.json)
import json, re
S='/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
fit=json.load(open(f'{S}/d1/fit11.json'))
c=fit['curve']; m=[v for row in fit['matrix_rows'] for v in row]
# the TS matrix is column-major (ts string order): take the 'ts' field's numbers
ts=fit['ts']; cur=re.search(r"curve: \[([^\]]*)\]", ts).group(1); mat=re.search(r"matrix: \[([^\]]*)\]", ts).group(1)
p='examples/lab/decima/bridge.ts'; s=open(p).read()
s2=re.sub(r"curve: \[[^\]]*\] as \[number, number, number, number\],", f"curve: [{cur}] as [number, number, number, number],   // D1 round 11: refitted on the cloud alone (postfit.py --erode 6, round-11 linear captures); round 5's [0.97562, 2.15726, 1.79074, 0.06686]", s, count=1)
s2=re.sub(r"matrix: \[[^\]]*\] as \[number, number, number, number, number, number, number, number, number\],", f"matrix: [{mat}] as [number, number, number, number, number, number, number, number, number],", s2, count=1)
assert s2!=s and cur in s2 and mat in s2
open(p,'w').write(s2); print('POST_FIT updated:', cur, '|', mat)
