const fs = require('fs');
const path = require('path');

function envValue(env, name) {
  const entry = Object.entries(env).find(([key, value]) => (
    key.toUpperCase() === name.toUpperCase() && typeof value === 'string' && value
  ));
  return entry?.[1] || '';
}

function windowsSystemPathEntries(env = process.env) {
  const root = envValue(env, 'SystemRoot') || envValue(env, 'windir') || 'C:\\Windows';
  return [
    path.join(root, 'System32'),
    root,
    path.join(root, 'System32', 'Wbem'),
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
    path.join(root, 'System32', 'OpenSSH'),
  ];
}

function withWindowsSystemPath(source = process.env, prepend = [], platform = process.platform) {
  const env = { ...source };
  if (platform !== 'win32') return env;
  const inherited = Object.entries(env)
    .filter(([key]) => key.toUpperCase() === 'PATH')
    .flatMap(([, value]) => String(value || '').split(path.delimiter));
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') delete env[key];
  }
  const seen = new Set();
  const entries = [...prepend, ...windowsSystemPathEntries(env), ...inherited]
    .map((entry) => String(entry || '').trim().replace(/^"|"$/g, ''))
    .filter((entry) => {
      if (!entry) return false;
      const key = path.normalize(entry).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  env.PATH = entries.join(path.delimiter);
  return env;
}

function gitBashCandidates(env = process.env) {
  return [
    env.DSH_GIT_BASH_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
}

function resolveGitBashPath(env = process.env, exists = fs.existsSync) {
  return gitBashCandidates(env).find((candidate) => exists(candidate)) || null;
}

module.exports = {
  gitBashCandidates,
  resolveGitBashPath,
  windowsSystemPathEntries,
  withWindowsSystemPath,
};
