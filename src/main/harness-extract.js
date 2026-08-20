const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function looseHarnessRoot() {
  return path.join(process.resourcesPath, 'vendor', 'deepseek-harness');
}

function harnessArchivePath() {
  return path.join(process.resourcesPath, 'vendor', 'deepseek-harness.tar');
}

function extractedHarnessRoot() {
  return path.join(app.getPath('userData'), 'runtime', app.getVersion());
}

function hasBuiltHarness(root) {
  const required = [
    ['apps', 'cli', 'lib', 'bin.js'],
    ['apps', 'web', 'dist', 'index.html'],
    ['node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'],
    ['node_modules', '@deepseek-ai', 'cordis-plugin-group', 'package.json'],
  ];
  return required.every((parts) => fs.existsSync(path.join(root, ...parts)));
}

function runtimeStampPath(root) {
  return path.join(root, '.desktop-runtime.json');
}

function archiveIdentity(archive) {
  return { archiveSize: fs.statSync(archive).size };
}

function isExtractedHarnessCurrent(root, archive) {
  if (!hasBuiltHarness(root) || !fs.existsSync(archive)) {
    return false;
  }
  try {
    const stamp = JSON.parse(fs.readFileSync(runtimeStampPath(root), 'utf8'));
    return stamp.archiveSize === archiveIdentity(archive).archiveSize;
  } catch {
    return false;
  }
}

function packagedHarnessRoot() {
  const extracted = extractedHarnessRoot();
  if (isExtractedHarnessCurrent(extracted, harnessArchivePath())) {
    return extracted;
  }
  const loose = looseHarnessRoot();
  if (hasBuiltHarness(loose)) {
    return loose;
  }
  return extracted;
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `tar 退出码 ${code}`));
    });
  });
}

async function ensurePackagedHarness(log = () => {}) {
  if (!app.isPackaged) {
    return null;
  }
  const dest = extractedHarnessRoot();
  const archive = harnessArchivePath();
  if (isExtractedHarnessCurrent(dest, archive)) {
    return dest;
  }
  const loose = looseHarnessRoot();
  if (hasBuiltHarness(loose)) {
    return loose;
  }
  if (!fs.existsSync(archive)) {
    throw new Error('安装包缺少运行时归档 deepseek-harness.tar');
  }
  log('正在解压运行时（仅首次，之后会变快）…');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  await runTar(['-xf', archive, '-C', dest]);
  if (!hasBuiltHarness(dest)) {
    throw new Error('运行时解压不完整，请重新安装');
  }
  fs.writeFileSync(runtimeStampPath(dest), JSON.stringify(archiveIdentity(archive)));
  log(`运行时已解压到 ${dest}`);
  return dest;
}

module.exports = {
  harnessArchivePath,
  extractedHarnessRoot,
  packagedHarnessRoot,
  ensurePackagedHarness,
  hasBuiltHarness,
};
