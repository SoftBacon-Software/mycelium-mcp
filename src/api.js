// HTTP client for the Mycelium API (formerly Dioverse Studio API)
// Accepts MYCELIUM_* env vars with DIOVERSE_* as fallback.

const API_URL = process.env.MYCELIUM_API_URL || process.env.DIOVERSE_API_URL || 'https://willingsacrifice.com/api/mycelium';
const API_KEY = process.env.MYCELIUM_API_KEY || process.env.DIOVERSE_API_KEY || '';
const ROLE = process.env.MYCELIUM_ROLE || process.env.DIOVERSE_ROLE || 'admin';

function authHeaders() {
  if (ROLE === 'admin') return { 'X-Admin-Key': API_KEY };
  return { 'X-Agent-Key': API_KEY };
}

async function request(method, path, body) {
  var url = API_URL + path;
  var headers = { ...authHeaders() };
  var opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  var res = await fetch(url, opts);
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    var msg = (data && data.error) || text || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

export function apiGet(path) { return request('GET', path); }
export function apiPost(path, body) { return request('POST', path, body); }
export function apiPut(path, body) { return request('PUT', path, body); }
export function apiDelete(path) { return request('DELETE', path); }
export { API_URL, API_KEY, ROLE };
