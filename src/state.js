// Session state and auto-heartbeat management

import { apiPost, apiPut } from './api.js';

var state = {
  agentId: process.env.MYCELIUM_AGENT_ID || null,
  role: process.env.MYCELIUM_ROLE || 'admin',
  workingOn: '',
  booted: false,
  heartbeatTimer: null,
  bootData: null,
  messagesAcked: [],
  sessionId: null,
  customState: {}
};

export function getState() { return state; }

export function setWorkingOn(text) {
  state.workingOn = text || '';
}

export function setBooted(bootData) {
  state.booted = true;
  state.bootData = bootData;
  // Generate session ID on first boot
  if (!state.sessionId) {
    state.sessionId = state.agentId + '-' + Date.now().toString(36);
  }
  // Track message IDs from boot data
  if (bootData.new_messages) {
    for (var m of bootData.new_messages) {
      if (state.messagesAcked.indexOf(m.id) === -1) state.messagesAcked.push(m.id);
    }
  }
  if (bootData.pending_requests) {
    for (var r of bootData.pending_requests) {
      if (state.messagesAcked.indexOf(r.id) === -1) state.messagesAcked.push(r.id);
    }
  }
}

export function ackMessage(messageId) {
  if (state.messagesAcked.indexOf(messageId) === -1) state.messagesAcked.push(messageId);
}

export function setCustomState(key, value) {
  state.customState[key] = value;
}

export async function sendHeartbeat() {
  if (state.role !== 'agent' || !state.agentId) return;
  try {
    await apiPost('/agents/heartbeat', {
      status: 'online',
      working_on: state.workingOn,
      session_id: state.sessionId,
      messages_acked: JSON.stringify(state.messagesAcked),
      state_snapshot: JSON.stringify(state.customState)
    });
  } catch (e) {
    process.stderr.write('Heartbeat failed: ' + e.message + '\n');
  }
}

export function startHeartbeat() {
  if (state.role !== 'agent') return;
  stopHeartbeat();
  // Heartbeat every 5 minutes (boot already marks agent online — no need to send immediately)
  state.heartbeatTimer = setInterval(sendHeartbeat, 5 * 60 * 1000);
}

export function stopHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

export async function shutdown() {
  stopHeartbeat();
  if (state.role === 'agent' && state.agentId) {
    // Auto-save session summary
    try {
      var sessionData = {
        working_on: state.workingOn || '',
        timestamp: new Date().toISOString()
      };
      await apiPut('/context/keys/' + state.agentId + '/last_session', {
        value: JSON.stringify(sessionData)
      });
    } catch (e) { /* best effort */ }

    // Clear working_on on shutdown
    try {
      await apiPost('/agents/heartbeat', {
        status: 'offline',
        working_on: ''
      });
    } catch { /* best effort */ }
  }
}
