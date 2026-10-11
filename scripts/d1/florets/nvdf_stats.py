import numpy as np, sys
A='/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11/assets/clouds/'
for name,dims in [('parkouring',(108,108,51)),('stormbird',None)]:
    import json
    meta=json.load(open(A+name+'/cloud.json')); dims=meta['dims']
    v=np.fromfile(A+name+'/nvdf16.bin',dtype=np.float16).astype(np.float32).reshape(dims[2],dims[1],dims[0],4)
    P,T,S=v[...,0],v[...,1],v[...,2]
    gz,gy,gx=np.gradient(P,8.0)
    G=np.sqrt(gx**2+gy**2+gz**2)
    shell=(P>0.02)&(P<0.35)
    core=P>0.6
    print(f'== {name} dims {dims}; voxels P>0: {(P>0).sum()}')
    print(' shell (0.02<P<0.35): n=%d  |gradP| median %.4f /m -> ramp 0..1 over %.0f m;  P 0..0.3 band thickness ~%.1f m' % (shell.sum(), np.median(G[shell]), 1/np.median(G[shell]), 0.3/np.median(G[shell])))
    for nm,X in [('type T',T),('density scale S',S)]:
        print('  %s in shell: p10 %.2f p25 %.2f p50 %.2f p75 %.2f p90 %.2f; frac<0.3 %.2f' % (nm,*np.percentile(X[shell],[10,25,50,75,90]),(X[shell]<0.3).mean()))
    S4=np.clip(S,0,1)**4
    print('  S^4 in shell: p50 %.4f p90 %.4f ; sharpen exponent lerp(0.3,0.6,S^4) p50 %.3f' % (np.median(S4[shell]),np.percentile(S4[shell],90),np.median(0.3+0.3*S4[shell])))
    print('  plateau density (S^4)^e at erosion 1, median %.3f' % np.median((S4[shell]+1e-9)**(0.3+0.3*S4[shell])))
    # outermost surface voxels: P>0 with an empty neighbour
    emp=(P<=0)
    nb=np.zeros_like(emp)
    for ax in range(3):
        for s in (1,-1): nb|=np.roll(emp,s,ax)
    surf=(P>0)&nb
    print('  surface voxels: n=%d, T p50 %.2f frac T<0.3 %.2f, S p50 %.2f' % (surf.sum(),np.median(T[surf]),(T[surf]<0.3).mean(),np.median(S[surf])))
