#!/usr/bin/env bash
# S2 motion: consecutive frames at a fixed clock (scripts/gpu/step-frames.mjs) on the HZD bench, one dir per step (label|query), 1280x720.
#   scripts/s2/motion.sh work/captures/S2/motion "cin-x1|view=gp7&style=real&motion=1" "desk-x1|view=gp7&style=real&level=desktop&motion=1"
# Warm-up 420 frames (the layer converges; the upscaler starts after 240), then FRAMES (default 8) frames. A lost device is retried (TRIES, default 4).
set -u
out=$1; shift
cd "$(dirname "$0")/../.."
port=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1])")
CLOUDS_NO_WATCH=1 node_modules/.bin/vite --host 127.0.0.1 --port $port --strictPort > /dev/null 2>&1 &
vite=$!
trap "kill $vite 2>/dev/null" EXIT
until curl -s -o /dev/null "http://127.0.0.1:$port/"; do sleep 1; done
for step in "$@"; do
  label=${step%%|*}; query=${step#*|}
  for try in $(seq 1 ${TRIES:-4}); do
    node scripts/gpu/step-frames.mjs --url "http://127.0.0.1:$port/hzd/?clean=1&$query" --out "$out/$label" --size ${SIZE:-1280x720} \
      --warm ${WARM:-420} --frames ${FRAMES:-8} --settleMs 8000 2>&1 | grep -E "^(OK|FAILED)" | sed "s|^|$label: |"
    grep -q "device lost\|is lost\|FAILED\|never started" "$out/$label/capture.json" 2>/dev/null || [ ! -f "$out/$label/f000.png" ] || break
    echo "$label: lost or failed (retry $try)"
  done
done
