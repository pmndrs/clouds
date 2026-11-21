#!/bin/bash
# P1.2c: the 'fit' view of the short card (noon, backlit) with fit* settings, linear 640x360, converged; 150 s hard cap.
# usage: work/captures/P1-2c/cap.sh <url-base> <cloud> <name> "<s.key=value&...>"   -> work/captures/P1-2c/<cloud>/<name>/fit-{noon,backlit}.pfm
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; CLOUD=$2; NAME=$3; EXTRA=$4
t0=$(date +%s)
perl -e 'alarm 150; exec @ARGV' node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?clean=1&cloud=$CLOUD&spp=1&converged=1&$EXTRA" --size 640x360 --format png --linear \
  --settle 8 --eval-timeout 120 --timeout 120 --out work/captures/P1-2c/$CLOUD/$NAME --shots fit-noon,fit-backlit 2>&1 | tail -1
echo "$CLOUD $NAME $(( $(date +%s) - t0 )) s"
