'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const PLATFORM = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

contextBridge.exposeInMainWorld('assistant', {
  platform: PLATFORM,
  execute: (action) => ipcRenderer.invoke('execute', action),
  setInteractive: (v) => ipcRenderer.send('set-interactive', Boolean(v)),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', Number(dx), Number(dy)),
  llm: {
    getSettings: () => ipcRenderer.invoke('llm:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('llm:save-settings', settings),
    chat: (history, text) => ipcRenderer.invoke('llm:chat', { history, text }),
  },
  onToggleListen: (cb) => ipcRenderer.on('toggle-listen', () => cb()),
  onTypeCommand: (cb) => ipcRenderer.on('type-command', () => cb()),
});
