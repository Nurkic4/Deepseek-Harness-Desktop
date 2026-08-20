const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  getState: () => ipcRenderer.invoke('shell:get-state'),
  getConfig: () => ipcRenderer.invoke('shell:get-config'),
  saveConfig: (patch) => ipcRenderer.invoke('shell:save-config', patch),
  pickWorkspace: () => ipcRenderer.invoke('shell:pick-workspace'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  restart: () => ipcRenderer.invoke('shell:restart'),
  openSettings: () => ipcRenderer.invoke('shell:open-settings'),
  reportChrome: (metrics) => ipcRenderer.send('shell:chrome-metrics', metrics),
  windowAction: (action) => ipcRenderer.send('shell:window', action),
  getWindowState: () => ipcRenderer.invoke('shell:window-state'),
  onWindowState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('shell:window-state', listener);
    return () => ipcRenderer.removeListener('shell:window-state', listener);
  },
  onTheme: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('shell:theme', listener);
    return () => ipcRenderer.removeListener('shell:theme', listener);
  },
  onState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('shell:state', listener);
    return () => ipcRenderer.removeListener('shell:state', listener);
  },
  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('shell:log', listener);
    return () => ipcRenderer.removeListener('shell:log', listener);
  },
  listMarketplace: (options) => ipcRenderer.invoke('shell:list-marketplace', options),
  refreshMarketplace: () => ipcRenderer.invoke('shell:refresh-marketplace'),
  listInstalledPlugins: () => ipcRenderer.invoke('shell:list-installed-plugins'),
  installPlugin: (spec, options) => ipcRenderer.invoke('shell:install-plugin', spec, options),
  uninstallPlugin: (name) => ipcRenderer.invoke('shell:uninstall-plugin', name),
  openMarketplace: () => ipcRenderer.invoke('shell:open-marketplace'),
  exportDiagnostics: () => ipcRenderer.invoke('shell:export-diagnostics'),
  environmentDiagnostics: () => ipcRenderer.invoke('shell:environment-diagnostics'),
  onPluginProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('shell:plugin-progress', listener);
    return () => ipcRenderer.removeListener('shell:plugin-progress', listener);
  },
});

contextBridge.exposeInMainWorld('dshDesktop', {
  refreshBalance: () => ipcRenderer.invoke('dsh:balance-refresh'),
  revertFiles: (changes) => ipcRenderer.invoke('dsh:file-revert', { changes }),
  listCheckpoints: (sessionId) => ipcRenderer.invoke('dsh:checkpoint-list', sessionId),
  createCheckpoint: (payload) => ipcRenderer.invoke('dsh:checkpoint-create', payload),
  rollbackCheckpoint: (id) => ipcRenderer.invoke('dsh:checkpoint-rollback', id),
  openPath: (path) => ipcRenderer.invoke('dsh:file-open', { path }),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  restartService: () => ipcRenderer.invoke('shell:restart'),
  browserCommand: (command, args) => ipcRenderer.invoke('dsh:browser-command', command, args),
  listWorktrees: (workspace) => ipcRenderer.invoke('dsh:worktree-list', workspace),
  createWorktree: (workspace, name, branch) => ipcRenderer.invoke('dsh:worktree-create', workspace, name, branch),
  removeWorktree: (workspace, target, force) => ipcRenderer.invoke('dsh:worktree-remove', workspace, target, force),
  showWorkbenchMenu: (payload) => ipcRenderer.invoke('dsh:workbench-menu-show', payload),
  hideWorkbenchMenu: () => ipcRenderer.invoke('dsh:workbench-menu-hide'),
  onBrowserState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('dsh:browser-state', listener);
    return () => ipcRenderer.removeListener('dsh:browser-state', listener);
  },
  onBrowserFocusAddress: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('dsh:browser-focus-address', listener);
    return () => ipcRenderer.removeListener('dsh:browser-focus-address', listener);
  },
  onBrowserFocusFind: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('dsh:browser-focus-find', listener);
    return () => ipcRenderer.removeListener('dsh:browser-focus-find', listener);
  },
});

ipcRenderer.on('dsh:balance', (_event, data) => {
  window.dispatchEvent(new CustomEvent('dsh-balance-changed', { detail: data }));
});
