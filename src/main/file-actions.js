const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { shell } = require('electron');
const { scanZstdFrames } = require('./session-watcher');
const { dshHome } = require('./plugins');
const { revertChanges } = require('../shared/revert');

const rootsCache = { at: 0, roots: [] };

function sessionRoots() {
  if (Date.now() - rootsCache.at < 5 * 60 * 1000) return rootsCache.roots;
  const roots = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (entry.name !== 'session.jsonl.zstd') continue;
      try {
        const data = fs.readFileSync(file);
        const { frames } = scanZstdFrames(data);
        if (!frames.length) continue;
        const first = zlib.zstdDecompressSync(data.subarray(frames[0].start, frames[0].end)).toString('utf8');
        const header = JSON.parse(first.split('\n', 1)[0]);
        if (header?.cwd && path.isAbsolute(header.cwd)) roots.push(path.resolve(header.cwd));
      } catch { /* skip damaged or legacy logs */ }
    }
  };
  walk(path.join(dshHome(), 'sessions'));
  rootsCache.at = Date.now();
  rootsCache.roots = [...new Set(roots)];
  return rootsCache.roots;
}

function isInSessionRoot(file) {
  const resolved = path.resolve(file);
  return sessionRoots().some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

function revertFiles(changes) {
  return revertChanges(changes, sessionRoots());
}

async function openProjectFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !isInSessionRoot(file)) return { ok: false, error: 'path outside session workspace' };
  if (!fs.existsSync(file)) return { ok: false, error: 'file not found' };
  const error = await shell.openPath(file);
  return error ? { ok: false, error } : { ok: true };
}

module.exports = { sessionRoots, isInSessionRoot, revertFiles, openProjectFile };
