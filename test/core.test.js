const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { redact } = require('../src/shared/redact');
const { isWithin, revertChanges } = require('../src/shared/revert');
const { scanZstdFrames, SessionWatcher } = require('../src/main/session-watcher');

test('diagnostic redaction hides common API key forms', () => {
  const output = redact('apiKey=abc123 secret: xyz987 Authorization=BearerToken sk-abcdefghijklmnopqrstuvwxyz');
  assert.equal(output.includes('abc123'), false);
  assert.equal(output.includes('xyz987'), false);
  assert.equal(output.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
});

test('file reversion is confined to an approved workspace and detects conflicts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-revert-'));
  const file = path.join(root, 'note.txt');
  fs.writeFileSync(file, 'after', 'utf8');
  assert.equal(isWithin(file, [root]), true);
  assert.equal(revertChanges([{ path: file, oldText: 'before', newText: 'after' }], [root]).results[0].status, 'reverted');
  assert.equal(fs.readFileSync(file, 'utf8'), 'before');
  assert.equal(revertChanges([{ path: path.join(root, '..', 'outside.txt'), oldText: '', newText: 'x' }], [root]).results[0].status, 'forbidden');
  fs.rmSync(root, { recursive: true, force: true });
});

test('session watcher only emits for live top-level turn completions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-watch-'));
  const dir = path.join(root, 'session-one');
  const file = path.join(dir, 'session.jsonl.zstd');
  fs.mkdirSync(dir, { recursive: true });
  const frame = (rows) => zlib.zstdCompressSync(Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`));
  fs.writeFileSync(file, frame([{ type: 'session', id: 'session-one', cwd: root, delegationDepth: 0 }, { type: 'turn/end' }]));
  assert.equal(scanZstdFrames(fs.readFileSync(file)).frames.length, 1);
  const notices = [];
  const watcher = new SessionWatcher({ sessionsDir: root, onTurnEnd: (notice) => notices.push(notice) });
  watcher.scan();
  assert.equal(notices.length, 0);
  fs.appendFileSync(file, frame([{ type: 'turn/start' }, { type: 'turn/end' }]));
  watcher.scan();
  assert.equal(notices.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
