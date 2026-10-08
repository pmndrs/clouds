"""Compare two converted cloud directories (e.g. VDB-derived vs TGA-derived). Plain python + numpy.

  python3 scripts/vdb/check_parity.py work/captures/scratch/pack-parkouring assets/clouds/parkouring
Prints per-channel agreement within 2/255 and SDF median |diff| in metres; exits 1 if the board thresholds fail
(channels within 2/255 at >= 99% of voxels, SDF median |diff| <= 4 m).
"""
import sys,json,numpy as np
sys.path.insert(0,'/Users/dex/Developer/WebGPUClouds/.claude/worktrees/webgpu-cloud-audit-8c9f29/scripts/vdb')
import nvdf_math as nm
a,b=sys.argv[1:3]
ma=json.load(open(a+'/cloud.json')); mb=json.load(open(b+'/cloud.json'))
print('dims',ma['dims'],mb['dims'],'off',ma['cropOffset'],mb['cropOffset'])
ok=True
if ma['dims']!=mb['dims']: sys.exit('dims differ')
n=int(np.prod(ma['dims']))
A=np.fromfile(a+'/nvdf.bin',np.uint8).reshape(n,4).astype(int); B=np.fromfile(b+'/nvdf.bin',np.uint8).reshape(n,4).astype(int)
for c,nmc in enumerate('RGB'):
    d=np.abs(A[:,c]-B[:,c]); print(nmc,'within2: %.4f%%'%(100*(d<=2).mean()),'exact %.4f%%'%(100*(d==0).mean()),'max',d.max()); ok&=(d<=2).mean()>=0.99
act=(A[:,0]>0)|(B[:,0]>0)
for c,nmc in enumerate('RGB'):
    d=np.abs(A[act,c]-B[act,c]); print(nmc,'occupied-only within2: %.4f%%'%(100*(d<=2).mean()),'n',act.sum())
print('occupancy mismatch',int(((A[:,0]>0)!=(B[:,0]>0)).sum()))
SA=nm.decode_sdf_r16(np.fromfile(a+'/sdf.bin','<u2')); SB=nm.decode_sdf_r16(np.fromfile(b+'/sdf.bin','<u2'))
d=np.abs(SA-SB); print('SDF median|diff| %.3f m  mean %.3f p99 %.3f max %.3f'%(np.median(d),d.mean(),np.percentile(d,99),d.max()))
ok&=float(np.median(d))<=4.0
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
