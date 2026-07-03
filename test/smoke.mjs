// Smoke gate for mycelium-mcp.
// No test framework, no dependencies — Node builtins only.
// Exits 0 only if every source file parses AND the key exports resolve.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Build the source list at RUNTIME: index.js plus every *.js in src/.
// No hardcoded allowlist — a src file added later can never silently bypass the gate.
const srcModules = readdirSync(resolve(root, 'src'))
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => `src/${f}`);
const SOURCE_FILES = ['index.js', ...srcModules];

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

// --- Phase 2: import check — every src module must resolve ---
// index.js is intentionally excluded: importing it starts the MCP server.
// All src modules are verified side-effect-free, so a bare import is a safe check.
for (const rel of srcModules) {
  try {
    await import(`../${rel}`);
  } catch (err) {
    console.error(`FAIL: import error in ${rel}`);
    console.error(err?.message || err);
    process.exit(1);
  }
  checks++;
}

// --- Phase 2b: key exports must resolve (named-export assertions) ---
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
