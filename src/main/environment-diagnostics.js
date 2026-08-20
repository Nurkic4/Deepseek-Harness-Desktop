const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveGitBashPath } = require('./git-bash');

function probe(label, command, args = [], options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 8_000, windowsHide: true, ...options });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    id: label,
    status: result.error ? 'error' : result.status === 0 ? 'ok' : 'warning',
    command,
    detail: output.split(/\r?\n/)[0].slice(0, 300),
    code: result.status,
  };
}

function collectEnvironmentDiagnostics() {
  const gitBash = resolveGitBashPath(process.env, fs.existsSync);
  const bundledPnpm = [
    path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness', 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
    path.join(__dirname, '..', '..', 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
  ].find((candidate) => fs.existsSync(candidate));
  const pnpmCommand = bundledPnpm || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  const checks = [
    { id: 'node', status: 'ok', detail: process.version },
    { id: 'git-bash', status: gitBash ? 'ok' : 'error', detail: gitBash || 'Git Bash not found; WSL bash is intentionally not accepted.' },
    { id: 'pwsh', ...probe('pwsh', process.platform === 'win32' ? 'pwsh.exe' : 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']) },
    { id: 'git', ...probe('git', 'git', ['--version']) },
    { id: 'pnpm', ...probe('pnpm', pnpmCommand, ['--version']) },
    { id: 'serena', ...probe('serena', process.platform === 'win32' ? path.join(os.homedir(), '.local', 'bin', 'serena.exe') : 'serena', ['--version']) },
  ];
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    checks,
    summary: {
      ok: checks.filter((check) => check.status === 'ok').length,
      warning: checks.filter((check) => check.status === 'warning').length,
      error: checks.filter((check) => check.status === 'error').length,
    },
  };
}

module.exports = { collectEnvironmentDiagnostics };
