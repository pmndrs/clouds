#!/bin/bash
# P1.6a: one page load per (cloud, sun): the fit view (defaults, shot fit-<sun>), then gen.py's 12 single-term configs as evals; 120 s cap.
#   cap.sh <url-base> <cloud> <sun> [settle]   -> work/captures/P1-6a/<cloud>/<sun>/{fit-<sun>,<cfg>}.pfm
#   cap.sh <url-base> <cloud> final [settle]   -> work/captures/P1-6a/<cloud>/final/fit-<suns>.pfm (defaults only; tower: noon, low)
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; CLOUD=$2; SUN=$3; SETTLE=${4:-8}
t0=$(date +%s)
if [ "$SUN" = final ]; then
  if [ "$CLOUD" = tower ]; then SH=fit-noon,fit-low; else SH=fit-noon,fit-low,fit-backlit,fit-sunset; fi
  ARGS=(--shots $SH); VIEW=fit-noon
else
  python3 work/captures/P1-6a/gen.py > work/captures/P1-6a/evals.json
  ARGS=(--shots fit-$SUN --evals work/captures/P1-6a/evals.json); VIEW=fit-$SUN
fi
perl -e 'alarm 120; exec @ARGV' node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?clean=1&cloud=$CLOUD&spp=1&converged=1&view=$VIEW" --size 640x360 --format png --linear \
  --settle $SETTLE --eval-timeout 100 --timeout 100 --out work/captures/P1-6a/$CLOUD/$SUN "${ARGS[@]}" 2>&1 | grep -v "^eval " | tail -2
echo "$CLOUD $SUN $(( $(date +%s) - t0 )) s"
