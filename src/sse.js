// SSE client for real-time event subscription
// Connects to the Mycelium /events/stream endpoint and surfaces
// relevant events (messages, directives, requests) to the agent.

import { API_URL, API_KEY, ROLE } from './api.js';
import { getState } from './state.js';

var RECONNECT_DELAY = 5000;
var controller = null;
var reconnectTimer = null;
var connected = false;

export function isSSEConnected() { return connected; }

export function startSSE(onEvent) {
  stopSSE();
  connect(onEvent);
}

export function stopSSE() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (controller) { controller.abort(); controller = null; }
  connected = false;
}

async function connect(onEvent) {
  var st = getState();
  // Build URL with auth — SSE endpoint accepts agent key as query param
  var url = API_URL + '/events/stream?agent_key=' + encodeURIComponent(API_KEY);

  controller = new AbortController();

  try {
    var headers = {};
    if (ROLE === 'admin') {
      headers['X-Admin-Key'] = API_KEY;
    } else {
      headers['X-Agent-Key'] = API_KEY;
    }

    var res = await fetch(url, {
      headers: headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      process.stderr.write('[mycelium-sse] Connection failed: HTTP ' + res.status + '\n');
      scheduleReconnect(onEvent);
      return;
    }

    connected = true;
    process.stderr.write('[mycelium-sse] Connected to event stream\n');

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE format: "data: {...}\n\n"
      var lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (var line of lines) {
        if (line.startsWith('data: ')) {
          try {
            var event = JSON.parse(line.slice(6));
            if (event.type === 'connected') continue; // Skip connection confirmation
            handleEvent(event, st.agentId, onEvent);
          } catch {
            // Ignore parse errors
          }
        }
        // Ignore comments (: ping) and empty lines
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // Intentional disconnect
    process.stderr.write('[mycelium-sse] Connection error: ' + err.message + '\n');
  }

  connected = false;
  scheduleReconnect(onEvent);
}

function scheduleReconnect(onEvent) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connect(onEvent);
  }, RECONNECT_DELAY);
}

function handleEvent(event, agentId, onEvent) {
  // Filter: only surface events relevant to this agent
  var type = event.type || '';
  var data = event.data || {};

  // Messages/requests/directives sent TO this agent
  if (type === 'message_sent' || type === 'message_received') {
    if (data.to_agent === agentId || data.to_agent === null) {
      var msgType = data.msg_type || 'message';
      if (msgType === 'directive') {
        process.stderr.write('[mycelium-sse] *** DIRECTIVE from ' + (data.from_agent || '?') + ': ' + (data.content || '').substring(0, 200) + ' ***\n');
      } else if (msgType === 'request') {
        process.stderr.write('[mycelium-sse] REQUEST from ' + (data.from_agent || '?') + ': ' + (data.content || '').substring(0, 200) + '\n');
      } else {
        process.stderr.write('[mycelium-sse] Message from ' + (data.from_agent || '?') + ': ' + (data.content || '').substring(0, 100) + '\n');
      }
    }
  }

  // Task assigned to this agent
  if (type === 'task_created' || type === 'task_updated') {
    if (data.assignee === agentId) {
      process.stderr.write('[mycelium-sse] Task assigned: #' + (data.id || '?') + ' ' + (data.title || '') + '\n');
    }
  }

  // Plan step assigned to this agent
  if (type === 'plan_step_updated' || type === 'plan_step_completed') {
    if (data.assignee === agentId) {
      process.stderr.write('[mycelium-sse] Plan step update: ' + (data.title || '') + ' [' + (data.status || '') + ']\n');
    }
  }

  // Pass all events to callback if provided
  if (onEvent) onEvent(event);
}
