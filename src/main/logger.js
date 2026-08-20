const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { redact } = require('../shared/redact');

let stream = null;
let currentPath = '';

function logPath() {
  if (currentPath) return currentPath;
  currentPath = path.join(app.getPath('userData'), 'logs', 'desktop.log');
  return currentPath;
}

function ensureStream() {
  if (stream) return stream;
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  stream.on('error', () => { stream = null; });
  return stream;
}

function write(source, message) {
  const line = `${new Date().toISOString()} [${source || 'app'}] ${redact(message)}\n`;
  try { ensureStream().write(line); } catch { /* logging must never stop the app */ }
  return line.trimEnd();
}

function close() {
  if (stream) stream.end();
  stream = null;
}

module.exports = { write, close, logPath, redact };
