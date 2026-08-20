const fs = require('fs');
const path = require('path');
const { dshHome } = require('./plugins');
const { revertFiles } = require('./file-actions');

function checkpointFile() { return path.join(dshHome(), 'checkpoints.json'); }
function readAll() {
  try {
    const value = JSON.parse(fs.readFileSync(checkpointFile(), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function writeAll(value) {
  const file = checkpointFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value.slice(-100), null, 2), 'utf8');
  fs.renameSync(temp, file);
}
function listCheckpoints(sessionId) {
  return readAll().filter((item) => !sessionId || item.sessionId === sessionId);
}
function createCheckpoint({ sessionId, label, changes }) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('检查点没有可保存的文件修改');
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: String(sessionId || ''),
    label: String(label || '本轮修改').slice(0, 120),
    createdAt: new Date().toISOString(),
    changes: changes.slice(0, 300),
  };
  writeAll([...readAll(), item]);
  return item;
}
function rollbackCheckpoint(id) {
  const all = readAll();
  const item = all.find((candidate) => candidate.id === id);
  if (!item) throw new Error('检查点不存在或已被清理');
  const result = revertFiles(item.changes);
  return { checkpoint: item, ...result };
}
module.exports = { listCheckpoints, createCheckpoint, rollbackCheckpoint };
