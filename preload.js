const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('event', (_e, channel, payload) => {
  for (const cb of listeners.get(channel) || []) { try { cb(payload); } catch (err) { console.error(err); } }
});

contextBridge.exposeInMainWorld('solaris', {
  call: async (name, ...args) => {
    try { return await ipcRenderer.invoke('api', name, args); }
    catch (e) { throw new Error(String(e.message || e).replace(/^Error invoking remote method 'api': (Error: )?/, '')); }
  },
  on: (channel, cb) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(cb);
    return () => listeners.get(channel).delete(cb);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});
