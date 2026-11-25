// Catalog of websites and apps the assistant knows how to open.
// SECURITY: user speech is never passed to a shell. Only entries from this
// catalog (or validated URLs) are ever executed by a platform bridge.

/** Websites -> opened in the default browser on every platform. */
export const SITES = {
  youtube: { label: 'YouTube', url: 'https://www.youtube.com', search: 'https://www.youtube.com/results?search_query=' },
  google: { label: 'Google', url: 'https://www.google.com', search: 'https://www.google.com/search?q=' },
  gmail: { label: 'Gmail', url: 'https://mail.google.com' },
  github: { label: 'GitHub', url: 'https://github.com', search: 'https://github.com/search?q=' },
  maps: { label: 'Google Maps', url: 'https://maps.google.com', search: 'https://www.google.com/maps/search/' },
  netflix: { label: 'Netflix', url: 'https://www.netflix.com' },
  reddit: { label: 'Reddit', url: 'https://www.reddit.com', search: 'https://www.reddit.com/search/?q=' },
  twitter: { label: 'X', url: 'https://x.com' },
  whatsapp: { label: 'WhatsApp Web', url: 'https://web.whatsapp.com' },
  wikipedia: { label: 'Wikipedia', url: 'https://en.wikipedia.org', search: 'https://en.wikipedia.org/w/index.php?search=' },
  claude: { label: 'Claude', url: 'https://claude.ai' },
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com' },
  amazon: { label: 'Amazon', url: 'https://www.amazon.in' },
  discord: { label: 'Discord', url: 'https://discord.com/app' },
};

/** Words people say -> SITES key. */
export const SITE_ALIASES = {
  yt: 'youtube', 'you tube': 'youtube', 'google search': 'google', 'google maps': 'maps', map: 'maps',
  'x': 'twitter', 'twitter': 'twitter', 'whats app': 'whatsapp', 'whatsapp': 'whatsapp', 'wiki': 'wikipedia',
  'chat gpt': 'chatgpt', 'git hub': 'github', 'mail': 'gmail', 'email': 'gmail',
};

/**
 * Native apps. Each platform entry is either a command (desktop) or a URI /
 * Android package (mobile). `uri` works everywhere the app registers a scheme.
 */
export const APPS = {
  spotify: { label: 'Spotify', aliases: ['spotify', 'music'], uri: 'spotify:', search: (q) => `spotify:search:${encodeURIComponent(q)}` },
  calculator: {
    label: 'Calculator', aliases: ['calculator', 'calc'],
    win32: { cmd: 'calc.exe', args: [] }, linux: { cmd: 'gnome-calculator', args: [], fallbacks: ['kcalc', 'galculator', 'xcalc'] },
    android: { package: 'com.google.android.calculator' },
  },
  notepad: {
    label: 'Notepad', aliases: ['notepad', 'text editor', 'notes'],
    win32: { cmd: 'notepad.exe', args: [] }, linux: { cmd: 'gedit', args: [], fallbacks: ['kate', 'mousepad', 'xed'] },
    android: { package: 'com.google.android.keep' },
  },
  terminal: {
    label: 'Terminal', aliases: ['terminal', 'command prompt', 'cmd', 'console'],
    win32: { cmd: 'wt.exe', args: [], fallbacks: ['cmd.exe'] },
    linux: { cmd: 'x-terminal-emulator', args: [], fallbacks: ['gnome-terminal', 'konsole', 'xterm'] },
  },
  files: {
    label: 'File Explorer', aliases: ['file explorer', 'files', 'file manager', 'explorer'],
    win32: { cmd: 'explorer.exe', args: [] }, linux: { cmd: 'xdg-open', args: ['.'] },
    android: { package: 'com.google.android.documentsui' },
  },
  settings: {
    label: 'Settings', aliases: ['settings', 'system settings'],
    win32: { cmd: 'explorer.exe', args: ['ms-settings:'] },
    linux: { cmd: 'gnome-control-center', args: [], fallbacks: ['systemsettings', 'xfce4-settings-manager'] },
    android: { intent: 'android.settings.SETTINGS' },
  },
  camera: { label: 'Camera', aliases: ['camera'], android: { package: 'com.android.camera' } },
  discordapp: { label: 'Discord', aliases: ['discord app'], uri: 'discord:' },
};

/** Find an app by a spoken name. */
export function findApp(name) {
  const n = name.trim().toLowerCase();
  for (const [id, app] of Object.entries(APPS)) {
    if (id === n || app.aliases.includes(n)) return { id, ...app };
  }
  return null;
}

/** Find a website by a spoken name. */
export function findSite(name) {
  const n = name.trim().toLowerCase();
  const key = SITE_ALIASES[n] || n.replace(/\s+/g, '');
  return SITES[key] ? { id: key, ...SITES[key] } : null;
}

/** Only these URL schemes may ever be opened by a bridge. */
export const ALLOWED_SCHEMES = ['https:', 'http:', 'spotify:', 'mailto:', 'discord:'];

export function isSafeUrl(url) {
  try {
    return ALLOWED_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
