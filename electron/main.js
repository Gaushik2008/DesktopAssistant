'use strict';
// Desktop shell (Windows + Linux, macOS best-effort).
// A small transparent, frameless, always-on-top window parked at the bottom-right
// of the work area, with a tray icon and global hotkeys.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, shell, nativeImage, safeStorage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { launchApp, safeOpenUrl } = require('./launcher');
const llm = require('./llm');

const DEV = process.argv.includes('--dev');
const PLATFORM = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const WIN_W = 340, WIN_H = 480; // tall enough for bubble + settings panel + pet

let win = null;
let tray = null;

// Only one instance.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => win && (win.show(), win.focus()));

// Transparent windows need a compositor on Linux; GPU quirks are common on VMs.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // Wayland compositors ignore "always on top" from normal windows; XWayland honours it.
  // Set SIRPIXEL_OZONE=wayland to opt out.
  app.commandLine.appendSwitch('ozone-platform', process.env.SIRPIXEL_OZONE || 'x11');
}

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
  keepOnTop();
  // Other apps (fullscreen, taskbar clicks, focus changes) can knock the topmost flag off,
  // so re-assert it on window events, display changes and a slow timer.
  for (const ev of ['blur', 'show', 'restore']) win.on(ev, keepOnTop);
  screen.on('display-metrics-changed', keepOnTop);
  setInterval(keepOnTop, 3000);
  win.loadFile(path.join(__dirname, '..', 'src', 'web', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Never navigate away or open child windows from the renderer.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Grant only the microphone permission (needed for voice).
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

let onTop = true;
function keepOnTop() {
  if (!win || win.isDestroyed() || !onTop || !win.isVisible()) return;
  // 'screen-saver' is the highest level: above fullscreen apps and the taskbar / panel.
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.moveTop();
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
    { label: 'Settings (Gemini API key)', click: () => { win.show(); win.focus(); win.webContents.send('open-settings'); } },
    { label: 'Always on top', type: 'checkbox', checked: true, click: (item) => { onTop = item.checked; win.setAlwaysOnTop(onTop, 'screen-saver'); if (onTop) keepOnTop(); } },
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

// ---- AI chat fallback (key stays in this process) ----
let llmStore;
const store = () => (llmStore ||= llm.createStore({ file: path.join(app.getPath('userData'), 'llm.json'), safeStorage }));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
ipcMain.handle('llm:get-settings', () => store().get());
ipcMain.handle('llm:save-settings', (_e, input) => (isObj(input) ? store().save(input) : store().get()));
ipcMain.handle('llm:chat', (_e, req) => {
  if (!isObj(req)) return { ok: false, message: 'Bad request.' };
  const history = Array.isArray(req.history) ? req.history : [];
  return llm.withModelRecovery((settings) => llm.chat({ settings, history, text: req.text }), store());
});

// Speech-to-text (Gemini). Audio comes from the renderer; the key stays here.
ipcMain.handle('stt:transcribe', (_e, req) => {
  if (!isObj(req)) return { ok: false, code: 'error', message: 'Bad request.' };
  return llm.withModelRecovery((settings) => llm.transcribe({ settings, base64: req.base64, mime: req.mime }), store());
});

ipcMain.handle('platform', () => PLATFORM);
