import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aiCodingSsh', {
  proxyStatus: () => ipcRenderer.invoke('proxy:status'),
  proxyConfigure: (opts) => ipcRenderer.invoke('proxy:configure', opts),

  encryptionAvailable: () => ipcRenderer.invoke('crypto:encryptionAvailable'),

  listServers: () => ipcRenderer.invoke('servers:list'),
  saveServer: (payload) => ipcRenderer.invoke('servers:save', payload),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),

  connectTunnel: (payload) => ipcRenderer.invoke('tunnel:connect', payload),
  disconnectTunnel: (serverId) => ipcRenderer.invoke('tunnel:disconnect', serverId),
  listTunnels: () => ipcRenderer.invoke('tunnel:list'),
  tunnelLogs: (serverId) => ipcRenderer.invoke('tunnel:logs', serverId),

  applyRemoteClaudeSettings: (serverId) =>
    ipcRenderer.invoke('remote:applyClaudeSettings', serverId),
  removeRemoteClaudeSettings: (serverId) =>
    ipcRenderer.invoke('remote:removeClaudeSettings', serverId),

  onTunnelLog: (callback) => {
    const fn = (_e, data) => callback(data);
    ipcRenderer.on('tunnel:log', fn);
    return () => ipcRenderer.removeListener('tunnel:log', fn);
  },

  onTunnelState: (callback) => {
    const fn = (_e, data) => callback(data);
    ipcRenderer.on('tunnel:state', fn);
    return () => ipcRenderer.removeListener('tunnel:state', fn);
  },
});
