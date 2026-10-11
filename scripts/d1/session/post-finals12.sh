#!/bin/zsh
# D1 round 11: after the finals: stability, stats table, florets at 4k, fingerprints, blind set k, parity table into the report.
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
echo "== stability"; for l in decima art deck; do echo -n "$l: "; python3 -I scripts/d1/d1.py flicker work/captures/D1/stability/$l/view*.jpg 2>&1 | tail -1 | cut -c1-100; done
echo "== stats"; zsh $S/d1/final12-stats.sh > /dev/null 2>&1; grep -c "" $S/d1/final12-stats.txt
echo "== florets 4k (frame / r11 / r12)"; python3 -I $S/d1/floreteval.py work/captures/scratch/d1/final12-4k p101,p213 2>&1 | grep -v art | sed 's/floret=.*dfrac=[0-9.]* //' | cut -c1-170
echo "== fingerprints (frame / r11 / r12)"; F=work/captures/scratch/d1/fp12; mkdir -p $F; cp work/captures/D1/stormbird/s33t3@look:decima.png work/captures/D1/stormbird/s206@look:decima.png $F/; cp work/captures/scratch/d1/r11-final/stormbird/s33t3@look:decima.png "$F/s33t3@look:decima@r11.png"; cp work/captures/scratch/d1/r11-final/stormbird/s206@look:decima.png "$F/s206@look:decima@r11.png"; python3 -I $S/d1/eval9.py $F fp12 2>&1 | grep "==\|(base)\|@r11" | cut -c1-120
echo "== blind set"; python3 -I $S/d1/blind12.py 2>&1 | tail -1; ls $S/blind-d1l | wc -l
