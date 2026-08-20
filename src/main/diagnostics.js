const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { logPath, redact } = require('./logger');
const { publicConfig, loadConfig } = require('./config');

function safeCopy(source, destination) {
  try {
    if (fs.existsSync(source)) fs.copyFileSync(source, destination);
  } catch { /* best-effort diagnostic artifact */ }
}

function exportDiagnostics(snapshot = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(app.getPath('documents'), 'Deepseek-Harness-Desktop-Diagnostics', stamp);
  fs.mkdirSync(dir, { recursive: true });
  safeCopy(logPath(), path.join(dir, 'desktop.log'));
  const report = {
    generatedAt: new Date().toISOString(),
    app: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
    system: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, electron: process.versions.electron },
    config: publicConfig(loadConfig()),
    runtime: snapshot,
  };
  fs.writeFileSync(path.join(dir, 'report.json'), redact(JSON.stringify(report, null, 2)), 'utf8');
  fs.writeFileSync(path.join(dir, 'README.txt'), 'This diagnostic export redacts known API keys. Review files before sharing.\n', 'utf8');
  return dir;
}

module.exports = { exportDiagnostics };
