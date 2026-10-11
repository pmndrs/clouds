"""Feature sizes of the pack noise channels and the Parkouring NVDF's surface shell (read-only analysis)."""
import numpy as np, json, sys
A='/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11/assets/clouds/'
n=np.fromfile(A+'noise/noise.bin',dtype=np.uint8,count=128**3*4).reshape(128,128,128,4).astype(np.float32)/255  # z,y,x,c
names='rgba'
print('channel stats: mean, std, p5, p50, p95')
for c in range(4):
    v=n[...,c]; print(names[c], *['%.3f'%x for x in (v.mean(),v.std(),*np.percentile(v,[5,50,95]))])
# radial power spectrum -> dominant wavelength (texels), and spectral centroid
k=np.fft.fftfreq(128)
K=np.sqrt(k[:,None,None]**2+k[None,:,None]**2+k[None,None,:]**2)
bins=np.arange(1,64)
print('channel: peak wavelength (texels, m), centroid wavelength (m), autocorr half-width (m)')
for c in range(4):
    v=n[...,c]-n[...,c].mean()
    F=np.abs(np.fft.fftn(v))**2
    kb=np.round(K*128).astype(int)
    P=np.bincount(kb.ravel(),F.ravel(),minlength=128)[:64]
    # power per radial shell weighted by shell (energy per octave ~ k*P)
    pk=bins[np.argmax(P[1:64])]
    cen=(P[1:]*bins).sum()/P[1:].sum()
    ac=np.real(np.fft.ifftn(F)); ac/=ac[0,0,0]
    r=np.argmax(ac[0,0,:64]<0.5)
    print(names[c], 'peak %d (%.1f texel, %.1f m)'%(pk,128/pk,100/pk), 'centroid %.1f m'%(100/cen), 'ac0.5 %.1f m'%(r*100/128))
# local maxima density (blobs) per channel, 3x3x3, above channel median
from itertools import product
for c in range(4):
    v=n[...,c]
    m=np.ones_like(v,bool)
    for dz,dy,dx in product((-1,0,1),repeat=3):
        if dz==dy==dx==0: continue
        m&= v>=np.roll(v,(dz,dy,dx),(0,1,2))
    cnt=m.sum(); vol=100.0**3
    print(names[c],'local maxima %d per 100m^3 tile -> mean spacing %.1f m'%(cnt,(vol/cnt)**(1/3)))
