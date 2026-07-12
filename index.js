#!/usr/bin/env node

// Mycelium MCP Server
// Wraps the Mycelium API with native tools for AI agents.
// Two modes: admin (full access) and agent (scoped, auto-heartbeat).

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startSSE } from './src/sse.js';
import { shutdown, startHeartbeat } from './src/state.js';
import { registerPluginTools, registerTools } from './src/tools.js';

// Single source of truth for the version — a hardcoded copy here drifted from
// package.json before; reading it keeps `npm version` bumps automatic.
var pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

var role = process.env.MYCELIUM_ROLE || 'admin';
var agentId = process.env.MYCELIUM_AGENT_ID || null;
var apiKey = process.env.MYCELIUM_API_KEY;

if (!apiKey) {
  process.stderr.write('ERROR: MYCELIUM_API_KEY environment variable is required\n');
  process.exit(1);
}

if (role === 'agent' && !agentId) {
  process.stderr.write('ERROR: MYCELIUM_AGENT_ID is required in agent mode\n');
  process.exit(1);
}

var server = new McpServer({
  name: 'mycelium-mcp',
  version: pkg.version,
});

registerTools(server);

// Clean shutdown — guarded so signal + transport-close can't run it twice
var shuttingDown = false;
async function shutdownOnce() {
  if (shuttingDown) return;
  shuttingDown = true;
  await shutdown();
}
process.on('SIGINT', async () => {
  await shutdownOnce();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await shutdownOnce();
  process.exit(0);
});

// Connect FIRST so Claude Code can handshake immediately
var transport = new StdioServerTransport();
await server.connect(transport);

// When the client disconnects WITHOUT a signal (e.g. Claude Code exits and
// our stdin hits EOF), the 5-min heartbeat interval and SSE reconnect timer
// would keep this process alive forever — an orphan reporting "online" that
// defeats the platform's crash detection. Two hooks cover both close paths:
// - Protocol.onclose: the client explicitly closed the MCP transport
// - stdin end/close: the parent died and the pipe hit EOF (the SDK's stdio
//   transport does NOT watch for this itself — verified against SDK 1.27)
function exitOnDisconnect() {
  shutdownOnce().finally(() => process.exit(0));
}
server.server.onclose = exitOnDisconnect;
process.stdin.on('end', exitOnDisconnect);
process.stdin.on('close', exitOnDisconnect);

process.stderr.write(`Mycelium MCP server running (${role}${agentId ? `:${agentId}` : ''})\n`);

// Register plugin tools after transport is connected so startup isn't blocked by network
registerPluginTools(server).catch((err) => {
  process.stderr.write(`Plugin tool registration error: ${err.message}\n`);
});

// Start heartbeat (agent) or SSE-only (admin) so sleep_mode_on can wake this session
if (role === 'agent') {
  startHeartbeat(server);
} else {
  // Admin mode: start SSE for sleep mode wake-up even without heartbeat
  startSSE(null, server);
}
