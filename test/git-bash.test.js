const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gitBashCandidates,
  resolveGitBashPath,
  withWindowsSystemPath,
} = require('../src/main/git-bash');

test('Git Bash resolution prefers an explicit configured path', () => {
  const env = {
    DSH_GIT_BASH_PATH: 'D:\\PortableGit\\bin\\bash.exe',
    ProgramFiles: 'C:\\Program Files',
  };
  assert.equal(resolveGitBashPath(env, (candidate) => candidate.startsWith('D:')), env.DSH_GIT_BASH_PATH);
});

test('Git Bash resolution checks standard Git for Windows locations', () => {
  const candidates = gitBashCandidates({
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
  });
  assert.deepEqual(candidates, [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Users\\test\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
  ]);
});

test('Windows PATH normalization preserves Path and restores system commands', () => {
  const env = withWindowsSystemPath({
    Path: 'D:\\Tools;C:\\Windows\\System32',
    PATH: 'C:\\Node',
    SystemRoot: 'C:\\Windows',
  }, ['C:\\Desktop\\bin'], 'win32');

  assert.deepEqual(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH'), ['PATH']);
  assert.deepEqual(env.PATH.split(';').slice(0, 4), [
    'C:\\Desktop\\bin',
    'C:\\Windows\\System32',
    'C:\\Windows',
    'C:\\Windows\\System32\\Wbem',
  ]);
  assert.match(env.PATH, /D:\\Tools/);
  assert.match(env.PATH, /C:\\Node/);
});
