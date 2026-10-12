'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, value) => ipcRenderer.sendSync('tinyfrens:sync', name, value);
contextBridge.exposeInMainWorld('TinyFrensDesktop', {
  getTurtle: () => call('turtle'), clearTurtle: () => call('clear-turtle'),
  turtleRequest: (server, path, body) => ipcRenderer.invoke('tinyfrens:turtle-request', server, path, body),
  onTurtle: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:turtle', handler); return () => ipcRenderer.removeListener('tinyfrens:turtle', handler); },
  onCompanionMotion: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:companion-motion', handler); return () => ipcRenderer.removeListener('tinyfrens:companion-motion', handler); },
  getState: () => call('state'), action: name => call('action', name), rename: name => call('rename', name),
  customize: data => call('customize', data), setMode: mode => call('mode', mode),
  isPetVisible: () => call('visible'), togglePet: () => call('toggle'), hidePet: () => call('hide'), openApp: () => call('open'),
  menu: open => call('menu', open), drag: active => call('drag', active),
  motion: reduced => call('motion', reduced),
  regions: regions => ipcRenderer.send('tinyfrens:regions', regions),
  checkUpdate: () => ipcRenderer.invoke('tinyfrens:check-update'), openUpdate: () => call('update'), installUpdate: () => ipcRenderer.invoke('tinyfrens:install-update'),
  onUpdate: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:update', handler); return () => ipcRenderer.removeListener('tinyfrens:update', handler); },
  onState: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:state', handler); return () => ipcRenderer.removeListener('tinyfrens:state', handler); },
  onAnimation: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:animation', handler); return () => ipcRenderer.removeListener('tinyfrens:animation', handler); }
});
