#!/usr/bin/env node

// Mycelium MCP Server
// Wraps the Mycelium API with native tools for AI agents.
// Two modes: admin (full access) and agent (scoped, auto-heartbeat).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools, registerPluginTools } from './src/tools.js';
import { shutdown, startHeartbeat } from './src/state.js';

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
  version: '1.2.0'
});

registerTools(server);
await registerPluginTools(server);

// Clean shutdown
process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

var transport = new StdioServerTransport();
await server.connect(transport);

// Start heartbeat with server reference so sleep_mode_on SSE events can wake this session
if (role === 'agent') startHeartbeat(server);

process.stderr.write('Mycelium MCP server running (' + role + (agentId ? ':' + agentId : '') + ')\n');
