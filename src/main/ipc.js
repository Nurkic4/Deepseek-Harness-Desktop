const { ipcMain, dialog, app, shell, nativeTheme } = require('electron');
const { loadConfig, saveConfig, publicConfig } = require('./config');
const { getMainWindow, openHarnessSettings, openMarketplace } = require('./window');
const { resolveNodeBin, resolveDshBin, sourceHarnessStatus } = require('./dsh');
const { listThemes, resolveTheme } = require('../shared/themes');
const { applyAppTheme } = require('./chrome');
const { listMarketplace } = require('./marketplace-catalog');
const { listInstalledPlugins, installPlugin, uninstallPlugin } = require('./marketplace-install');
const { revertFiles, openProjectFile } = require('./file-actions');
const { exportDiagnostics } = require('./diagnostics');
const { collectEnvironmentDiagnostics } = require('./environment-diagnostics');
const { listWorktrees, createWorktree, removeWorktree } = require('./worktree');
const { listCheckpoints, createCheckpoint, rollbackCheckpoint } = require('./checkpoints');
const { dshHome } = require('./plugins');
const balance = require('./balance');

function configLocale(config = loadConfig()) {
  return config.locale === 'en' ? 'en' : 'zh';
}

function configPayload(config) {
  return {
    ...publicConfig(config),
    apiKey: config.apiKey,
    locale: configLocale(config),
    theme: config.theme || 'midnight',
    themes: listThemes(),
    themeTokens: resolveTheme(config, {
      systemDark: Boolean(nativeTheme && nativeTheme.shouldUseDarkColors),
    }),
    nodeDetected: resolveNodeBin(config),
    dshDetected: (() => {
      const source = sourceHarnessStatus();
      if (source.present) {
        return source.built ? `源码 ${source.root}` : `源码未构建 ${source.root}`;
      }
      return resolveDshBin(config);
    })(),
    appVersion: app.getVersion(),
  };
}

function sendPluginProgress(event, payload) {
  if (event?.sender && !event.sender.isDestroyed()) {
    event.sender.send('shell:plugin-progress', payload);
  }
}

function registerIpc({ dsh, startHarness, browser, workbenchMenu }) {
  ipcMain.handle('shell:get-state', () => dsh.snapshot());

  ipcMain.handle('shell:get-config', () => configPayload(loadConfig()));

  ipcMain.handle('shell:save-config', async (_event, patch) => {
    const next = saveConfig(patch || {});
    app.setLoginItemSettings({ openAtLogin: Boolean(next.openAtLogin) });
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'theme')) {
      applyAppTheme();
    }
    return configPayload(next);
  });

  ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL');
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('shell:pick-workspace', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: configLocale() === 'en' ? 'Choose workspace' : '选择工作区',
      defaultPath: loadConfig().workspace,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('shell:restart', async () => {
    await startHarness();
    return dsh.snapshot();
  });

  ipcMain.handle('shell:open-settings', () => openHarnessSettings());

  ipcMain.handle('shell:list-marketplace', async (_event, options = {}) => {
    const config = loadConfig();
    return listMarketplace({
      token: config.githubToken,
      refresh: Boolean(options && options.refresh),
    });
  });

  ipcMain.handle('shell:refresh-marketplace', async () => {
    const config = loadConfig();
    return listMarketplace({ token: config.githubToken, refresh: true });
  });

  ipcMain.handle('shell:list-installed-plugins', () => listInstalledPlugins());

  ipcMain.handle('shell:install-plugin', async (event, spec, options = {}) => {
    const config = loadConfig();
    const result = await installPlugin(spec, {
      token: config.githubToken,
      allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    if (result.ok && typeof startHarness === 'function') {
      sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
      await startHarness();
    }
    return result;
  });

  ipcMain.handle('shell:uninstall-plugin', async (event, name) => {
    const result = await uninstallPlugin(name, {
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    if (result.ok && typeof startHarness === 'function') {
      sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
      await startHarness();
    }
    return result;
  });

  ipcMain.handle('shell:open-marketplace', () => openMarketplace());

  ipcMain.handle('dsh:file-revert', (_event, payload = {}) => revertFiles(payload.changes));
  ipcMain.handle('dsh:checkpoint-list', (_event, sessionId) => listCheckpoints(sessionId));
  ipcMain.handle('dsh:checkpoint-create', (_event, payload = {}) => createCheckpoint(payload));
  ipcMain.handle('dsh:checkpoint-rollback', (_event, id) => rollbackCheckpoint(String(id || '')));

  ipcMain.handle('dsh:file-open', (_event, payload = {}) => openProjectFile(payload.path));

  ipcMain.handle('dsh:balance-refresh', async (event) => {
    const result = await balance.queryBalance(dshHome());
    const model = balance.readActiveModel(dshHome()) || 'deepseek-chat';
    const configured = loadConfig().balancePrices?.[model] || {};
    result.prices = { ...(result.prices?.[model] || balance.FALLBACK_PRICES), ...configured };
    if (!event.sender.isDestroyed()) event.sender.send('dsh:balance', result);
    return result;
  });

  ipcMain.handle('dsh:browser-command', (event, command, args = {}) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents) {
      throw new Error('Browser command rejected.');
    }
    if (!browser) {
      throw new Error('Embedded browser is unavailable.');
    }
    return browser.command(command, args);
  });

  ipcMain.handle('dsh:workbench-menu-show', (event, payload = {}) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents || !workbenchMenu) {
      throw new Error('Workbench menu rejected.');
    }
    return workbenchMenu.show(payload);
  });

  ipcMain.handle('dsh:workbench-menu-hide', (event) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents || !workbenchMenu) return false;
    workbenchMenu.close();
    return true;
  });

  ipcMain.handle('shell:export-diagnostics', async () => {
    const dir = exportDiagnostics(dsh.snapshot());
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('shell:environment-diagnostics', () => collectEnvironmentDiagnostics());

  ipcMain.handle('dsh:worktree-list', (_event, workspace) => listWorktrees(workspace || loadConfig().workspace));
  ipcMain.handle('dsh:worktree-create', (_event, workspace, name, branch) => createWorktree(workspace || loadConfig().workspace, name, branch));
  ipcMain.handle('dsh:worktree-remove', (_event, workspace, target, force) => removeWorktree(workspace || loadConfig().workspace, target, Boolean(force)));

}

module.exports = { registerIpc };
