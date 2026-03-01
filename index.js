#!/usr/bin/env node

// Dioverse MCP Server
// Wraps the Studio API at willingsacrifice.com with native tools for Claude agents.
// Two modes: admin (full access) and agent (scoped, auto-heartbeat).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './src/tools.js';
import { shutdown } from './src/state.js';

var role = process.env.DIOVERSE_ROLE || 'admin';
var agentId = process.env.DIOVERSE_AGENT_ID || null;

if (!process.env.DIOVERSE_API_KEY) {
  process.stderr.write('ERROR: DIOVERSE_API_KEY environment variable is required\n');
  process.exit(1);
}

if (role === 'agent' && !agentId) {
  process.stderr.write('ERROR: DIOVERSE_AGENT_ID is required in agent mode\n');
  process.exit(1);
}

var server = new McpServer({
  name: 'dioverse-mcp',
  version: '1.0.0'
});

registerTools(server);

// Clean shutdown
process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

var transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write('Dioverse MCP server running (' + role + (agentId ? ':' + agentId : '') + ')\n');
