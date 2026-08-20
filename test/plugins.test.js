const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPANION_MCPS,
  COMPANION_PLUGINS,
  mergeCompanionPatch,
} = require('../src/main/plugins');

test('companion plugins replace an empty YAML list placeholder', () => {
  const source = '# Generated profile patch\n[]\n';
  const result = mergeCompanionPatch(source);

  assert.equal(result.changed, true);
  assert.doesNotMatch(result.patch, /^\s*\[\]\s*$/m);
  for (const plugin of COMPANION_PLUGINS) {
    assert.match(result.patch, new RegExp(`id: ${plugin.id}\\b`));
  }
  for (const mcp of COMPANION_MCPS) {
    assert.match(result.patch, new RegExp(`id: ${mcp.id}\\b`));
    assert.match(result.patch, new RegExp(`serverName: ${mcp.serverName}\\b`));
  }
});

test('companion plugin merge repairs the legacy invalid patch', () => {
  const entries = COMPANION_PLUGINS.map(
    (plugin) => `- insert:\n    - id: ${plugin.id}\n      name: '${plugin.name}'`,
  ).join('\n');
  const result = mergeCompanionPatch(`# Generated profile patch\n[]\n${entries}\n`);

  assert.equal(result.changed, true);
  assert.doesNotMatch(result.patch, /^\s*\[\]\s*$/m);
  assert.equal(
    (result.patch.match(/- insert:/g) || []).length,
    COMPANION_PLUGINS.length + COMPANION_MCPS.length,
  );
});

test('companion plugin merge replaces stale managed MCP configuration', () => {
  const stale = [
    '- insert:',
    '    - id: mcp-serena',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: serena',
    "        command: !!js process.platform === 'win32' ? 'bad.exe' : 'serena'",
    '- insert:',
    '    - id: user-plugin',
    "      name: '@example/user-plugin'",
    '',
  ].join('\n');
  const result = mergeCompanionPatch(stale);

  assert.equal(result.changed, true);
  assert.doesNotMatch(result.patch, /command: !!js/);
  assert.match(result.patch, /id: user-plugin/);
  assert.equal((result.patch.match(/id: mcp-serena\b/g) || []).length, 1);
  assert.match(result.patch, /# --- dsh-desktop-companions ---/);
});

test('companion plugin merge is idempotent', () => {
  const first = mergeCompanionPatch('[]\n');
  const second = mergeCompanionPatch(first.patch);

  assert.equal(second.changed, false);
  assert.equal(second.patch, first.patch);
});
