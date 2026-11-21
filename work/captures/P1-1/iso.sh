#!/bin/bash
# P1.1 one-factor isolation: the realtime single-scatter frames again with one extra setting (URL s.<key>=<value>), into <cloud>/iso-<name>/.
# usage: work/captures/P1-1/iso.sh <url-base> <cloud> <name> "<extra query>" [shots]
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; CLOUD=$2; NAME=$3; EXTRA=$4
SH=${5:-nubis-noon,nubis-low,nubis-backlit,nubis-sunset}
Q="clean=1&cloud=$CLOUD&sunOnly=1&single=1&converged=1&spp=64&seed=1&$EXTRA"
node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?$Q" --size 640x360 --format png --linear --settle 8 --eval-timeout 300 --timeout 300 \
  --out work/captures/P1-1/$CLOUD/iso-$NAME --shots $SH 2>&1 | tail -1
