import sys
from PIL import Image, ImageChops
import numpy as np
a_dir,b_dir=sys.argv[1],sys.argv[2]
for v in sys.argv[3:]:
    a=np.asarray(Image.open(f'{a_dir}/{v}.png').convert('RGB')).astype(int)
    b=np.asarray(Image.open(f'{b_dir}/{v}.png').convert('RGB')).astype(int)
    # ignore the sidebar and the HUD? report whole and the cloud area (left 1660 px, below the HUD)
    d=np.abs(a-b)
    reg=d[100:,:1650]
    print(v,'max',d.max(),'max(excl ui)',reg.max(),'mean(excl ui) %.4f'%reg.mean(),'pixels>8: %d'%(reg.max(axis=2)>8).sum(),'pixels>0: %d'%(reg.max(axis=2)>0).sum(),'of',reg.shape[0]*reg.shape[1])
