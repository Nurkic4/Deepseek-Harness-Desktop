const fs = require('fs');
const path = require('path');

function isWithin(file, roots) {
  if (!path.isAbsolute(file)) return false;
  const resolved = path.resolve(file);
  return roots.some((root) => resolved === path.resolve(root) || resolved.startsWith(`${path.resolve(root)}${path.sep}`));
}

function revertChanges(changes, roots) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 300) return { results: [] };
  const results = [];
  for (const change of changes) {
    const file = String(change?.path || '');
    const oldText = String(change?.oldText ?? '');
    const newText = String(change?.newText ?? '');
    if (!isWithin(file, roots) || oldText.length > 400000 || newText.length > 400000) {
      results.push({ path: file, status: 'forbidden' });
      continue;
    }
    try {
      const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (oldText === '' && newText !== '') {
        if (content === newText) { fs.rmSync(file); results.push({ path: file, status: 'reverted' }); }
        else results.push({ path: file, status: content === null ? 'missing' : 'conflict' });
      } else if (newText === '' && oldText !== '') {
        if (content === null) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, oldText, 'utf8'); results.push({ path: file, status: 'reverted' }); }
        else results.push({ path: file, status: 'conflict' });
      } else if (content !== null && content.includes(newText)) {
        fs.writeFileSync(file, content.replace(newText, oldText), 'utf8');
        results.push({ path: file, status: 'reverted' });
      } else {
        results.push({ path: file, status: content === oldText ? 'skipped' : content === null ? 'missing' : 'conflict' });
      }
    } catch (error) {
      results.push({ path: file, status: 'failed', error: error.message || String(error) });
    }
  }
  return { results };
}

module.exports = { isWithin, revertChanges };
