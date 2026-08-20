const { app, dialog, globalShortcut, session, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config');
const { DshManager, ensureOwnedPort } = require('./dsh');
const { stripDroppedPlugins, syncCompanionPlugins, dshHome } = require('./plugins');
const { configurePortableMode } = require('./portable');
const { SessionWatcher } = require('./session-watcher');
const { exportDiagnostics } = require('./diagnostics');
const persistentLog = require('./logger');
const { ensureWorkspace } = require('./workspace-rpc');
const { registerIpc } = require('./ipc');
const { EmbeddedBrowser } = require('./browser');
const { WorkbenchMenu } = require('./workbench-menu');
const { buildMenu } = require('./menu');
const { createTray, showMain } = require('./tray');
const {
  createMainWindow,
  getMainWindow,
  showBoot,
  showHarness,
  sendToBoot,
} = require('./window');

const portable = configurePortableMode();
if (portable.enabled) process.env.DSH_HOME = portable.dshHome || path.join(portable.root, 'dsh');
const dsh = new DshManager();
let quitting = false;
let starting = null;
let stoppingForQuit = false;
let sessionWatcher = null;
let embeddedBrowser = null;
let workbenchMenu = null;

dsh.on('state', (snapshot) => sendToBoot('shell:state', snapshot));
dsh.on('log', (line) => sendToBoot('shell:log', line));

async function resolveLaunchTarget() {
  const config = loadConfig();
  const host = config.host || '127.0.0.1';
  const wanted = Number(config.port) || 3080;
  dsh.log(`检测端口 ${host}:${wanted}`);
  const port = await ensureOwnedPort(host, wanted, (line) => dsh.log(line));
  return { port };
}

async function pickWorkspace() {
  const win = getMainWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '选择工作区',
    defaultPath: loadConfig().workspace,
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  saveConfig({ workspace: result.filePaths[0] });
  await restartHarness();
  return result.filePaths[0];
}

async function startHarness() {
  if (starting) {
    return starting;
  }
  starting = (async () => {
    const win = createMainWindow();
    await showBoot();
    dsh.setState('starting');
    try {
      const target = await resolveLaunchTarget();
      try {
        stripDroppedPlugins();
        const synced = syncCompanionPlugins();
        if (synced.changed) dsh.log(`已同步配套插件：${synced.plugins.join(', ')}`);
      } catch (error) {
        dsh.log(`插件清理失败：${error.message}`, 'app');
      }
      const url = await dsh.start(target);
      const { workspace } = loadConfig();
      try {
        await ensureWorkspace(url, workspace);
        dsh.log(`已注册工作区 ${workspace}`);
      } catch (error) {
        dsh.log(`工作区自动注册跳过：${error.message}`, 'app');
      }
      await showHarness(url);
      if (loadConfig().openDevTools) {
        win.webContents.openDevTools({ mode: 'detach' });
      }
      return url;
    } catch (error) {
      dsh.setState('error', { error: error.message });
      dsh.log(error.message, 'error');
      throw error;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

async function restartHarness() {
  await dsh.stop();
  return startHarness();
}

function reloadUi() {
  const win = getMainWindow();
  if (!win) {
    return;
  }
  if (dsh.state === 'ready' && dsh.baseUrl) {
    win.loadURL(dsh.baseUrl);
    return;
  }
  startHarness().catch(() => {});
}

function quitApp() {
  quitting = true;
  app.quit();
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  const notice = new Notification({ title, body, silent: false });
  notice.on('click', () => showMain());
  notice.show();
}

function startSessionNotifications() {
  sessionWatcher?.stop();
  sessionWatcher = new SessionWatcher({
    sessionsDir: path.join(dshHome(), 'sessions'),
    log: (_source, message) => dsh.log(message, 'watch'),
    onTurnEnd: ({ title, body }) => {
      if (loadConfig().notifyOnTurnEnd) showNotification(title || 'DSH 任务完成', body || '任务已经完成');
    },
  });
  sessionWatcher.start();
}

function exportDiagnosticsInteractive() {
  const dir = exportDiagnostics(dsh.snapshot());
  shell.openPath(dir);
  return dir;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMain();
  });

  app.setName('Deepseek-Harness-Desktop');
  app.setAppUserModelId('ai.deepseek.harness.gui');

  app.whenReady().then(async () => {
    const config = loadConfig();
    fs.mkdirSync(config.workspace, { recursive: true });
    saveConfig({ workspace: config.workspace });
    app.setLoginItemSettings({ openAtLogin: Boolean(config.openAtLogin) });

    embeddedBrowser = new EmbeddedBrowser({
      getMainWindow,
      log: (line) => dsh.log(line, 'browser'),
    });
    await embeddedBrowser.start();
    workbenchMenu = new WorkbenchMenu({ getMainWindow });
    registerIpc({ dsh, startHarness: restartHarness, browser: embeddedBrowser, workbenchMenu });
    buildMenu({
      onOpenWorkspace: () => pickWorkspace(),
      onRestart: () => restartHarness(),
      onReload: () => reloadUi(),
      onExportDiagnostics: () => exportDiagnosticsInteractive(),
    });
    createTray({
      onRestart: () => restartHarness(),
      onExportDiagnostics: () => exportDiagnosticsInteractive(),
      onQuit: () => quitApp(),
    });
    startSessionNotifications();
    const win = createMainWindow();
    win.on('close', (event) => {
      if (!quitting && loadConfig().closeToTray) {
        event.preventDefault();
        win.hide();
      }
    });

    session.defaultSession.on('will-download', (event, item) => {
      const fileName = item.getFilename();
      const dest = path.join(app.getPath('downloads'), fileName);
      item.setSavePath(dest);
    });

    globalShortcut.register('CommandOrControl+Shift+I', () => {
      getMainWindow()?.webContents.toggleDevTools();
    });

    try {
      await startHarness();
    } catch {
      // boot page already shows the error
    }
  });

  app.on('activate', () => {
    const win = getMainWindow();
    if (win) {
      win.show();
    } else {
      startHarness().catch(() => {});
    }
  });

  app.on('before-quit', (event) => {
    quitting = true;
    globalShortcut.unregisterAll();
    sessionWatcher?.stop();
    embeddedBrowser?.dispose();
    embeddedBrowser = null;
    workbenchMenu?.dispose();
    workbenchMenu = null;
    persistentLog.close();
    if (stoppingForQuit) {
      return;
    }
    event.preventDefault();
    stoppingForQuit = true;
    dsh.stop().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !loadConfig().closeToTray) {
      quitApp();
    }
  });
}
