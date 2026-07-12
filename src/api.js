// HTTP client for the Mycelium API

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Read key from settings.json as ground truth — env vars from Claude Code can be stale
function resolveKey() {
  var envKey = process.env.MYCELIUM_API_KEY || '';
  try {
    var settingsPath = join(homedir(), '.claude', 'settings.json');
    var settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    var mcpEnv = settings.mcpServers && settings.mcpServers.mycelium && settings.mcpServers.mycelium.env;
    if (mcpEnv && mcpEnv.MYCELIUM_API_KEY) return mcpEnv.MYCELIUM_API_KEY;
  } catch {}
  return envKey;
}

const API_URL = process.env.MYCELIUM_API_URL || 'https://mycelium.fyi/api/mycelium';
const API_KEY = resolveKey();
const ROLE = process.env.MYCELIUM_ROLE || 'admin';
const AGENT_ID = process.env.MYCELIUM_AGENT_ID || '';
// Per-request timeout. Without one, a hung substrate hangs every tool call
// (and shutdown) indefinitely — the MCP session just looks dead.
const TIMEOUT_MS = parseInt(process.env.MYCELIUM_TIMEOUT_MS, 10) || 30000;

function authHeaders() {
  if (ROLE === 'admin') {
    var headers = { 'X-Admin-Key': API_KEY };
    // Identify who is using the admin key so actions aren't attributed to __system__
    if (AGENT_ID) headers['X-Acting-As'] = AGENT_ID;
    return headers;
  }
  return { 'X-Agent-Key': API_KEY };
}

async function request(method, path, body, reqOpts) {
  var url = API_URL + path;
  var headers = { ...authHeaders() };
  var timeoutMs = (reqOpts && reqOpts.timeoutMs) || TIMEOUT_MS;
  var opts = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  var res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    // Bare fetch errors ("fetch failed", "This operation was aborted") don't
    // say WHERE — name the endpoint so a substrate-down error is diagnosable.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Mycelium API timeout after ' + timeoutMs + 'ms (' + method + ' ' + url + ')');
    }
    var cause = (err.cause && err.cause.message) ? ' — ' + err.cause.message : '';
    throw new Error('Mycelium API unreachable (' + method + ' ' + url + '): ' + err.message + cause);
  }
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    // Prefer the server's error field; truncate raw bodies (proxy HTML error
    // pages can be huge) and always include the status code.
    var detail = (data && data.error) || (text || '').slice(0, 500) || res.statusText;
    throw new Error('HTTP ' + res.status + ': ' + detail);
  }
  return data;
}

export function apiGet(path, opts) { return request('GET', path, undefined, opts); }
export function apiPost(path, body, opts) { return request('POST', path, body, opts); }
export function apiPut(path, body, opts) { return request('PUT', path, body, opts); }
export function apiDelete(path, opts) { return request('DELETE', path, undefined, opts); }
export { API_URL, API_KEY, ROLE };
