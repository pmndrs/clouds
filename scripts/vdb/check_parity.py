"""Compare two converted cloud directories (e.g. VDB-derived vs TGA-derived). Plain python + numpy.

  python3 scripts/vdb/check_parity.py work/captures/scratch/pack-parkouring assets/clouds/parkouring
Prints per-channel agreement within 2/255 and SDF median |diff| in metres; exits 1 if the board thresholds fail
(channels within 2/255 at >= 99% of voxels, SDF median |diff| <= 4 m).

  python3 scripts/vdb/check_parity.py --fine assets/clouds/disney
Fine hero check (needs node): decodes fine.nvdb with WebVDB's CPU readValue (scripts/vdb/vdb-to-nvdb.mjs --decode) and checks it
against nvdf.bin / sdf.bin of the same directory: (1) occupancy superset (every fine voxel > 0 lies in a coarse voxel with
profile > 0); (2) without a shell, coarse R == reduction of the fine lattice exactly (mean of the ratio^3 voxels, floor 1);
(3) sdf.bin == the exact EDT of (coarse R > 0), rounded down (a lower bound of the distance to the fine surface). The exact
fine.nvdb == fine lattice comparison runs inside the converter (vdb_to_nvdf.py --fine-voxel-size ...).
"""
import os,subprocess,shutil,tempfile
import sys,json,numpy as np
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import nvdf_math as nm

def fine_check(d):
    meta=json.load(open(d+'/cloud.json')); fine=meta.get('fine')
    if not fine: sys.exit(d+': no "fine" block in cloud.json')
    r=fine['ratio']; cx,cy,cz=meta['dims']; fx,fy,fz=fine['dims']   # source axes (x, row, up)
    assert (fx,fy,fz)==(cx*r,cy*r,cz*r), 'fine dims are not ratio x coarse dims'
    node=shutil.which('node')
    if node is None: sys.exit('node not found')
    script=os.path.join(os.path.dirname(os.path.abspath(__file__)),'vdb-to-nvdb.mjs')
    with tempfile.TemporaryDirectory() as td:
        u8=os.path.join(td,'fine.u8')
        # VDB index (i,j,k) = (x, up, row): dense file is x fastest, then up, then row
        subprocess.run([node,script,'--decode',d+'/'+fine['file'],u8,'--dims',str(fx),str(fz),str(fy)],check=True,capture_output=True)
        flat=np.fromfile(u8,np.uint8)
    fine_tex=flat.reshape(fy,fz,fx).transpose(1,0,2)      # [row, up, x] -> texture order [up, row, x]
    R=np.fromfile(d+'/nvdf.bin',np.uint8).reshape(cz,cy,cx,4)[...,0]
    ok=True
    up=np.repeat(np.repeat(np.repeat(R>0,r,0),r,1),r,2)
    miss=int(((fine_tex>0)&~up).sum()); print('fine voxels outside coarse occupancy:',miss); ok&=miss==0
    if fine.get('shellMeters') is None:
        red=nm.reduce_profile_u8(np.ascontiguousarray(fine_tex),r)
        bad=int((red!=R).sum()); print('coarse R != reduction(fine):',bad,'of',R.size); ok&=bad==0
    else:
        print('shell',fine['shellMeters'],'m: coarse R keeps the full interior; reduction equality skipped')
        deep_missing=int(((R>0)&~nm.block_any(fine_tex>0,r)).sum()); print('coarse-occupied voxels with no fine voxel (deep interior):',deep_missing)
    want=nm.encode_sdf_r16(nm.signed_distance(R>0,meta['voxelSizeMeters']))
    got=np.fromfile(d+'/sdf.bin','<u2').reshape(R.shape)
    sd=int((want!=got).sum()); print('sdf.bin != EDT(coarse R > 0):',sd); ok&=sd==0
    print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)

if sys.argv[1]=='--fine': fine_check(sys.argv[2])
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
