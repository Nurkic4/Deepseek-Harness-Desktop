const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function portableRoot() {
  const explicit = process.env.DSH_DESKTOP_PORTABLE_DIR;
  if (explicit) return path.resolve(explicit);
  const packaged = process.env.PORTABLE_EXECUTABLE_DIR;
  if (packaged) return path.join(path.resolve(packaged), 'Deepseek-Harness-Desktop-Data');
  const index = process.argv.indexOf('--portable');
  if (index !== -1) return path.join(path.dirname(process.execPath), 'Deepseek-Harness-Desktop-Data');
  return '';
}

function configurePortableMode() {
  const root = portableRoot();
  if (!root) return { enabled: false, root: '' };
  fs.mkdirSync(root, { recursive: true });
  app.setPath('userData', root);

  // Portable builds used to create a second empty DSH data tree beside the
  // executable. Preserve the user's existing sessions/configuration when the
  // portable tree has no sessions yet; once it contains sessions, keep using
  // it as the explicit portable profile.
  const portableDsh = path.join(root, 'dsh');
  const portableSessions = path.join(portableDsh, 'sessions');
  const defaultDsh = path.join(require('os').homedir(), '.dsh');
  const defaultSessions = path.join(defaultDsh, 'sessions');
  const hasPortableSessions = fs.existsSync(portableSessions)
    && fs.readdirSync(portableSessions, { withFileTypes: true }).length > 0;
  const hasDefaultSessions = fs.existsSync(defaultSessions)
    && fs.readdirSync(defaultSessions, { withFileTypes: true }).length > 0;
  const dshHome = !hasPortableSessions && hasDefaultSessions ? defaultDsh : portableDsh;
  return { enabled: true, root, dshHome };
}

module.exports = { portableRoot, configurePortableMode };
