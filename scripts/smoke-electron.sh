#!/usr/bin/env bash
# Launches the real Electron app under a virtual display (Linux, needs xvfb + ffmpeg),
# waits for the window, saves a screenshot and fails on JS errors or if the pet corner is blank.
set -euo pipefail
OUT="${1:-smoke.png}"; D=:97
Xvfb $D -screen 0 1280x720x24 >/dev/null 2>&1 & XPID=$!
trap 'kill $XPID 2>/dev/null || true; pkill -f "electron \." 2>/dev/null || true' EXIT
sleep 1
# fresh profile each run: a stale single-instance lock from a killed run would make Electron quit silently
UD="$(mktemp -d)"
DISPLAY=$D npx electron . --no-sandbox --disable-gpu --user-data-dir="$UD" >/tmp/electron-smoke.log 2>&1 &
sleep 8
DISPLAY=$D ffmpeg -v error -f x11grab -video_size 1280x720 -i $D -frames:v 1 -y "$OUT"
if grep -E "Uncaught|TypeError|ReferenceError|Unhandled" /tmp/electron-smoke.log; then echo "FAIL: JS error in log"; exit 1; fi
# the pet lives in the bottom-right corner: an all-black corner means no window was drawn
MEAN=$(convert "$OUT" -crop 220x200+1060+520 +repage -format "%[fx:mean]" info:)
if ! awk -v m="$MEAN" 'BEGIN{exit !(m>0.03)}'; then echo "FAIL: nothing rendered in the pet corner (mean=$MEAN)"; exit 1; fi
echo "OK: Electron launched and rendered (corner mean=$MEAN), screenshot at $OUT"
