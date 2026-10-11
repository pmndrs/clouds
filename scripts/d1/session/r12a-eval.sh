#!/bin/zsh
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
O=/Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r12; mkdir -p $O; D=work/captures/scratch/d1/r12a; R11=work/captures/scratch/d1/r11-final
ab() { python3 -I $S/d1/ab.py "$O/ab-$1.jpg" $2 "$3" "$4" 2>&1 | sed 's/.*sheets-r12\///' | cut -c1-200; }
for b in p101:image101:parkouring p213:image213:parkouring; do f=${b%%:*}; r=${b#*:}; img=${r%%:*}; cl=${r#*:}; echo "== $f stats (r11 final, then r12a base and variants)"
  python3 -I scripts/d1/d1.py stats /Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/n3/pptx/media/$img.png $R11/$cl/$f@look:decima.png $D/$f@look:decima*.png --matte work/captures/D1/$cl/$f@look:decima@matte.png --rgb 2>&1 | sed "s/$f@look:decima//" | cut -c1-250
  for c in ambientSkyBias:0.85 ambientSkyBias:1 "suntint:1.06:1:0.94" "suntint:1.1:1:0.9" "suntint:1.06:0.98:0.92" "directProfile:0.5@s.directRimDepth:8" "directProfile:0.5@s.directRimDepth:16" "directProfile:1@s.directRimDepth:8" detailBias:0.1 detailBias:-0.1 detailBias:0.2 diffuseSun:0.08; do v=$c; [[ $c == suntint* ]] && v="@$c" || v="@s.$c"; n=${c//[@:.]/_}; ab "$f-$n" $f "$R11/$cl/$f@look:decima.png" "$D/$f@look:decima$v.png"; done
done
for b in s206:image206 s33t3:media33-t3; do f=${b%%:*}; img=${b#*:}; ref=/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/n3/pptx/media/$img.png; [[ $img == media* ]] && ref=/Users/dex/Developer/WebGPUClouds/artifacts/research/d0-parity/ref/frames/$img.png; echo "== $f stats"
  python3 -I scripts/d1/d1.py stats $ref $R11/stormbird/$f@look:decima.png $(ls $D/$f@look:decima*.png | grep -v matte | grep -v wind) --matte work/captures/D1/stormbird/$f@look:decima@matte.png --rgb 2>&1 | sed "s/$f@look:decima//" | cut -c1-250
  for c in "suntint:1.06:1:0.94" "suntint:1.1:1:0.9" "suntint:1.06:0.98:0.92" "directProfile:0.5@s.directRimDepth:8" "directProfile:0.5@s.directRimDepth:16" inScatterProfile:0.75 inScatterProfile:1 detailBias:0.1 detailBias:-0.1; do v=$c; [[ $c == suntint* ]] && v="@$c" || v="@s.$c"; n=${c//[@:.]/_}; ab "$f-$n" $f "$R11/stormbird/$f@look:decima.png" "$D/$f@look:decima$v.png"; done
done
echo "== belly profile p213 (columns 500-900): belly min / edge slope / sky below / contrast"
python3 -I - <<'PY'
import numpy as np, glob, os
from PIL import Image
W=np.array([0.2126,0.7152,0.0722])
def lum(p):
    im=Image.open(p).convert('RGB'); im=im if im.width==1920 else im.resize((1920,1080),Image.LANCZOS); return np.asarray(im).astype(float)/255@W
for lab,p in [('frame','/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/n3/pptx/media/image213.png'),('r11','work/captures/scratch/d1/r11-final/parkouring/p213@look:decima.png')]+[(os.path.basename(q).split('decima')[-1][:-4] or 'r12 base',q) for q in sorted(glob.glob('work/captures/scratch/d1/r12a/p213@*.png'))]:
    col=lum(p)[:,500:900].mean(1); seg=col[600:1000]; ymin=600+int(np.argmin(seg)); grad=np.diff(col[ymin:1040]); yedge=ymin+int(np.argmax(grad))
    print(f'  {lab:44s} belly {col[ymin]:.3f}@{ymin} slope {grad.max():.4f} sky {col[1060:1080].mean():.3f} contrast {col[1060:1080].mean()-col[ymin]:.3f} trunk(1100-1300,700-900) {lum(p)[700:900,1100:1300].mean():.3f}')
PY
echo "== cloud-only colour (R-B, R-G by class)"
python3 -I - <<'PY'
import numpy as np, glob, os
from PIL import Image
W=np.array([0.2126,0.7152,0.0722])
MEDIA='/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/n3/pptx/media'; FR='/Users/dex/Developer/WebGPUClouds/artifacts/research/d0-parity/ref/frames'
refs={'p101':(f'{MEDIA}/image101.png','parkouring'),'p213':(f'{MEDIA}/image213.png','parkouring'),'s206':(f'{MEDIA}/image206.png','stormbird'),'s33t3':(f'{FR}/media33-t3.png','stormbird')}
def rgb(p):
    im=Image.open(p).convert('RGB'); im=im if im.width==1920 else im.resize((1920,1080),Image.LANCZOS); return np.asarray(im).astype(float)/255
def erode(m,r):
    out=m.copy()
    for dy in range(-r,r+1,r):
        for dx in range(-r,r+1,r): out&=np.roll(np.roll(m,dy,0),dx,1)
    return out
def meas(a,m):
    c=a[m]; l=c@W; out=[]
    for nm,sel in (('lit',l>0.78),('mid',(l>0.6)&(l<0.72)),('shade',(l>0.35)&(l<0.55))):
        m3=c[sel].mean(0)*255 if sel.sum()>200 else np.zeros(3); out.append(f'{nm} R-B {m3[0]-m3[2]:+.0f} R-G {m3[0]-m3[1]:+.0f} ({m3[0]:.0f},{m3[1]:.0f},{m3[2]:.0f})')
    return ' | '.join(out)
for k,(fp,cl) in refs.items():
    m=erode(np.asarray(Image.open(f'work/captures/D1/{cl}/{k}@look:decima@matte.png').convert('L'))>200,12)
    print(f'== {k}'); print(f'  {"frame":36s} {meas(rgb(fp),m)}')
    for p in [f'work/captures/scratch/d1/r11-final/{cl}/{k}@look:decima.png']+sorted(glob.glob(f'work/captures/scratch/d1/r12a/{k}@look:decima@suntint*.png'))+sorted(glob.glob(f'work/captures/scratch/d1/r12a/{k}@look:decima@s.diffuseSun*.png')): print(f'  {("r11" if "r11-final" in p else os.path.basename(p).split("decima")[-1][:-4]):36s} {meas(rgb(p),m)}')
PY
echo "== florets 4k (dfrac = dome share)"; python3 -I $S/d1/floreteval.py work/captures/scratch/d1/r12a4k p101,p213 2>&1 | grep -v leftmass | sed -E 's/floret= *[0-9.]+ //; s/round=.*resp=[0-9.]+ //; s/\| b3lit/b3lit/' | cut -c1-160
echo "== wind phase (s206): matte IoU against the frame's cloud mask"
python3 -I - <<'PY'
import sys, glob, os, numpy as np
sys.path.insert(0,'scripts/d1'); import d1
d0=d1.d0
rr, mr, _, _ = d0.ref_mask(d1.ref_of('s206'), 960)
for p in sorted(glob.glob('work/captures/scratch/d1/r12a/s206@look:decima*@matte.png')):
    mo = d1.matte_mask(p, 960); iou = (mo & mr).sum() / max((mo | mr).sum(), 1)
    print(f'  {os.path.basename(p).split("decima")[-1][:-10] or " base":22s} iou {iou:.4f}')
PY
