#!/bin/zsh
# D1 round 10: the parity stats of the finals (REF, decima r10, decima r9 in the r10 masks, art, deck) for table10.py
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
R9=work/captures/scratch/d1/r9-final
: > $S/d1/final11-stats.txt
for b in p101 p125 p161 p213 s206 s33t3 s33t6 s33t9 s214; do
  c=parkouring; [[ $b == s* ]] && c=stormbird
  echo "== $b" >> $S/d1/final11-stats.txt
  python3 -I scripts/d1/d1.py stats $(python3 -I -c "import sys; sys.path.insert(0,'scripts/d1'); import d1; print(d1.ref_of('$b'))") "work/captures/D1/$c/$b@look:decima.png" "$R9/$c/$b@look:decima.png" "work/captures/D1/$c/$b@look:art.png" "work/captures/D1/$c/$b@look:deck.png" --matte "work/captures/D1/$c/$b@look:decima@matte.png" --rgb | tail -n +2 >> $S/d1/final11-stats.txt
done
cat $S/d1/final11-stats.txt | cut -c1-200
