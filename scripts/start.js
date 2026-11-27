#!/usr/bin/env node
// Launcher: passes Chromium flags on the *command line*, where they are guaranteed to take effect
// (app.commandLine.appendSwitch() in main.js can be too late for display/GPU settings on Linux).
//   npm start                      normal
//   SIRPIXEL_GPU=1 npm start       allow GPU on Linux
//   SIRPIXEL_OZONE=wayland ...     use native Wayland instead of X11/XWayland
//   SIRPIXEL_DEBUG=1 npm start     print window/diagnostic info
const { spawn } = require('child_process');
const electron = require('electron'); // path to the electron binary

const args = [];
if (process.platform === 'linux') {
  args.push(`--ozone-platform=${process.env.SIRPIXEL_OZONE || 'x11'}`, '--enable-transparent-visuals');
  if (!process.env.SIRPIXEL_GPU) args.push('--disable-gpu', '--disable-software-rasterizer=false', '--disable-features=VaapiVideoDecoder,VaapiVideoEncoder');
}
args.push('.', ...process.argv.slice(2));

if (process.env.SIRPIXEL_DEBUG) console.error('[sirpixel] electron', args.join(' '));
const child = spawn(electron, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code, sig) => process.exit(code === null ? (sig ? 1 : 0) : code));
