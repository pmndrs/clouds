#!/bin/bash
# P1.1b: realtime single-scatter frames (sun only, converged) with extra settings, into work/captures/P1-1b/<cloud>/<name>/, 240 s hard cap.
# usage: work/captures/P1-1b/cap.sh <url-base> <cloud> <name> "<extra query>" [shots]     (score with score.py <dir> <cloud>)
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; CLOUD=$2; NAME=$3; EXTRA=$4
SH=${5:-nubis-noon,nubis-low,nubis-backlit,nubis-sunset}
Q="clean=1&cloud=$CLOUD&sunOnly=1&single=1&converged=1&spp=64&seed=1&$EXTRA"
t0=$(date +%s)
perl -e 'alarm 280; exec @ARGV' node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?$Q" --size 640x360 --format png --linear --settle 8 --eval-timeout 120 --timeout 120 \
  --out work/captures/P1-1b/$CLOUD/$NAME --shots $SH 2>&1 | tail -1
echo "$CLOUD $NAME $(( $(date +%s) - t0 )) s"
python3 work/captures/P1-1b/score.py work/captures/P1-1b/$CLOUD/$NAME $CLOUD
