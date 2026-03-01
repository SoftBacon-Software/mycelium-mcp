#!/usr/bin/env node

// Mycelium MCP Server (formerly dioverse-mcp)
// Wraps the Mycelium API at willingsacrifice.com with native tools for Claude agents.
// Two modes: admin (full access) and agent (scoped, auto-heartbeat).
// Env vars: MYCELIUM_* preferred, DIOVERSE_* accepted as fallback.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './src/tools.js';
import { shutdown } from './src/state.js';

var role = process.env.MYCELIUM_ROLE || process.env.DIOVERSE_ROLE || 'admin';
var agentId = process.env.MYCELIUM_AGENT_ID || process.env.DIOVERSE_AGENT_ID || null;
var apiKey = process.env.MYCELIUM_API_KEY || process.env.DIOVERSE_API_KEY;

if (!apiKey) {
  process.stderr.write('ERROR: MYCELIUM_API_KEY (or DIOVERSE_API_KEY) environment variable is required\n');
  process.exit(1);
}

if (role === 'agent' && !agentId) {
  process.stderr.write('ERROR: MYCELIUM_AGENT_ID (or DIOVERSE_AGENT_ID) is required in agent mode\n');
  process.exit(1);
}

var server = new McpServer({
  name: 'mycelium-mcp',
  version: '1.1.0'
});

registerTools(server);

// Clean shutdown
process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

var transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write('Mycelium MCP server running (' + role + (agentId ? ':' + agentId : '') + ')\n');
