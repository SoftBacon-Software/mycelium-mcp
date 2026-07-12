# DORMANT — not the active MCP fork

This directory is the public, npm-published `mycelium-mcp` client. Last meaningful local edit: 2026-03-09. Marked dormant 2026-05-27.

**The MCP fork actually loaded by Claude Code sessions on this Mac is `~/.mycelium-mcp-m5max/`, not this directory.**

## Why two

- `~/Projects/mycelium-mcp/` (THIS dir) = the npm release artifact. Clean, defaults to mycelium.fyi, intended for external users.
- `~/.mycelium-mcp-m5max/` = locally-customized fork. Defaults to `localhost:3002`, admin elevation via `X-Admin-Key` + `X-Acting-As: m5Max`, has up-to-date references to the local mycelium server's plugin schemas.

## Active config

`~/.claude.json` mcpServers.mycelium and `projects./Users/grb/Projects.mcpServers.mycelium` both point at the m5max fork (set 2026-05-27 after a session-long substrate-friction episode where this fork was being loaded by mistake and silently routed all calls to .fyi).

## When to edit THIS dir

Only when cutting a new npm release of the public client. Do NOT edit for local m5Max behavior changes — those go in the m5max fork.

See `[[reference_claude_mcp_config_file]]` in m5Max auto-memory for the resolution-order trap.