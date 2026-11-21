#!/bin/bash
# P1.1 captures: per cloud, seed 1 (PT single scatter, realtime direct converged, alpha masks, sun-at-centre variant, light probes) and seed 2 (PT).
# usage: work/captures/P1-1/run.sh <url-base> <spp> <cloud> [<cloud> ...]      (evals.json from make_evals.py)
set -u
cd "$(dirname "$0")/../../.."
BASE=$1; SPP=$2; shift 2
for CLOUD in "$@"; do
  O=work/captures/P1-1/$CLOUD
  Q="clean=1&cloud=$CLOUD&sunOnly=1&single=1&converged=1&spp=$SPP"
  SH=pt-noon,pt-low,pt-backlit,pt-sunset,nubis-noon,nubis-low,nubis-backlit,nubis-sunset,alpha-noon,alpha-low,alpha-backlit,alpha-sunset
  t0=$(date +%s)
  node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?$Q&seed=1" --size 640x360 --format png --linear --settle 8 --eval-timeout 300 --timeout 300 --out $O --shots $SH --evals work/captures/P1-1/evals.json 2>&1 | grep -v "^eval \|^captured " | tail -3
  t1=$(date +%s)
  node scripts/gpu/capture.mjs --url "$BASE/reference-pt/?$Q&seed=2" --size 640x360 --format png --linear --settle 8 --eval-timeout 300 --timeout 300 --out $O/seed2 --shots pt-noon,pt-low,pt-backlit,pt-sunset 2>&1 | tail -1
  t2=$(date +%s)
  echo "$CLOUD seed1 $((t1-t0)) s, seed2 $((t2-t1)) s"
done
