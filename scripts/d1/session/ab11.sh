#!/bin/zsh
# D1 round 11: the per-change A/B sheets of the bisect (frame | A | B), to /Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r11/ab-*.jpg
cd /Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11
S=/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad
O=/Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r11; mkdir -p $O
D=work/captures/scratch/d1/r11a
CAM="@cam:-297.7:0:-628.5:-95.6:201.6:-6.8:38.97"; R9P="@ramp:0@skytint:0@s.microShadow:0"; R9S="@ramp:0@skytint:0@s.microShadow:0@s.ambientStrength:1"
ab() { python3 -I $S/d1/ab.py "$O/ab-$1.jpg" $2 "$3" "$4" | cut -c1-400; }
# Parkouring: r9eq + one change
ab p101-ramp p101 "$D/p101@look:decima$R9P$CAM.png" "$D/p101@look:decima$R9P$CAM@ramp:1.png"
ab p101-ramp-skyonly p101 "$D/p101@look:decima$R9P$CAM.png" "$D/p101@look:decima$R9P$CAM@ramp:2.png"
ab p101-skytint p101 "$D/p101@look:decima$R9P$CAM.png" "$D/p101@look:decima$R9P$CAM@skytint:1.png"
ab p101-micro p101 "$D/p101@look:decima$R9P$CAM.png" "$D/p101@look:decima$R9P$CAM@s.microShadow:2.png"
ab p101-camera p101 "$D/p101@look:decima$R9P$CAM.png" "$D/p101@look:decima$R9P.png"
ab p213-ramp p213 "$D/p213@look:decima$R9P.png" "$D/p213@look:decima$R9P@ramp:1.png"
ab p213-ramp-skyonly p213 "$D/p213@look:decima$R9P.png" "$D/p213@look:decima$R9P@ramp:2.png"
ab p213-skytint p213 "$D/p213@look:decima$R9P.png" "$D/p213@look:decima$R9P@skytint:1.png"
ab p213-micro p213 "$D/p213@look:decima$R9P.png" "$D/p213@look:decima$R9P@s.microShadow:2.png"
ab p213-haze0 p213 "$D/p213@look:decima.png" "$D/p213@look:decima@s.hazeDensity:0.png"
# Stormbird: r9eq (45 deg sun, ambient 1.0) + one change
for r in s206:45:60 s33t3:45:150; do f=${r%%:*}; sun=${r#*:}
  ab $f-ramp $f "$D/$f@look:decima$R9S@sun:$sun.png" "$D/$f@look:decima$R9S@sun:$sun@ramp:1.png"
  ab $f-ramp-skyonly $f "$D/$f@look:decima$R9S@sun:$sun.png" "$D/$f@look:decima$R9S@sun:$sun@ramp:2.png"
  ab $f-skytint $f "$D/$f@look:decima$R9S@sun:$sun.png" "$D/$f@look:decima$R9S@sun:$sun@skytint:1.png"
  ab $f-micro $f "$D/$f@look:decima$R9S@sun:$sun.png" "$D/$f@look:decima$R9S@sun:$sun@s.microShadow:2.png"
  ab $f-sun35 $f "$D/$f@look:decima$R9S@sun:$sun.png" "$D/$f@look:decima$R9S.png"
  ab $f-ambient07 $f "$D/$f@look:decima$R9S@sun:$sun.png" "$D/$f@look:decima$R9S@sun:$sun@s.ambientStrength:0.7.png"
  ab $f-haze0 $f "$D/$f@look:decima.png" "$D/$f@look:decima@s.hazeDensity:0.png"
done
