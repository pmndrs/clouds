#!/usr/bin/env bash
# S1 look rounds: capture a list of steps (label|query) on the HZD bench, frozen (motion=0, MOTION=1 to animate) and clean, one dir per step.
#   scripts/s1/steps.sh work/captures/S1/early-r1 gp7,ground "e0|style=horizon" "e1|style=horizon&hz_n3Strength=0.4" ...
# A capture whose report has no sky-layer timing (the page reported ready before the sky drew: an empty sky) is retried up to twice.
set -u
out=$1; shots=$2; shift 2
cd "$(dirname "$0")/../.."
for step in "$@"; do
  label=${step%%|*}; query=${step#*|}
  for try in 1 2 3; do
    node scripts/gpu/capture.mjs --serve --page hzd/ --shots "$shots" --settle 400 --size 1920x1080 --timeout 300 \
      --query "clean=1&motion=${MOTION:-0}&$query" --out "$out/$label" 2>&1 | grep -E "^(OK|FAILED)" | sed "s|^|$label: |"
    n=$(grep -o '"skyLayer"' "$out/$label/capture.json" 2>/dev/null | wc -l | tr -d ' ')
    want=$(echo "$shots" | tr ',' '\n' | wc -l | tr -d ' ')
    [ "$n" -ge $((want * 2)) ] && break
    echo "$label: missing sky timing ($n/$want), retry $try"
  done
done
