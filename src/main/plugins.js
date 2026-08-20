const fs = require('fs');
const os = require('os');
const path = require('path');

const PROFILE = 'web';
const DROPPED = [
  '@dsh-external/dsh-genui',
  '@huanlin/dsh-plugin-yet-another-subagent',
];
const PATCH_BEGIN = '# --- dsh-gui-plugin-toggles ---';
const PATCH_END = '# --- end dsh-gui-plugin-toggles ---';
const COMPANION_BEGIN = '# --- dsh-desktop-companions ---';
const COMPANION_END = '# --- end dsh-desktop-companions ---';
const COMPANION_PLUGINS = [
  { id: 'balance', name: '@deepseek-ai/dsh-balance' },
  { id: 'file-changes', name: '@deepseek-ai/dsh-file-changes' },
  { id: 'client-file-changes', name: '@deepseek-ai/dsh-client-file-changes' },
  { id: 'git-bash', name: '@deepseek-ai/dsh-git-bash' },
  { id: 'terminal', name: '@deepseek-ai/dsh-terminal' },
  { id: 'browser', name: '@deepseek-ai/dsh-browser' },
];
const COMPANION_MCPS = [
  {
    id: 'mcp-context7',
    serverName: 'context7',
    command: 'cmd.exe',
    args: ['/c', 'npx', '-y', '@upstash/context7-mcp'],
  },
  {
    id: 'mcp-memory',
    serverName: 'memory',
    command: 'cmd.exe',
    args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'mcp-serena',
    serverName: 'serena',
    command: process.platform === 'win32'
      ? path.join(os.homedir(), '.local', 'bin', 'serena.exe')
      : 'serena',
    args: ['start-mcp-server', '--context', 'desktop-app', '--project-from-cwd', '--open-web-dashboard', 'false'],
  },
  {
    id: 'mcp-figma-bridge',
    serverName: 'figma_bridge',
    command: 'cmd.exe',
    args: ['/c', 'npx', '-y', '@gethopp/figma-mcp-bridge'],
  },
];

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return path.join(os.homedir(), '.dsh');
}

function webProfileDir() {
  return path.join(dshHome(), 'profiles', PROFILE);
}

function manifestPath() {
  return path.join(webProfileDir(), 'package.json');
}

function patchPath() {
  return path.join(webProfileDir(), 'cordis.patch.yml');
}

function bundledSkillDir() {
  return path.join(dshHome(), 'bundled-skills', 'skills');
}

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function stripManagedPatch() {
  const file = patchPath();
  if (!fs.existsSync(file)) {
    return false;
  }
  const text = fs.readFileSync(file, 'utf8');
  const begin = text.indexOf(PATCH_BEGIN);
  const end = text.indexOf(PATCH_END);
  if (begin === -1 || end === -1 || end < begin) {
    return false;
  }
  const next = `${text.slice(0, begin)}${text.slice(end + PATCH_END.length)}`.replace(/\n{3,}/g, '\n\n');
  if (next === text) {
    return false;
  }
  writeAtomic(file, next);
  return true;
}

/** Drop retired community plugins from the live web profile so they cannot boot. */
function stripDroppedPlugins() {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'missing-profile' };
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  if (manifest.dependencies) {
    for (const name of DROPPED) {
      if (Object.prototype.hasOwnProperty.call(manifest.dependencies, name)) {
        delete manifest.dependencies[name];
        changed = true;
      }
    }
  }
  const current = manifest.dsh?.profile?.bundles;
  if (Array.isArray(current)) {
    const bundles = current.filter((name) => !DROPPED.includes(name));
    if (bundles.length !== current.length) {
      manifest.dsh = {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh.profile,
          bundles,
        },
      };
      changed = true;
    }
  }
  if (changed) {
    writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const patchChanged = stripManagedPatch();
  return { ok: true, changed, patchChanged };
}

