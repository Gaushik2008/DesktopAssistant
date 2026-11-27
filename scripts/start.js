#!/usr/bin/env node
// Launcher: passes Chromium flags on the *command line*, where they are guaranteed to take effect
// (app.commandLine.appendSwitch() in main.js can be too late for display/GPU settings on Linux).
//   npm start                      normal (auto-detects Wayland/X11)
//   SIRPIXEL_GPU=1 npm start       allow GPU on Linux
//   SIRPIXEL_OZONE=x11 npm start   force X11/XWayland (for troubleshooting)
//   SIRPIXEL_DEBUG=1 npm start     print window/diagnostic info
const { spawn } = require('child_process');
const electron = require('electron'); // path to the electron binary

console.error('[sirpixel] start.js running, electron:', electron);
console.error('[sirpixel] platform:', process.platform, 'SIRPIXEL_GPU:', process.env.SIRPIXEL_GPU, 'SIRPIXEL_OZONE:', process.env.SIRPIXEL_OZONE, 'XDG_SESSION_TYPE:', process.env.XDG_SESSION_TYPE);

const args = [];
if (process.platform === 'linux') {
  // Let main.js auto-detect Wayland vs X11 via SIRPIXEL_OZONE env var
  // Only pass GPU/transparent flags here; ozone-platform is set in main.js
  args.push('--enable-transparent-visuals');
  if (!process.env.SIRPIXEL_GPU) args.push('--disable-gpu', '--disable-software-rasterizer=false', '--disable-features=VaapiVideoDecoder,VaapiVideoEncoder');
}
args.push('.', ...process.argv.slice(2));

if (process.env.SIRPIXEL_DEBUG) console.error('[sirpixel] electron', args.join(' '));
const child = spawn(electron, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code, sig) => process.exit(code === null ? (sig ? 1 : 0) : code));
