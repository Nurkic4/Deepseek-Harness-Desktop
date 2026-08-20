const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const directories = ['test', 'src/main', 'src/shared'];
const files = directories.flatMap((directory) => {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(absolute, name));
});
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
