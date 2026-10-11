mkdir -p /Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r4 && for b in p101 p125 p161 p213 s206 s33t3 s33t6 s33t9 s214; do d=work/captures/D1/parkouring; case $b in s*) d=work/captures/D1/stormbird;; esac; python3 scripts/d1/d1.py crops /Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r4/D1d-$b.jpg "$(python3 scripts/d1/d1.py refof $b)" "$d/$b@look:decima.jpg" "$d/$b@look:art.jpg" "$d/$b@look:deck.jpg" --box 0,0,1920,1080 --cols 2; done && python3 - <<'EOF'
import os, json, random, sys, shutil
from PIL import Image, ImageDraw
sys.path.insert(0,'scripts/d1'); import d1
S='/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
SH='/Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r4'; K4='work/captures/scratch/d1/final-4k'
def load(p, w):
    im=Image.open(p).convert('RGB'); return im if im.width==w else im.resize((w, round(im.height*w/im.width)), Image.LANCZOS)
REGIONS={'p101':[('tower',(1150,180,400,520)),('leftmass',(350,330,500,330))],'p213':[('tower',(1100,150,480,560)),('base',(300,560,900,300))],
         's206':[('leg',(40,520,560,340)),('body',(560,180,700,500))],'s33t3':[('base',(650,600,700,300)),('upper',(500,100,700,450))]}
def src(f):
    d='work/captures/D1/parkouring' if f[0]=='p' else 'work/captures/D1/stormbird'
    if f in ('p101','p213'): return {'decima-reference':d1.ref_of(f),'decima':f'{K4}/{f}@look:decima.jpg','art':f'{K4}/{f}@look:art.jpg'}
    return {'decima-reference':d1.ref_of(f),'decima':f'{d}/{f}@look:decima.jpg','art':f'{d}/{f}@look:art.jpg'}
crops=[]
for f, regs in REGIONS.items():
    n4=f in ('p101','p213'); ims={k: load(p, 3840 if n4 else 1920) for k,p in src(f).items()}
    for rname,(x,y,w,h) in regs:
        row=[]
        for k in ['decima-reference','decima','art']:
            im=ims[k]; c=im.crop((2*x,2*y,2*(x+w),2*(y+h))) if n4 else im.crop((x,y,x+w,y+h)).resize((2*w,2*h),Image.LANCZOS)
            crops.append((f,rname,k,c)); row.append((k,c))
        sheet=Image.new('RGB',(sum(c.width for _,c in row)+20,row[0][1].height),(30,30,30)); xx=0
        for k,c in row: sheet.paste(c,(xx,0)); ImageDraw.Draw(sheet).text((xx+4,4),f'{f} {rname} {k}',fill=(255,255,0)); xx+=c.width+10
        sheet.save(f'{SH}/D1d-crop-{f}-{rname}.jpg',quality=92)
out=os.path.join(S,'blind-d1d'); key=os.path.join(S,'blind-d1d-key')
for d in (out,key): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
random.seed(20261013); k={}
full=[]
for f in ['p101','p213','s206','s33t3']:
    d='work/captures/D1/parkouring' if f[0]=='p' else 'work/captures/D1/stormbird'
    full+= [(f,'decima-reference',d1.ref_of(f)),(f,'decima',f'{d}/{f}@look:decima.jpg'),(f,'art',f'{d}/{f}@look:art.jpg')]
ids=list(range(1,len(full)+1)); random.shuffle(ids)
for (f,s_,p),i in zip(full,ids): load(p,1920).save(os.path.join(out,f'd{i:02d}.jpg'),quality=92); k[f'd{i:02d}.jpg']={'frame':f,'source':s_,'kind':'full'}
ids=list(range(1,len(crops)+1)); random.shuffle(ids)
for (f,r,s_,c),i in zip(crops,ids): c.save(os.path.join(out,f'c{i:02d}.jpg'),quality=92); k[f'c{i:02d}.jpg']={'frame':f,'region':r,'source':s_,'kind':'crop','scale':'native 4k' if f in ('p101','p213') else '2x of 1080p'}
json.dump(k,open(os.path.join(key,'key.json'),'w'),indent=1); print(len(full),len(crops))
EOF