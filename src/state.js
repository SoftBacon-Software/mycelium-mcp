// Session state and auto-heartbeat management

import { apiPost, apiPut } from './api.js';
import { startSSE, stopSSE } from './sse.js';

var state = {
  agentId: process.env.MYCELIUM_AGENT_ID || null,
  role: process.env.MYCELIUM_ROLE || 'admin',
  workingOn: '',
  booted: false,
  heartbeatTimer: null,
  bootData: null,
  messagesAcked: [],
  sessionId: null,
  customState: {},
  // Auto-tracked working state — populates state_snapshot automatically
  claimedItem: null,    // { type, id, title } — from claim_task, claim_bug, get_work auto_claim
  currentStep: null,    // { plan_id, step_id, title } — from update_step
  progressNotes: [],    // brief notes accumulated during work
  // Pending inbox from auto-heartbeat — prepended to next tool response
  pendingInbox: null
};

export function getState() { return state; }

// Consume pending inbox — returns formatted string or null. Call from any tool response.
export function consumePendingInbox() {
  if (!state.pendingInbox) return null;
  var inbox = state.pendingInbox;
  state.pendingInbox = null;
  var lines = [];
  if (inbox.directives && inbox.directives.length > 0) {
    lines.push('=== DIRECTIVES (' + inbox.directives.length + ') — MUST RESPOND ===');
    for (var d of inbox.directives) {
      lines.push('[DIR #' + d.id + '] from ' + d.from_agent + ': ' + (d.content || '').substring(0, 500));
    }
  }
  if (inbox.requests && inbox.requests.length > 0) {
    lines.push('=== REQUESTS (' + inbox.requests.length + ') — MUST RESPOND ===');
    for (var r of inbox.requests) {
      lines.push('[REQ #' + r.id + '] from ' + r.from_agent + ': ' + (r.content || '').substring(0, 500));
    }
  }
  if (inbox.messages && inbox.messages.length > 0) {
    lines.push('=== NEW MESSAGES (' + inbox.messages.length + ') ===');
    for (var m of inbox.messages) {
      var sender = m.from_agent || '?';
      var target = m.to_agent ? '' : ' (broadcast)';
      lines.push('[MSG #' + m.id + '] ' + sender + target + ': ' + (m.content || '').substring(0, 500));
    }
  }
  if (inbox.approvals && inbox.approvals.length > 0) {
    lines.push('=== YOUR APPROVALS (' + inbox.approvals.length + ') ===');
    for (var a of inbox.approvals) {
      var label = (a.status || 'pending').toUpperCase();
      lines.push('[' + label + ' #' + a.id + '] ' + (a.action_type || '?') + ': ' + (a.title || ''));
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

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

export function setClaimedItem(item) {
  state.claimedItem = item || null;
}

export function setCurrentStep(step) {
  state.currentStep = step || null;
}

export function addProgressNote(note) {
  state.progressNotes.push(note);
  // Keep only last 20 notes to avoid unbounded growth
  if (state.progressNotes.length > 20) {
    state.progressNotes = state.progressNotes.slice(-20);
  }
}

export function getAutoSnapshot() {
  var snapshot = Object.assign({}, state.customState);
  if (state.claimedItem) snapshot.claimed_item = state.claimedItem;
  if (state.currentStep) snapshot.current_step = state.currentStep;
  if (state.progressNotes.length) snapshot.progress = state.progressNotes;
  return snapshot;
}

export async function sendHeartbeat() {
  if (!state.agentId) return;
  try {
    var body = {
      status: 'online',
      working_on: state.workingOn,
      session_id: state.sessionId,
      messages_acked: JSON.stringify(state.messagesAcked),
      state_snapshot: JSON.stringify(getAutoSnapshot())
    };
    // Admin mode: include agent_id so server attributes heartbeat correctly
    if (state.role !== 'agent') body.agent_id = state.agentId;
    var result = await apiPost('/agents/heartbeat', body);
    // Surface inbox from heartbeat response — store for next tool call
    if (result && result.inbox) {
      var inbox = result.inbox;
      var hasContent = (inbox.directives && inbox.directives.length > 0) ||
        (inbox.requests && inbox.requests.length > 0) ||
        (inbox.messages && inbox.messages.length > 0);
      if (hasContent) {
        state.pendingInbox = inbox;
        process.stderr.write('[mycelium] ' + (result.pending || 0) + ' unread item(s) queued for next tool response\n');
      }
    }
    // Surface approvals from heartbeat response
    if (result && result.approvals && result.approvals.length > 0) {
      if (!state.pendingInbox) state.pendingInbox = {};
      state.pendingInbox.approvals = result.approvals;
    }
  } catch (e) {
    process.stderr.write('Heartbeat failed: ' + e.message + '\n');
  }
}

export function setMcpServer(mcpServer) {
  state.mcpServer = mcpServer;
}

export function startHeartbeat(mcpServer) {
  if (!state.agentId) return;
  if (mcpServer) state.mcpServer = mcpServer;
  stopHeartbeat();
  // Heartbeat every 5 minutes (boot already marks agent online — no need to send immediately)
  state.heartbeatTimer = setInterval(sendHeartbeat, 5 * 60 * 1000);
  // Send one immediately
  sendHeartbeat();
  // Start SSE subscription — pass server so sleep_mode_on can wake this session
  startSSE(null, state.mcpServer);
}

export function stopHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

export async function shutdown() {
  stopHeartbeat();
  stopSSE();
  if (state.agentId) {
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
      var offlineBody = { status: 'offline', working_on: '' };
      if (state.role !== 'agent') offlineBody.agent_id = state.agentId;
      await apiPost('/agents/heartbeat', offlineBody);
    } catch { /* best effort */ }
  }
}