function mergeCompanionPatch(source) {
  const original = String(source || '');
  const managedIds = [...COMPANION_PLUGINS, ...COMPANION_MCPS].map(({ id }) => id);
  const managedPattern = new RegExp(
    `^${COMPANION_BEGIN.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}[\\s\\S]*?^${COMPANION_END.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*`,
    'gm',
  );

  // Remove both the current managed section and legacy unmarked copies. The
  // remaining top-level patch entries belong to the user and are preserved.
  const withoutManagedSection = original.replace(managedPattern, '');
  const lines = withoutManagedSection.split(/\r?\n/);
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if (/^-\s+/.test(line) && current.length > 0) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(current);

  const unmanaged = chunks
    .filter((chunk) => {
      const text = chunk.join('\n');
      return !managedIds.some((id) => new RegExp(`^\\s*- id:\\s*${id}\\s*$`, 'm').test(text));
    })
    .flat()
    .filter((line) => !/^\s*\[\]\s*(?:#.*)?$/.test(line))
    .join('\n')
    .trimEnd();

  const blocks = COMPANION_PLUGINS.map((plugin) => [
    '- insert:',
    `    - id: ${plugin.id}`,
    `      name: '${plugin.name.replaceAll("'", "''")}'`,
  ].join('\n'));

  for (const mcp of COMPANION_MCPS) {
    const command = `'${mcp.command.replaceAll("'", "''")}'`;
    const args = `[${mcp.args.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')}]`;
    blocks.push([
      '- insert:',
      `    - id: ${mcp.id}`,
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        transport: stdio',
      `        serverName: ${mcp.serverName}`,
      `        command: ${command}`,
      `        args: ${args}`,
      '        env: {}',
      "        cwd: ''",
      '        toolCallTimeoutMs: 120000',
      '        failOnStartupError: false',
      '        reconnect:',
      '          enabled: true',
      '          initialDelayMs: 1000',
      '          maxDelayMs: 30000',
      '          maxAttempts: 5',
    ].join('\n'));
  }

  const managed = `${COMPANION_BEGIN}\n${blocks.join('\n')}\n${COMPANION_END}`;
  const patch = `${unmanaged ? `${unmanaged}\n` : ''}${managed}\n`;
  return { patch, changed: patch !== original };
}

function syncBundledSkills() {
  const source = path.join(__dirname, '..', '..', 'assets', 'bundled-skills');
  const destination = path.join(dshHome(), 'bundled-skills');
  if (!fs.existsSync(path.join(source, 'skills'))) {
    return { ok: false, reason: 'missing-source', path: bundledSkillDir() };
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
  return { ok: true, path: bundledSkillDir() };
}

function syncCompanionPlugins() {
  const profileDir = webProfileDir();
  const scopeDir = path.join(profileDir, 'node_modules', '@deepseek-ai');
  const bundledDir = path.join(__dirname, '..', '..', 'assets', 'plugins');
  fs.mkdirSync(scopeDir, { recursive: true });
  for (const plugin of COMPANION_PLUGINS) {
    const shortName = plugin.name.slice('@deepseek-ai/'.length);
    const source = path.join(bundledDir, shortName);
    const destination = path.join(scopeDir, shortName);
    if (!fs.existsSync(path.join(source, 'package.json'))) continue;
    fs.mkdirSync(path.join(destination, 'lib'), { recursive: true });
    for (const relative of [
      'package.json',
      'lib/index.js',
      'lib/client.js',
      'lib/xterm.js',
      'lib/xterm.css',
      'lib/addon-fit.js',
      'lib/windows-env.js',
      'xterm.LICENSE',
    ]) {
      const from = path.join(source, relative);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(destination, relative));
    }
  }

  const file = patchPath();
  let patch = '';
  try { patch = fs.readFileSync(file, 'utf8'); } catch { patch = ''; }
  const merged = mergeCompanionPatch(patch);
  patch = merged.patch;
  const { changed } = merged;
  if (changed) writeAtomic(file, patch);
  const skills = syncBundledSkills();
  return {
    ok: true,
    changed,
    plugins: COMPANION_PLUGINS.map((plugin) => plugin.name),
    mcps: COMPANION_MCPS.map((mcp) => mcp.serverName),
    skills,
  };
}

function listInstalledPlugins() {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return { ok: true, profile: PROFILE, profileDir: webProfileDir(), plugins: [], bundles: [] };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object'
      ? manifest.dependencies
      : {};
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
    return {
      ok: true,
      profile: PROFILE,
      profileDir: webProfileDir(),
      plugins: Object.entries(dependencies).map(([name, spec]) => ({
        name,
        spec: String(spec || ''),
        bundle: bundles.includes(name),
        dropped: DROPPED.includes(name),
      })),
      bundles,
    };
  } catch {
    return { ok: false, profile: PROFILE, profileDir: webProfileDir(), plugins: [], bundles: [] };
  }
}

module.exports = {
  PROFILE,
  DROPPED,
  COMPANION_PLUGINS,
  COMPANION_MCPS,
  dshHome,
  bundledSkillDir,
  webProfileDir,
  mergeCompanionPatch,
  syncBundledSkills,
  syncCompanionPlugins,
  stripDroppedPlugins,
  listInstalledPlugins,
};
