#!/usr/bin/env bash
# S2 captures: a list of steps (label|query) on the HZD bench, frozen (motion=0; MOTION=1 to animate), clean, PNG, one dir per step.
#   scripts/s2/cap.sh work/captures/S2/hatch ground,gp7,above "a|style=real" "b|style=real&level=desktop" ...
# The first shot is a warm-up: on this machine the sky's pipelines often compile after the first settle, so the first shot can be an empty sky.
# A step that lost its device, missed a shot, or whose later shots have no sky-layer timing is retried (TRIES, default 6; scripts/s2/check.py).
set -u
out=$1; shots=$2; shift 2
cd "$(dirname "$0")/../.."
for step in "$@"; do
  label=${step%%|*}; query=${step#*|}
  for try in $(seq 1 ${TRIES:-6}); do
    node scripts/gpu/capture.mjs --serve --page hzd/ --shots "$shots" --settle ${SETTLE:-450} --size ${SIZE:-1920x1080} --timeout 300 --eval-timeout 400 --format png \
      --query "clean=1&motion=${MOTION:-0}&$query" --out "$out/$label" 2>&1 | grep -E "^(OK|FAILED)" | sed "s|^|$label: |"
    bad=$(python3 scripts/s2/check.py "$out/$label" "$shots")
    [ -z "$bad" ] && break
    echo "$label: $bad (retry $try)"
  done
done
