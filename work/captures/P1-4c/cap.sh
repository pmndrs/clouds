#!/bin/bash
# P1.4c: one page load per (cloud, sun): the fit view with defaults (shot fit-<sun>), then the 12 single-term configs (gen.py, fitMsTauSmooth 1) as evals; 120 s cap.
#   cap.sh <url-base> <cloud> <sun>      -> work/captures/P1-4c/<cloud>/<sun>/{fit-<sun>,<cfg>}.pfm
#   cap.sh <url-base> <cloud> final      -> work/captures/P1-4c/<cloud>/final/fit-{noon,low,backlit,sunset}.pfm (defaults only)
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; CLOUD=$2; SUN=$3
t0=$(date +%s)
if [ "$SUN" = final ]; then
  ARGS=(--shots fit-noon,fit-low,fit-backlit,fit-sunset); VIEW=fit-noon
else
  python3 work/captures/P1-4c/gen.py > work/captures/P1-4c/evals.json
  ARGS=(--shots fit-$SUN --evals work/captures/P1-4c/evals.json); VIEW=fit-$SUN
fi
perl -e 'alarm 120; exec @ARGV' node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?clean=1&cloud=$CLOUD&spp=1&converged=1&view=$VIEW" --size 640x360 --format png --linear \
  --settle 8 --eval-timeout 100 --timeout 100 --out work/captures/P1-4c/$CLOUD/$SUN "${ARGS[@]}" 2>&1 | grep -v "^eval " | tail -2
echo "$CLOUD $SUN $(( $(date +%s) - t0 )) s"
