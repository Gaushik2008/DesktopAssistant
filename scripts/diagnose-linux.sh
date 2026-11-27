#!/usr/bin/env bash
# diagnose-linux.sh - Diagnose Linux Electron/Wayland issues for DO.IT
set -euo pipefail

echo "=== DO.IT Linux Diagnostics ==="
echo "Date: $(date)"
echo ""

echo "--- System Info ---"
echo "Kernel: $(uname -r)"
echo "Distro: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"')"
echo "Desktop: ${XDG_CURRENT_DESKTOP:-unknown}"
echo "Session Type: ${XDG_SESSION_TYPE:-unknown}"
echo "Wayland Display: ${WAYLAND_DISPLAY:-none}"
echo ""

echo "--- Electron Info ---"
cd "$(dirname "$0")/.."
npx electron --version 2>/dev/null || echo "Electron not found in project"
node -e "console.log('Node:', process.version)" 2>/dev/null
echo ""

echo "--- GPU/Driver Info ---"
if command -v glxinfo >/dev/null 2>&1; then
    glxinfo | grep -E "OpenGL renderer|OpenGL version" | head -2
else
    echo "glxinfo not available"
fi
if command -v vainfo >/dev/null 2>&1; then
    vainfo 2>&1 | head -5
else
    echo "vainfo not available"
fi
echo ""

echo "--- Electron Launch Test (5s) ---"
echo "Testing with native Wayland (default)..."
SIRPIXEL_DEBUG=1 timeout 5 node scripts/start.js 2>&1 | head -20 || true
echo ""
echo "Testing with forced X11 (SIRPIXEL_OZONE=x11)..."
SIRPIXEL_DEBUG=1 SIRPIXEL_OZONE=x11 timeout 5 node scripts/start.js 2>&1 | head -20 || true
echo ""
echo "Testing with GPU enabled (SIRPIXEL_GPU=1)..."
SIRPIXEL_DEBUG=1 SIRPIXEL_GPU=1 timeout 5 node scripts/start.js 2>&1 | head -20 || true
echo ""

echo "--- Common Fixes ---"
echo "1. If window closes immediately on Wayland: already fixed (auto-detects native Wayland)"
echo "2. If GPU crashes (VAAPI too old): runs with software rendering by default"
echo "3. To force X11: SIRPIXEL_OZONE=x11 npm start"
echo "4. To enable GPU: SIRPIXEL_GPU=1 npm start"
echo "5. For debug logs: SIRPIXEL_DEBUG=1 npm start"
echo ""
echo "=== Diagnostics Complete ==="