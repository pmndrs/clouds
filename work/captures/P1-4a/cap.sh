#!/bin/bash
# P1.4a: the 'fit' view (defaults) of the card at sun low and sunset, linear 640x360, converged; 90 s hard cap.
# usage: work/captures/P1-4a/cap.sh <url-base> <cloud>   -> work/captures/P1-4a/<cloud>/fit-{low,sunset}.pfm
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; CLOUD=$2
t0=$(date +%s)
perl -e 'alarm 90; exec @ARGV' node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?clean=1&cloud=$CLOUD&spp=1&converged=1" --size 640x360 --format png --linear \
  --settle 8 --eval-timeout 80 --timeout 80 --out work/captures/P1-4a/$CLOUD --shots fit-low,fit-sunset 2>&1 | tail -1
echo "$CLOUD $(( $(date +%s) - t0 )) s"
