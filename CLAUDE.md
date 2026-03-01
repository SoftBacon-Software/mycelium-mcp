# CLAUDE.md — Mycelium MCP Server

## What This Is

MCP (Model Context Protocol) server that wraps the Mycelium platform API as native Claude Code tools. Package name: `mycelium-mcp`. Gives Claude agents tools like `mycelium_boot`, `mycelium_claim_task`, `mycelium_heartbeat` instead of raw curl commands. Legacy `studio_*` tool names still work as aliases.

## Critical Rules

- **No guessing**: If info isn't in context, say "I don't know" or use a tool to fetch it.
- **No silent failures**: Report failures immediately. Never pretend something worked.
- **Evidence-based**: Verify files exist before editing. Read before writing.
- **Honest failure**: Failing is OK. Never force "success" by modifying tests or deleting checks.

## Commands

```bash
node index.js                    # Run MCP server (stdio transport)
npm install                      # Install dependencies
```

No tests or linting configured.

## Layout

```
index.js          # Entry point — MCP server setup, env validation
src/
  api.js          # HTTP client for Mycelium API (fetch wrapper)
  state.js        # Session state, auto-heartbeat (5min interval)
  tools.js        # All MCP tool definitions and handlers
package.json      # mycelium-mcp v1.1.0
```

## Architecture

- **Transport**: stdio (standard MCP pattern)
- **Two modes**: `admin` (full access, X-Admin-Key) and `agent` (scoped, X-Agent-Key, auto-heartbeat)
- **API target**: Defaults to `https://mycelium.fyi/api/mycelium`. Configurable via `MYCELIUM_API_URL`.
- **Tool naming**: All tools registered with `mycelium_*` prefix. Legacy `studio_*` aliases also registered.
- **Auto-heartbeat**: In agent mode, sends heartbeat every 5 minutes. Clears `working_on` on shutdown.

## Environment Variables

Accepts `MYCELIUM_*` (preferred) with `DIOVERSE_*` as fallback:

| Variable | Required | Description |
|----------|----------|-------------|
| `MYCELIUM_API_KEY` / `DIOVERSE_API_KEY` | Yes | Admin key or agent key |
| `MYCELIUM_ROLE` / `DIOVERSE_ROLE` | No | `admin` (default) or `agent` |
| `MYCELIUM_AGENT_ID` / `DIOVERSE_AGENT_ID` | Agent mode | Agent identifier (e.g. `greatness-claude`) |
| `MYCELIUM_API_URL` / `DIOVERSE_API_URL` | No | API base URL (default: `https://mycelium.fyi/api/mycelium`) |

## Configuration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "dioverse": {
      "command": "node",
      "args": ["D:/dioverse-mcp/index.js"],
      "env": {
        "DIOVERSE_API_URL": "https://mycelium.fyi/api/mycelium",
        "DIOVERSE_ROLE": "admin",
        "DIOVERSE_API_KEY": "<admin-key>"
      }
    }
  }
}
```

## MCP Tools

| Tool | What |
|------|------|
| `mycelium_boot` | Boot session — returns agents, tasks, messages, plans, bugs |
| `mycelium_overview` | Full dashboard snapshot |
| `mycelium_get_work` | Prioritized work list (plan steps > tasks > bugs) |
| `mycelium_claim_task` | Claim + start task, auto-updates working_on |
| `mycelium_complete_task` | Mark done, auto-advances working_on |
| `mycelium_create_task` | Create new task |
| `mycelium_send_message` | Send message to agent or broadcast |
| `mycelium_send_request` | Blocking request to agent |
| `mycelium_respond_to_request` | Resolve a pending request |
| `mycelium_read_messages` | Read recent messages |
| `mycelium_check_plans` | View active plans + steps |
| `mycelium_update_step` | Update plan step status/assignee |
| `mycelium_get_context` | Read context keys |
| `mycelium_set_context` | Store context keys |
| `mycelium_list_bugs` | List bug reports |
| `mycelium_claim_bug` | Claim + start bug fix |
| `mycelium_fix_bug` | Mark bug fixed |
| `mycelium_heartbeat` | Update working_on status |
| `mycelium_api` | Raw API call for anything else |

## Related Repos

| Repo | What |
|------|------|
| `mycelium` | Mycelium platform — dashboard, API, agent coordination (`D:/mycelium/`, deployed at `mycelium.fyi`) |
| `dioverse-server` | WS game server (`D:/dioverse-server/`, deployed at `willingsacrifice.com`) |
| `willing-sacrifice` | WS Godot 4.6 game source (`D:/willing-sacrifice/`) |
| `dioverse` | Art tools, Discord bot, LoRA training (`D:/dioverse/`) |
