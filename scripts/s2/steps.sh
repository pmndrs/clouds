#!/usr/bin/env bash
# S2 captures: a list of steps (label|query) on the HZD bench, frozen (motion=0; MOTION=1 to animate), clean, PNG, one dir per step.
#   scripts/s2/steps.sh work/captures/S2/hatch ground,gp7,above "a|style=real" "b|style=real&level=desktop" ...
# The first shot is a warm-up: on this machine the sky's pipelines often compile after the first settle, so the first shot can be an empty sky.
# A step whose other shots have no sky-layer timing (the page reported ready before the sky drew) or that failed is retried up to 5 times.
set -u
out=$1; shots=$2; shift 2
cd "$(dirname "$0")/../.."
for step in "$@"; do
  label=${step%%|*}; query=${step#*|}
  for try in 1 2 3 4 5; do
    node scripts/gpu/capture.mjs --serve --page hzd/ --shots "$shots" --settle ${SETTLE:-450} --size ${SIZE:-1920x1080} --timeout 300 --eval-timeout 400 --format png \
      --query "clean=1&motion=${MOTION:-0}&$query" --out "$out/$label" 2>&1 | grep -E "^(OK|FAILED)" | sed "s|^|$label: |"
    missing=$(python3 -c "
import json, sys
try: d = json.load(open('$out/$label/capture.json'))
except Exception: print('all'); sys.exit()
shots = d.get('shots', [])
bad = [s['name'] for s in shots[1:] if not (s.get('report') or {}).get('gpuMs', {}).get('skyLayer')]
want = len('$shots'.split(','))
print(' '.join(bad) if bad or len(shots) < want else '')")
    [ -z "$missing" ] && break
    echo "$label: no sky in: $missing (retry $try)"
  done
done
