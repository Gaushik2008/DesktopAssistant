#!/usr/bin/env bash
# Launches the real Electron app under a virtual display (Linux, needs xvfb + ffmpeg),
# waits for the window, saves a screenshot and fails if Electron logged a JS error.
set -euo pipefail
OUT="${1:-smoke.png}"; D=:97
Xvfb $D -screen 0 1280x720x24 >/dev/null 2>&1 & XPID=$!
trap 'kill $XPID 2>/dev/null || true; pkill -f "electron \." 2>/dev/null || true' EXIT
sleep 1
DISPLAY=$D npx electron . --no-sandbox --disable-gpu >/tmp/electron-smoke.log 2>&1 &
sleep 8
DISPLAY=$D ffmpeg -v error -f x11grab -video_size 1280x720 -i $D -frames:v 1 -y "$OUT"
if grep -E "Uncaught|TypeError|ReferenceError|Unhandled" /tmp/electron-smoke.log; then echo "FAIL: JS error in log"; exit 1; fi
echo "OK: Electron launched, screenshot at $OUT"
