// Session state and auto-heartbeat management

import { apiPost } from './api.js';

var state = {
  agentId: process.env.DIOVERSE_AGENT_ID || null,
  role: process.env.DIOVERSE_ROLE || 'admin',
  workingOn: '',
  booted: false,
  heartbeatTimer: null,
  bootData: null
};

export function getState() { return state; }

export function setWorkingOn(text) {
  state.workingOn = text || '';
}

export function setBooted(bootData) {
  state.booted = true;
  state.bootData = bootData;
}

export async function sendHeartbeat() {
  if (state.role !== 'agent' || !state.agentId) return;
  try {
    await apiPost('/agents/heartbeat', {
      status: 'online',
      working_on: state.workingOn
    });
  } catch (e) {
    process.stderr.write('Heartbeat failed: ' + e.message + '\n');
  }
}

export function startHeartbeat() {
  if (state.role !== 'agent') return;
  stopHeartbeat();
  // Heartbeat every 5 minutes
  state.heartbeatTimer = setInterval(sendHeartbeat, 5 * 60 * 1000);
  // Send one immediately
  sendHeartbeat();
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
    // Clear working_on on shutdown
    try {
      await apiPost('/agents/heartbeat', {
        status: 'offline',
        working_on: ''
      });
    } catch { /* best effort */ }
  }
}
