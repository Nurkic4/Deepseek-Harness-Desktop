const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function assertWorkspace(workspace) {
  const root = path.resolve(String(workspace || ''));
  if (!root || !fs.existsSync(path.join(root, '.git'))) throw new Error('工作区不是 Git 仓库');
  return root;
}

function listWorktrees(workspace) {
  const root = assertWorkspace(workspace);
  const lines = git(root, ['worktree', 'list', '--porcelain']).split(/\r?\n/);
  const result = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current) result.push(current);
      current = { path: line.slice(9), branch: '', bare: false };
    } else if (current && line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (current && line === 'bare') current.bare = true;
  }
  if (current) result.push(current);
  return result;
}

function createWorktree(workspace, name, branch) {
  const root = assertWorkspace(workspace);
  const safeName = String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  const safeBranch = String(branch || safeName).trim().replace(/[^a-zA-Z0-9._/-]+/g, '-');
  if (!safeName || !safeBranch) throw new Error('Worktree 名称不能为空');
  const parent = path.join(root, '.dsh-worktrees');
  const target = path.resolve(parent, safeName);
  if (!target.startsWith(`${path.resolve(parent)}${path.sep}`)) throw new Error('Worktree 路径越界');
  fs.mkdirSync(parent, { recursive: true });
  git(root, ['worktree', 'add', '-b', safeBranch, target]);
  return { path: target, branch: safeBranch };
}

function removeWorktree(workspace, target, force = false) {
  const root = assertWorkspace(workspace);
  const absolute = path.resolve(String(target || ''));
  const parent = path.resolve(path.join(root, '.dsh-worktrees'));
  if (!absolute.startsWith(`${parent}${path.sep}`)) throw new Error('只能删除 DSH 创建的 Worktree');
  git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), absolute]);
  return { removed: absolute };
}

module.exports = { listWorktrees, createWorktree, removeWorktree };
