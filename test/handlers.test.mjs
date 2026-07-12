// Handler-level tests for mycelium-mcp against a local mock substrate.
// No test framework, no dependencies — Node builtins only (same ethos as smoke.mjs).
//
// Covers the load-bearing paths:
//   1. api.js — auth headers, JSON parsing, HTTP error surfacing, timeout
//   2. tool handlers — registerTools against a fake MCP server, including the
//      complete_task "advance working_on from /work queue" path (regressed
//      silently before: the code read a `tasks` field that /work never returns)
//   3. registerDual — errors become isError tool responses, never crashes
//   4. index.js — entry point actually boots and exits cleanly on SIGTERM

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// --- Mock substrate: routes are (method + ' ' + path) → handler(req, res, body)
const routes = {};
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    const key = `${req.method} ${req.url.split('?')[0]}`;
    const handler = routes[key];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `no mock for ${key}` }));
      return;
    }
    handler(req, res, raw ? JSON.parse(raw) : {});
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// --- Env BEFORE importing src modules (api.js/state.js read env at import).
// HOME points at an empty temp dir so resolveKey() cannot pick up a real key
// from the developer's ~/.claude/settings.json.
process.env.HOME = mkdtempSync(join(tmpdir(), 'mycelium-mcp-test-'));
process.env.MYCELIUM_API_URL = BASE;
process.env.MYCELIUM_API_KEY = 'test-key';
process.env.MYCELIUM_ROLE = 'agent';
process.env.MYCELIUM_AGENT_ID = 'test-agent';

