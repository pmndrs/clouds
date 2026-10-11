#!/bin/zsh
# D1 round 11: directProfile and the ambient tint, on the candidate base (smooth ramp sky-only, no micro occlusion): one change at a time.
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
rm -f $S/d1/r11d.done
C="@s.microShadow:0"
V=""; for b in p101 p213; do V="$V,$b@look:decima$C,$b@look:decima$C@s.directProfile:0.5,$b@look:decima$C@s.directProfile:1,$b@look:decima$C@ambtint:1.04:1:1.02,$b@look:decima$C@ambtint:1.05:1:1.05,$b@look:decima$C@s.directProfile:0.5@ambtint:1.04:1:1.02,$b@look:decima@s.microDist:2@s.microDist2:6@s.microShadow2:1"; done; V=${V#,}
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=parkouring&clean=1" --shots "$V" --settle 300 --format png --out work/captures/scratch/d1/r11d > $S/d1/r11d.log 2>&1
W=""; for b in s206 s33t3; do W="$W,$b@look:decima$C,$b@look:decima$C@s.directProfile:0.5,$b@look:decima$C@s.directProfile:1,$b@look:decima$C@ambtint:1.05:1:1.05,$b@look:decima$C@ambtint:1.08:1:1.06,$b@look:decima$C@s.directProfile:0.5@ambtint:1.05:1:1.05"; done; W=${W#,}
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=stormbird&clean=1" --shots "$W" --settle 300 --format png --out work/captures/scratch/d1/r11d >> $S/d1/r11d.log 2>&1
echo done > $S/d1/r11d.done
