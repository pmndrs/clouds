#!/bin/zsh
# D1 round 11: the post fit on the cloud alone (eroded matte), from the linear captures r11c.
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
M=work/captures/scratch/d1/r11c-mattes; mkdir -p $M/parkouring $M/stormbird
for b in p101 p125 p161 p213; do cp "work/captures/scratch/d1/r11c/$b@look:decima@matte.jpg" "$M/parkouring/"; done
for b in s206 s33t3 s33t6 s33t9 s214; do cp "work/captures/scratch/d1/r11c/$b@look:decima@matte.jpg" "$M/stormbird/"; done
python3 -I scripts/d1/postfit.py --lin work/captures/scratch/d1/r11c --lin-exposure 0.15 --mattes $M --erode 6 --out $S/d1/fit11.json 2>&1 | tail -40