const { apiGet } = await import('../src/api.js');
const { registerTools } = await import('../src/tools.js');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ok - ${name}`);
}

// ---------- 1. api.js ----------

routes['GET /echo'] = (req, res) =>
  json(res, 200, { agentKey: req.headers['x-agent-key'] || null });
const echo = await apiGet('/echo');
assert.equal(echo.agentKey, 'test-key', 'agent mode must send X-Agent-Key from env');
ok('api: agent-mode auth header + JSON parsing');

routes['GET /missing-thing'] = (_req, res) => json(res, 404, { error: 'Agent not found' });
await assert.rejects(() => apiGet('/missing-thing'), /HTTP 404: Agent not found/);
ok('api: HTTP errors surface status + server error field');

routes['GET /hang'] = () => {
  /* never respond */
};
await assert.rejects(() => apiGet('/hang', { timeoutMs: 300 }), /timeout after 300ms/);
ok('api: hung substrate times out instead of hanging the tool call');

// ---------- 2 + 3. tool handlers via a fake MCP server ----------

const handlers = {};
const fakeServer = {
  tool(name, _desc, _schema, handler) {
    handlers[name] = handler;
  },
  sendToolListChanged() {},
};
registerTools(fakeServer);
assert.ok(handlers.mycelium_complete_task, 'mycelium_complete_task must be registered');
assert.ok(handlers.mycelium_boot, 'mycelium_boot must be registered');
ok('tools: registerTools registers mycelium_* handlers');

// complete_task: marks done, then advances working_on from the /work QUEUE
// (the endpoint returns { queue }, not { tasks } — this exact shape mismatch
// silently broke auto-advance before; this test pins the contract).
routes['PUT /tasks/7'] = (_req, res, body) => {
  assert.equal(body.status, 'done');
  json(res, 200, { ok: true });
};
routes['GET /work/test-agent'] = (_req, res) =>
  json(res, 200, {
    ok: true,
    queue: [{ type: 'task', id: 9, title: 'Next thing', status: 'open' }],
  });
routes['POST /agents/heartbeat'] = (_req, res) => json(res, 200, { ok: true, pending: 0 });

const done = await handlers.mycelium_complete_task({ task_id: 7 });
assert.ok(!done.isError, `complete_task should succeed: ${done.content[0].text}`);
assert.match(done.content[0].text, /working_on advanced to: "Next thing"/);
ok('tools: complete_task advances working_on from the /work queue');

// Empty queue → working_on clears (and the message says so truthfully)
routes['GET /work/test-agent'] = (_req, res) => json(res, 200, { ok: true, queue: [] });
const doneEmpty = await handlers.mycelium_complete_task({ task_id: 7 });
assert.match(doneEmpty.content[0].text, /working_on cleared/);
ok('tools: complete_task clears working_on when queue is empty');

// registerDual error wrapping: an API failure returns an isError tool
// response naming the tool — the MCP session must never crash on a bad call.
routes['GET /tasks/404'] = (_req, res) => json(res, 404, { error: 'Task not found' });
const errRes = await handlers.mycelium_claim_task({ task_id: 404 });
assert.equal(errRes.isError, true);
assert.match(errRes.content[0].text, /Error in mycelium_claim_task: HTTP 404: Task not found/);
ok('tools: handler errors return isError content, not a crash');

// ---------- 4. entry point boots and exits cleanly ----------

const child = spawn(process.execPath, [join(root, 'index.js')], {
  env: {
    ...process.env,
    MYCELIUM_API_URL: BASE, // keep the entry point off the real network
    MYCELIUM_ROLE: 'admin', // admin mode: no agent id needed, fast shutdown
    MYCELIUM_AGENT_ID: '',
    MYCELIUM_API_KEY: 'test-key',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const bootResult = await new Promise((resolvePromise) => {
  let stderr = '';
  let sawStartup = false;
  const timer = setTimeout(
    () => resolvePromise({ ok: false, why: 'no startup line in 10s', stderr }),
    10000,
  );
  child.stderr.on('data', (c) => {
    stderr += c;
    if (!sawStartup && stderr.includes('Mycelium MCP server running')) {
      sawStartup = true;
      child.kill('SIGTERM');
    }
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (sawStartup) resolvePromise({ ok: code === 0, why: `exit code ${code}`, stderr });
    else resolvePromise({ ok: false, why: `exited before startup line (code ${code})`, stderr });
  });
});
assert.ok(
  bootResult.ok,
  `index.js must start and exit 0 on SIGTERM — ${bootResult.why}\n${bootResult.stderr}`,
);
ok('entry: index.js boots and shuts down cleanly on SIGTERM');

// Orphan prevention: when the client dies and stdin hits EOF (no signal),
// the process must exit rather than heartbeat forever as a zombie "online"
// agent. Regression test for the stdin end/close hooks in index.js.
const orphan = spawn(process.execPath, [join(root, 'index.js')], {
  env: {
    ...process.env,
    MYCELIUM_API_URL: BASE,
    MYCELIUM_ROLE: 'admin',
    MYCELIUM_AGENT_ID: '',
    MYCELIUM_API_KEY: 'test-key',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const orphanResult = await new Promise((resolvePromise) => {
  let stderr = '';
  let sawStartup = false;
  const timer = setTimeout(() => {
    orphan.kill('SIGKILL'); // it leaked — reap it so the test suite exits
    resolvePromise({ ok: false, why: 'still alive 10s after stdin EOF (orphan leak)', stderr });
  }, 10000);
  orphan.stderr.on('data', (c) => {
    stderr += c;
    if (!sawStartup && stderr.includes('Mycelium MCP server running')) {
      sawStartup = true;
      orphan.stdin.end(); // simulate the parent dying: EOF, no signal
    }
  });
  orphan.on('exit', (code) => {
    clearTimeout(timer);
    if (sawStartup) resolvePromise({ ok: code === 0, why: `exit code ${code}`, stderr });
    else resolvePromise({ ok: false, why: `exited before startup line (code ${code})`, stderr });
  });
});
assert.ok(
  orphanResult.ok,
  `index.js must exit when stdin closes — ${orphanResult.why}\n${orphanResult.stderr}`,
);
ok('entry: index.js exits on stdin EOF (no orphaned heartbeater)');

server.close();
console.log(`PASS: ${passed} handler checks`);
process.exit(0);
