#!/bin/zsh
# D1 round 10 finals: PNG 1080p of all nine bookmarks x 3 looks + mattes, 4k q100 pairs, stability.
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
rm -f $S/d1/final12.done
P=""; for b in p101 p125 p161 p213; do for l in decima deck art; do P="$P,$b@look:$l,$b@look:$l@matte"; done; done; P=${P#,}
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=parkouring&clean=1" --shots "$P" --settle 300 --format png --out work/captures/D1/parkouring > $S/d1/final12-p.log 2>&1
Q=""; for b in s206 s33t3 s33t6 s33t9 s214; do for l in decima deck art; do Q="$Q,$b@look:$l,$b@look:$l@matte"; done; done; Q=${Q#,}
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=stormbird&clean=1" --shots "$Q" --settle 300 --format png --out work/captures/D1/stormbird > $S/d1/final12-s.log 2>&1
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=parkouring&clean=1" --shots "p101@look:decima,p101@look:art,p213@look:decima,p213@look:art" --size 3840x2160 --settle 300 --quality 100 --out work/captures/scratch/d1/final12-4k > $S/d1/final12-4k.log 2>&1
for l in decima art deck; do node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=parkouring&bookmark=p101&look=$l&clean=1" --shots "view,view,view,view,view,view" --settle 60 --out work/captures/D1/stability/$l > $S/d1/final12-stab-$l.log 2>&1; done
echo done > $S/d1/final12.done
