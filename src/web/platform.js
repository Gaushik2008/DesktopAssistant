// Platform bridge: one tiny interface, three implementations.
//
//   platform.name                     'windows' | 'linux' | 'macos' | 'android' | 'web'
//   platform.execute(action)          -> Promise<{ok, message?}>
//   platform.onToggleListen(cb)       global hotkey / tray -> start/stop listening
//   platform.onTypeCommand(cb)        hotkey -> show typed box
//   platform.setInteractive(bool)     desktop click-through control
//   platform.moveBy(dx, dy)           desktop: drag the overlay window
//
// Desktop (Electron) exposes window.assistant via electron/preload.js.
// Android (Capacitor) uses Capacitor.Plugins.* globals - no bundler needed.

import { isSafeUrl, APPS } from './core/catalog.js';

const noop = () => {};

function detect() {
  if (window.assistant) return 'desktop';
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'android';
  return 'web';
}

const desktop = () => ({
  name: window.assistant.platform,
  execute: (action) => window.assistant.execute(action),
  onToggleListen: window.assistant.onToggleListen,
  onTypeCommand: window.assistant.onTypeCommand,
  setInteractive: window.assistant.setInteractive,
  moveBy: window.assistant.moveBy,
  nativeSpeech: false,
});

const android = () => {
  const P = () => window.Capacitor.Plugins;
  return {
    name: 'android',
    nativeSpeech: true,
    async execute(action) {
      if (!action) return { ok: true };
      try {
        if (action.kind === 'open-url') {
          if (!isSafeUrl(action.url)) return { ok: false, message: 'Blocked unsafe link.' };
          await P().AppLauncher.openUrl({ url: action.url });
          return { ok: true };
        }
        if (action.kind === 'open-app') {
          const app = APPS[action.appId];
          if (!app) return { ok: false, message: 'Unknown app.' };
          if (app.uri) {
            const url = action.query && app.search ? app.search(action.query) : app.uri;
            await P().AppLauncher.openUrl({ url });
            return { ok: true };
          }
          if (app.android && app.android.package) {
            await P().AppLauncher.openUrl({ url: app.android.package });
            return { ok: true };
          }
          return { ok: false, message: `${app.label} is not available on Android.` };
        }
      } catch (e) {
        return { ok: false, message: String((e && e.message) || e) };
      }
      return { ok: false, message: 'Unsupported action.' };
    },
    onToggleListen: noop,
    onTypeCommand: noop,
    setInteractive: noop,
    moveBy: noop,
  };
};

const web = () => ({
  name: 'web',
  nativeSpeech: false,
  async execute(action) {
    if (!action) return { ok: true };
    let url = null;
    if (action.kind === 'open-url') url = action.url;
    else if (action.kind === 'open-app') {
      const app = APPS[action.appId];
      if (app && app.uri) url = action.query && app.search ? app.search(action.query) : app.uri;
    }
    if (!url || !isSafeUrl(url)) return { ok: false, message: 'Not available in the browser preview.' };
    window.open(url, '_blank', 'noopener');
    return { ok: true };
  },
  onToggleListen: noop,
  onTypeCommand: noop,
  setInteractive: noop,
  moveBy: noop,
});

const kind = detect();
export const platform = kind === 'desktop' ? desktop() : kind === 'android' ? android() : web();
if (kind === 'web') document.body.classList.add('web-preview');
