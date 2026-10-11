#!/bin/zsh
# D1 round 11: the cloud-only post fit against ACES, on the candidate look.
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
rm -f $S/d1/r11e.done
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=parkouring&clean=1" --shots "p101@look:decima,p101@look:decima@post:fit,p213@look:decima,p213@look:decima@post:fit" --settle 300 --format png --out work/captures/scratch/d1/r11e > $S/d1/r11e.log 2>&1
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=stormbird&clean=1" --shots "s206@look:decima,s206@look:decima@post:fit,s33t3@look:decima,s33t3@look:decima@post:fit" --settle 300 --format png --out work/captures/scratch/d1/r11e >> $S/d1/r11e.log 2>&1
echo done > $S/d1/r11e.done
