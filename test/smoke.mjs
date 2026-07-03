// Smoke gate for mycelium-mcp.
// No test framework, no dependencies — Node builtins only.
// Exits 0 only if every source file parses AND the key exports resolve.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SOURCE_FILES = [
  'index.js',
  'src/api.js',
  'src/state.js',
  'src/sse.js',
  'src/tools.js',
];

let checks = 0;

// --- Phase 1: syntax check every source file via `node --check` ---
for (const rel of SOURCE_FILES) {
  const file = resolve(root, rel);
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' });
  if (res.status !== 0) {
    console.error(`FAIL: syntax error in ${rel}`);
    console.error(res.stderr || res.stdout || '(no output)');
    process.exit(1);
  }
  checks++;
}

// --- Phase 2: import check — key exports must resolve ---
const state = await import('../src/state.js');
for (const name of ['getState', 'setWorkingOn', 'setBooted', 'startHeartbeat', 'sendHeartbeat', 'shutdown']) {
  assert.equal(typeof state[name], 'function', `src/state.js missing export: ${name}`);
  checks++;
}

const api = await import('../src/api.js');
for (const name of ['apiGet', 'apiPost', 'apiPut', 'apiDelete']) {
  assert.equal(typeof api[name], 'function', `src/api.js missing export: ${name}`);
  checks++;
}

console.log(`PASS: ${checks} checks`);
process.exit(0);
