'use strict';
// Safe launcher. Only catalog entries and allow-listed URL schemes are ever run.
// spawn() is always called WITHOUT a shell, with an args array, so spoken text
// can never be interpreted as shell syntax.

const ALLOWED_SCHEMES = ['https:', 'http:', 'spotify:', 'mailto:', 'discord:'];

// Mirror of src/web/core/catalog.js (that file is ESM for the renderer; this is CJS).
// Kept tiny on purpose - desktop commands only. A unit test checks they stay in sync.
const DESKTOP_APPS = {
  spotify: { uri: 'spotify:', search: (q) => `spotify:search:${encodeURIComponent(q)}`, label: 'Spotify' },
  discordapp: { uri: 'discord:', label: 'Discord' },
  calculator: { win32: ['calc.exe'], linux: ['gnome-calculator', 'kcalc', 'galculator', 'xcalc'], label: 'Calculator' },
  notepad: { win32: ['notepad.exe'], linux: ['gedit', 'kate', 'mousepad', 'xed'], label: 'Notepad' },
  terminal: { win32: ['wt.exe', 'cmd.exe'], linux: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'], label: 'Terminal' },
  files: { win32: ['explorer.exe'], linux: ['xdg-open'], linuxArgs: ['.'], label: 'File Explorer' },
  settings: {
    win32: ['explorer.exe'], win32Args: ['ms-settings:'],
    linux: ['gnome-control-center', 'systemsettings', 'xfce4-settings-manager'], label: 'Settings',
  },
};

function isSafeUrl(url) {
  try { return ALLOWED_SCHEMES.includes(new URL(url).protocol); } catch { return false; }
}

async function safeOpenUrl(shell, url) {
  if (!isSafeUrl(url)) return { ok: false, message: 'Blocked unsafe link.' };
  await shell.openExternal(url);
  return { ok: true };
}

/** Try commands in order until one starts. Resolves true on first success. */
function trySpawn(spawn, commands, args) {
  return new Promise((resolve) => {
    const next = (i) => {
      if (i >= commands.length) return resolve(false);
      let settled = false;
      const child = spawn(commands[i], args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
      child.once('error', () => { if (!settled) { settled = true; next(i + 1); } });
      child.once('spawn', () => { if (!settled) { settled = true; child.unref(); resolve(true); } });
    };
    next(0);
  });
}

async function launchApp({ spawn, shell, platform }, action) {
  const app = DESKTOP_APPS[action.appId];
  if (!app) return { ok: false, message: 'Unknown app.' };

  // URI-style apps (Spotify, Discord): hand the URI to the OS.
  if (app.uri) {
    const url = typeof action.query === 'string' && action.query && app.search ? app.search(action.query.slice(0, 200)) : app.uri;
    try {
      await safeOpenUrl(shell, url);
      return { ok: true };
    } catch {
      return { ok: false, message: `${app.label} doesn't seem to be installed.` };
    }
  }

  const key = platform === 'win32' ? 'win32' : 'linux';
  const cmds = app[key];
  if (!cmds) return { ok: false, message: `${app.label} isn't available on this system.` };
  const args = (key === 'win32' ? app.win32Args : app.linuxArgs) || [];
  const ok = await trySpawn(spawn, cmds, args);
  return ok ? { ok: true } : { ok: false, message: `I couldn't find ${app.label} on this system.` };
}

module.exports = { launchApp, safeOpenUrl, isSafeUrl, DESKTOP_APPS, trySpawn };
