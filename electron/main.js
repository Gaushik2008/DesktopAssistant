'use strict';
// Desktop shell (Windows + Linux, macOS best-effort).
// A small transparent, frameless, always-on-top window parked at the bottom-right
// of the work area, with a tray icon and global hotkeys.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, shell, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { launchApp, safeOpenUrl } = require('./launcher');

const DEV = process.argv.includes('--dev');
const PLATFORM = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const WIN_W = 340, WIN_H = 380;

let win = null;
let tray = null;

// Only one instance.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => win && (win.show(), win.focus()));

// Transparent windows need a compositor on Linux; GPU quirks are common on VMs.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 12,
    y: workArea.y + workArea.height - WIN_H - 8,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'src', 'web', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Never navigate away or open child windows from the renderer.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Grant only the microphone permission (needed for voice).
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.show();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('Sir Pixel');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Talk (Ctrl+Alt+Space)', click: () => { win.show(); win.webContents.send('toggle-listen'); } },
    { label: 'Type a command (Ctrl+Alt+T)', click: () => { win.show(); win.focus(); win.webContents.send('type-command'); } },
    { label: 'Show / Hide', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Alt+Space', () => { win.show(); win.webContents.send('toggle-listen'); });
  globalShortcut.register('CommandOrControl+Alt+T', () => { win.show(); win.focus(); win.webContents.send('type-command'); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

// ------------------------------------------------------------------ IPC ----
ipcMain.handle('execute', async (_e, action) => {
  try {
    if (!action || typeof action !== 'object') return { ok: false, message: 'Bad action.' };
    if (action.kind === 'open-url') return safeOpenUrl(shell, action.url);
    if (action.kind === 'open-app') return launchApp({ spawn, shell, platform: process.platform }, action);
    return { ok: false, message: 'Unsupported action.' };
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) };
  }
});

// Click-through: ignore the mouse except over interactive elements.
// ({forward:true} is unsupported on Linux, so we only enable pass-through on Windows/macOS.)
ipcMain.on('set-interactive', (e, interactive) => {
  if (process.platform === 'linux') return;
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('move-by', (e, dx, dy) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = w.getPosition();
  w.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.handle('platform', () => PLATFORM);
