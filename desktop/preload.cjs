'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, value) => ipcRenderer.sendSync('tinyfrens:sync', name, value);
contextBridge.exposeInMainWorld('TinyFrensDesktop', {
  getState: () => call('state'), action: name => call('action', name), rename: name => call('rename', name),
  customize: data => call('customize', data), setMode: mode => call('mode', mode),
  isPetVisible: () => call('visible'), togglePet: () => call('toggle'), hidePet: () => call('hide'), openApp: () => call('open'),
  menu: open => call('menu', open), drag: active => call('drag', active),
  motion: reduced => call('motion', reduced),
  regions: regions => ipcRenderer.send('tinyfrens:regions', regions),
  checkUpdate: () => ipcRenderer.invoke('tinyfrens:check-update'), openUpdate: () => call('update'),
  onState: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:state', handler); return () => ipcRenderer.removeListener('tinyfrens:state', handler); },
  onAnimation: listener => { const handler = (_, data) => listener(data); ipcRenderer.on('tinyfrens:animation', handler); return () => ipcRenderer.removeListener('tinyfrens:animation', handler); }
});
