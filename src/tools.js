// All MCP tool registrations for the Mycelium API (formerly Dioverse Studio)
// Tools are registered as mycelium_* (primary) with studio_* aliases.

import { z } from 'zod';
import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { getState, setWorkingOn, setBooted, startHeartbeat, sendHeartbeat } from './state.js';

function text(s) {
  return { content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] };
}

// Register a tool under both mycelium_* (primary) and studio_* (alias) names
function registerDual(server, studioName, description, schema, handler) {
  var myceliumName = studioName.replace(/^studio_/, 'mycelium_');
  server.tool(myceliumName, description, schema, handler);
  server.tool(studioName, description, schema, handler);
}

function timeAgo(iso) {
  if (!iso) return 'never';
  var ms = Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime();
  if (ms < 60000) return Math.round(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm ago';
  if (ms < 86400000) return Math.round(ms / 3600000) + 'h ago';
  return Math.round(ms / 86400000) + 'd ago';
}

function formatAgent(a) {
  var line = (a.status === 'online' ? '[ON] ' : '[OFF] ') + a.name + ' (' + a.id + ')';
  if (a.project) line += ' — ' + a.project;
  else if (a.game) line += ' — ' + a.game;
  if (a.working_on) line += '\n  Working on: ' + a.working_on;
  line += '\n  Heartbeat: ' + timeAgo(a.last_heartbeat);
  return line;
}

function formatTask(t) {
  return '#' + t.id + ' [' + t.status + '] ' + t.title +
    (t.assignee ? ' (→ ' + t.assignee + ')' : '') +
    (t.priority && t.priority !== 'normal' ? ' [' + t.priority + ']' : '');
}

function formatMessage(m) {
  var tag = m.msg_type === 'request' ? '[REQ] ' : '';
  return tag + m.from_agent + ' → ' + (m.to_agent || 'all') + ': ' + m.content +
    ' (' + timeAgo(m.created_at) + ')' +
    (m.status !== 'sent' ? ' [' + m.status + ']' : '');
}

function formatBug(b) {
  var proj = b.project || b.game;
  return '#' + b.id + ' [' + b.severity + '] ' + b.title +
    ' (' + proj + ', ' + b.status + ')' +
    (b.assignee ? ' → ' + b.assignee : '');
}

function formatPlan(p) {
  var lines = ['Plan #' + p.id + ' [' + p.status + '] ' + p.title];
  if (p.steps && p.steps.length) {
    for (var s of p.steps) {
      lines.push('  Step #' + s.id + ' [' + s.status + '] ' + s.title +
        (s.assignee ? ' → ' + s.assignee : ''));
    }
  }
  return lines.join('\n');
}

export function registerTools(server) {

  // ===== SESSION =====

  registerDual(server,
    'studio_boot',
    'Boot agent session or get admin overview. Agent mode: starts auto-heartbeat, returns tasks/messages/plans. Admin mode: returns full dashboard.',
    {},
    async () => {
      var st = getState();
      if (st.role === 'agent' && st.agentId) {
        var data = await apiGet('/boot/' + st.agentId);
        setBooted(data);
        startHeartbeat();
        var proj = data.agent.project || data.agent.game;
        var lines = ['Booted as ' + st.agentId + ' (' + proj + ')', ''];

        if (data.tasks.length) {
          lines.push('=== My Tasks (' + data.tasks.length + ') ===');
          for (var t of data.tasks) lines.push(formatTask(t));
          lines.push('');
        }

        if (data.pending_requests.length) {
          lines.push('=== Pending Requests (' + data.pending_requests.length + ') ===');
          for (var r of data.pending_requests) lines.push(formatMessage(r));
          lines.push('');
        }

        if (data.new_messages.length) {
          lines.push('=== New Messages (' + data.new_messages.length + ') ===');
          for (var m of data.new_messages) lines.push(formatMessage(m));
          lines.push('');
        }

        if (data.plans && data.plans.length) {
          lines.push('=== Active Plans ===');
          for (var p of data.plans) lines.push(formatPlan(p));
          lines.push('');
        }

        if (data.open_bugs && data.open_bugs.length) {
          lines.push('=== Open Bugs (' + data.open_bugs.length + ') ===');
          for (var b of data.open_bugs) lines.push(formatBug(b));
          lines.push('');
        }

        lines.push('=== Other Agents ===');
        for (var a of (data.other_agents || [])) lines.push(formatAgent(a));

        lines.push('', 'Auto-heartbeat started (every 5m). Server time: ' + data.server_time);
        return text(lines.join('\n'));
      }

      // Admin mode
      var overview = await apiGet('/admin/overview');
      return text(formatOverview(overview));
    }
  );

  registerDual(server,
    'studio_overview',
    'Get full Mycelium dashboard snapshot: agents, tasks, messages, plans, bugs.',
    {},
    async () => {
      var data = await apiGet('/admin/overview');
      return text(formatOverview(data));
    }
  );

  // ===== TASKS =====

  registerDual(server,
    'studio_get_work',
    'Get prioritized work list: plan steps first, then assigned tasks, then open bugs. Use this to figure out what to work on next.',
    {},
    async () => {
      var st = getState();
      var lines = [];

      if (st.role === 'agent' && st.agentId) {
        var data = await apiGet('/boot/' + st.agentId);
        setBooted(data);

        // 1. Plan steps assigned to me
        var mySteps = [];
        for (var p of (data.plans || [])) {
          for (var s of (p.steps || [])) {
            if (s.assignee === st.agentId && s.status !== 'completed') {
              mySteps.push({ plan: p.title, planId: p.id, step: s });
            }
          }
        }
        if (mySteps.length) {
          lines.push('=== Plan Steps (Priority 1) ===');
          for (var ms of mySteps) {
            lines.push('Plan #' + ms.planId + ' "' + ms.plan + '" → Step #' + ms.step.id +
              ' [' + ms.step.status + '] ' + ms.step.title);
          }
          lines.push('');
        }

        // 2. My tasks
        if (data.tasks.length) {
          lines.push('=== Assigned Tasks (Priority 2) ===');
          for (var t of data.tasks) lines.push(formatTask(t));
          lines.push('');
        }

        // 3. Open bugs for my project
        if (data.open_bugs && data.open_bugs.length) {
          lines.push('=== Open Bugs (Priority 3) ===');
          for (var b of data.open_bugs) lines.push(formatBug(b));
          lines.push('');
        }

        // 4. Pending requests
        if (data.pending_requests.length) {
          lines.push('=== Pending Requests (respond to these) ===');
          for (var r of data.pending_requests) lines.push(formatMessage(r));
          lines.push('');
        }

        if (!lines.length) lines.push('No work items found. You are idle.');
        return text(lines.join('\n'));
      }

      // Admin: show all open work
      var overview = await apiGet('/admin/overview');
      var tasks = overview.tasks || {};
      var allTasks = [].concat(tasks.open || [], tasks.in_progress || [], tasks.review || []);
      if (allTasks.length) {
        lines.push('=== All Open Tasks (' + allTasks.length + ') ===');
        for (var t2 of allTasks) lines.push(formatTask(t2));
        lines.push('');
      }
      if (overview.approval_queue && overview.approval_queue.length) {
        lines.push('=== Approval Queue (' + overview.approval_queue.length + ') ===');
        for (var aq of overview.approval_queue) lines.push(formatTask(aq));
        lines.push('');
      }
      if (!lines.length) lines.push('No open work items.');
      return text(lines.join('\n'));
    }
  );

  registerDual(server,
    'studio_claim_task',
    'Claim a task: assigns it to you, sets status to in_progress, and updates your working_on status automatically.',
    { task_id: z.number().describe('Task ID to claim') },
    async (args) => {
      var st = getState();
      var assignee = st.agentId || '__admin__';

      // Get task details first
      var task = await apiGet('/tasks/' + args.task_id);
      await apiPut('/tasks/' + args.task_id, { assignee: assignee, status: 'in_progress' });

      // Auto-update working_on
      setWorkingOn(task.title);
      if (st.role === 'agent') await sendHeartbeat();

      return text('Claimed task #' + args.task_id + ': ' + task.title + '\nworking_on updated to: "' + task.title + '"');
    }
  );

  registerDual(server,
    'studio_complete_task',
    'Mark a task as done. Automatically advances working_on to next task or clears it if no more work.',
    {
      task_id: z.number().describe('Task ID to complete'),
      notes: z.string().optional().describe('Optional completion notes')
    },
    async (args) => {
      var st = getState();
      var update = { status: 'done' };
      if (args.notes) update.description = args.notes;
      await apiPut('/tasks/' + args.task_id, update);

      // Find next task
      var nextWork = '';
      if (st.role === 'agent' && st.agentId) {
        try {
          var boot = await apiGet('/boot/' + st.agentId);
          if (boot.tasks.length) {
            nextWork = boot.tasks[0].title;
          }
        } catch { /* ignore */ }
      }

      setWorkingOn(nextWork);
      if (st.role === 'agent') await sendHeartbeat();

      var msg = 'Completed task #' + args.task_id + '.';
      if (nextWork) msg += '\nworking_on advanced to: "' + nextWork + '"';
      else msg += '\nworking_on cleared (no more tasks).';
      return text(msg);
    }
  );

  registerDual(server,
    'studio_create_task',
    'Create a new task on the board.',
    {
      title: z.string().describe('Task title'),
      description: z.string().describe('Task description'),
      game: z.string().describe('Project: willing-sacrifice, king-city, or dioverse'),
      priority: z.enum(['low', 'normal', 'high']).optional().describe('Priority level'),
      assignee: z.string().optional().describe('Agent ID to assign to'),
      needs_approval: z.boolean().optional().describe('Whether task needs admin approval before work starts')
    },
    async (args) => {
      var st = getState();
      var body = {
        title: args.title,
        description: args.description,
        game: args.game,
        priority: args.priority || 'normal',
        requester: st.agentId || '__admin__'
      };
      if (args.assignee) body.assignee = args.assignee;
      if (args.needs_approval) body.needs_approval = 1;
      var result = await apiPost('/tasks', body);
      return text('Created task #' + result.id + ': ' + args.title);
    }
  );

  // ===== COMMUNICATION =====

  registerDual(server,
    'studio_send_message',
    'Send a message to an agent or broadcast to all.',
    {
      content: z.string().describe('Message content'),
      to: z.string().optional().describe('Agent ID to send to (omit for broadcast)'),
      game: z.string().optional().describe('Project context')
    },
    async (args) => {
      var st = getState();
      var body = {
        content: args.content,
        from_agent: st.agentId || '__admin__'
      };
      if (args.to) body.to_agent = args.to;
      if (args.game) body.game = args.game;
      var result = await apiPost('/messages', body);
      return text('Message sent (id: ' + result.id + ') to ' + (args.to || 'all'));
    }
  );

  registerDual(server,
    'studio_send_request',
    'Send a blocking request to an agent. They must respond before you can continue.',
    {
      content: z.string().describe('What you need from them'),
      to: z.string().describe('Agent ID to request from'),
      auto_task: z.boolean().optional().describe('Auto-create a task for this request'),
      game: z.string().optional().describe('Project context')
    },
    async (args) => {
      var st = getState();
      var body = {
        content: args.content,
        to_agent: args.to,
        from_agent: st.agentId || '__admin__'
      };
      if (args.auto_task) body.auto_task = true;
      if (args.game) body.game = args.game;
      var result = await apiPost('/requests', body);
      return text('Request sent (id: ' + result.id + ') to ' + args.to +
        (result.task_id ? '\nAuto-created task #' + result.task_id : ''));
    }
  );

  registerDual(server,
    'studio_respond_to_request',
    'Respond to a pending request, resolving it.',
    {
      request_id: z.number().describe('Request/message ID to respond to'),
      response: z.string().describe('Your response')
    },
    async (args) => {
      await apiPut('/messages/' + args.request_id + '/resolve', { response: args.response });
      return text('Request #' + args.request_id + ' resolved.');
    }
  );

  registerDual(server,
    'studio_read_messages',
    'Read recent messages and pending requests.',
    {
      since: z.string().optional().describe('ISO timestamp to filter messages from'),
      from: z.string().optional().describe('Filter by sender agent ID'),
      limit: z.number().optional().describe('Max messages to return (default 30)')
    },
    async (args) => {
      var params = [];
      if (args.since) params.push('since=' + encodeURIComponent(args.since));
      if (args.from) params.push('from=' + encodeURIComponent(args.from));
      if (args.limit) params.push('limit=' + args.limit);
      var qs = params.length ? '?' + params.join('&') : '';
      var messages = await apiGet('/messages' + qs);
      if (!messages.length) return text('No messages found.');
      var lines = messages.map(formatMessage);
      return text(lines.join('\n'));
    }
  );

  // ===== PLANS =====

  registerDual(server,
    'studio_check_plans',
    'View active plans and their steps.',
    {
      game: z.string().optional().describe('Filter by project'),
      status: z.string().optional().describe('Filter by status (default: active)')
    },
    async (args) => {
      var params = [];
      if (args.game) params.push('game=' + encodeURIComponent(args.game));
      params.push('status=' + (args.status || 'active'));
      var plans = await apiGet('/plans?' + params.join('&'));
      if (!plans.length) return text('No plans found.');

      var lines = [];
      for (var p of plans) {
        // Fetch full plan with steps
        var full = await apiGet('/plans/' + p.id);
        lines.push(formatPlan(full));
        lines.push('');
      }
      return text(lines.join('\n'));
    }
  );

  registerDual(server,
    'studio_update_step',
    'Update a plan step status, assignee, or linked resources.',
    {
      plan_id: z.number().describe('Plan ID'),
      step_id: z.number().describe('Step ID'),
      status: z.string().optional().describe('New status: pending, in_progress, completed, blocked'),
      assignee: z.string().optional().describe('Agent ID to assign step to'),
      linked_task_id: z.number().optional().describe('Link to a task ID'),
      linked_branch: z.string().optional().describe('Git branch name')
    },
    async (args) => {
      var body = {};
      if (args.status) body.status = args.status;
      if (args.assignee) body.assignee = args.assignee;
      if (args.linked_task_id) body.linked_task_id = args.linked_task_id;
      if (args.linked_branch) body.linked_branch = args.linked_branch;
      await apiPut('/plans/' + args.plan_id + '/steps/' + args.step_id, body);
      return text('Updated step #' + args.step_id + ' on plan #' + args.plan_id);
    }
  );

  // ===== CONTEXT =====

  registerDual(server,
    'studio_get_context',
    'Read context keys from namespaced storage.',
    {
      namespace: z.string().describe('Namespace (e.g. agent name, project name)'),
      key: z.string().optional().describe('Specific key to read (omit for all keys in namespace)')
    },
    async (args) => {
      if (args.key) {
        var val = await apiGet('/context/keys/' + encodeURIComponent(args.namespace) + '/' + encodeURIComponent(args.key));
        return text(val);
      }
      var keys = await apiGet('/context/keys/' + encodeURIComponent(args.namespace));
      return text(keys);
    }
  );

  registerDual(server,
    'studio_set_context',
    'Store a value in namespaced context storage. Persists across sessions.',
    {
      namespace: z.string().describe('Namespace'),
      key: z.string().describe('Key name'),
      data: z.string().describe('Value to store (string or JSON string)')
    },
    async (args) => {
      await apiPut('/context/keys/' + encodeURIComponent(args.namespace) + '/' + encodeURIComponent(args.key), {
        data: args.data
      });
      return text('Saved context: ' + args.namespace + '/' + args.key);
    }
  );

  // ===== BUGS =====

  registerDual(server,
    'studio_list_bugs',
    'List bug reports.',
    {
      game: z.string().optional().describe('Filter by project'),
      status: z.string().optional().describe('Filter by status: open, in_progress, fixed, closed')
    },
    async (args) => {
      var params = [];
      if (args.game) params.push('game=' + encodeURIComponent(args.game));
      if (args.status) params.push('status=' + encodeURIComponent(args.status));
      var qs = params.length ? '?' + params.join('&') : '';
      var bugs = await apiGet('/bugs' + qs);
      if (!bugs.length) return text('No bugs found.');
      return text(bugs.map(formatBug).join('\n'));
    }
  );

  registerDual(server,
    'studio_claim_bug',
    'Claim a bug and start working on it. Updates your working_on status.',
    { bug_id: z.number().describe('Bug ID to claim') },
    async (args) => {
      var st = getState();
      var bug = await apiGet('/bugs/' + args.bug_id);
      await apiPut('/bugs/' + args.bug_id, {
        status: 'in_progress',
        assignee: st.agentId || '__admin__'
      });
      setWorkingOn('Bug #' + args.bug_id + ': ' + bug.title);
      if (st.role === 'agent') await sendHeartbeat();
      return text('Claimed bug #' + args.bug_id + ': ' + bug.title);
    }
  );

  registerDual(server,
    'studio_fix_bug',
    'Mark a bug as fixed. Clears working_on if no other work.',
    {
      bug_id: z.number().describe('Bug ID to mark fixed'),
      notes: z.string().optional().describe('Fix notes')
    },
    async (args) => {
      var update = { status: 'fixed' };
      if (args.notes) update.admin_notes = args.notes;
      await apiPut('/bugs/' + args.bug_id, update);

      // Check for remaining work
      var st = getState();
      var nextWork = '';
      if (st.role === 'agent' && st.agentId) {
        try {
          var boot = await apiGet('/boot/' + st.agentId);
          if (boot.tasks.length) nextWork = boot.tasks[0].title;
        } catch { /* ignore */ }
      }
      setWorkingOn(nextWork);
      if (st.role === 'agent') await sendHeartbeat();
      return text('Bug #' + args.bug_id + ' marked fixed.' +
        (nextWork ? '\nworking_on: "' + nextWork + '"' : '\nworking_on cleared.'));
    }
  );

  // ===== HEARTBEAT =====

  registerDual(server,
    'studio_heartbeat',
    'Manually update your working_on status and send a heartbeat.',
    {
      working_on: z.string().describe('What you are currently working on (empty string to clear)')
    },
    async (args) => {
      setWorkingOn(args.working_on);
      if (getState().role === 'agent') {
        await sendHeartbeat();
        return text('Heartbeat sent. working_on: "' + args.working_on + '"');
      }
      return text('working_on set locally: "' + args.working_on + '" (admin mode — no heartbeat sent)');
    }
  );

  // ===== CONCEPTS =====

  registerDual(server,
    'studio_list_concepts',
    'List shared concepts (characters, styles, rulesets, etc). Optionally filter by type.',
    {
      type: z.enum(['character', 'style', 'ruleset', 'library', 'brand', 'custom']).optional().describe('Filter by concept type')
    },
    async (args) => {
      var qs = args.type ? '?type=' + encodeURIComponent(args.type) : '';
      var concepts = await apiGet('/concepts' + qs);
      if (!concepts.length) return text('No concepts found.');
      var lines = ['=== Concepts (' + concepts.length + ') ==='];
      for (var c of concepts) {
        lines.push('#' + c.id + ' [' + c.type + '] ' + c.name +
          (c.description ? ' — ' + c.description : ''));
      }
      return text(lines.join('\n'));
    }
  );

  registerDual(server,
    'studio_get_concept',
    'Get a single concept by ID, including linked projects.',
    {
      concept_id: z.string().describe('Concept ID')
    },
    async (args) => {
      var concept = await apiGet('/concepts/' + encodeURIComponent(args.concept_id));
      var lines = [
        'Concept #' + concept.id + ' [' + concept.type + ']',
        'Name: ' + concept.name,
        'Description: ' + (concept.description || '(none)')
      ];
      if (concept.data) {
        lines.push('Data: ' + (typeof concept.data === 'string' ? concept.data : JSON.stringify(concept.data, null, 2)));
      }
      if (concept.projects && concept.projects.length) {
        lines.push('');
        lines.push('Linked projects:');
        for (var p of concept.projects) {
          lines.push('  - ' + (p.name || p.id || p));
        }
      }
      return text(lines.join('\n'));
    }
  );

  registerDual(server,
    'studio_create_concept',
    'Create a new shared concept (character, style, ruleset, library, brand, or custom).',
    {
      name: z.string().describe('Concept name'),
      type: z.enum(['character', 'style', 'ruleset', 'library', 'brand', 'custom']).describe('Concept type'),
      description: z.string().optional().describe('Short description'),
      data: z.string().optional().describe('JSON string of additional concept data')
    },
    async (args) => {
      var body = { name: args.name, type: args.type };
      if (args.description) body.description = args.description;
      if (args.data) body.data = JSON.parse(args.data);
      var result = await apiPost('/concepts', body);
      return text('Created concept #' + result.id + ': ' + args.name + ' [' + args.type + ']');
    }
  );

  registerDual(server,
    'studio_update_concept',
    'Update an existing concept (name, description, data, or type).',
    {
      concept_id: z.string().describe('Concept ID to update'),
      name: z.string().optional().describe('New name'),
      type: z.enum(['character', 'style', 'ruleset', 'library', 'brand', 'custom']).optional().describe('New type'),
      description: z.string().optional().describe('New description'),
      data: z.string().optional().describe('JSON string of updated concept data')
    },
    async (args) => {
      var body = {};
      if (args.name) body.name = args.name;
      if (args.type) body.type = args.type;
      if (args.description) body.description = args.description;
      if (args.data) body.data = JSON.parse(args.data);
      await apiPut('/concepts/' + encodeURIComponent(args.concept_id), body);
      return text('Updated concept #' + args.concept_id);
    }
  );

  registerDual(server,
    'studio_link_concept',
    'Link a concept to a project so it is shared across that project.',
    {
      concept_id: z.string().describe('Concept ID to link'),
      project: z.string().describe('Project ID to link the concept to')
    },
    async (args) => {
      await apiPost('/concepts/' + encodeURIComponent(args.concept_id) + '/link', { project: args.project });
      return text('Linked concept #' + args.concept_id + ' to project ' + args.project);
    }
  );

  // ===== RAW API =====

  registerDual(server,
    'studio_api',
    'Raw API call to any Mycelium endpoint. Use for operations not covered by other tools.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).describe('HTTP method'),
      path: z.string().describe('API path (e.g. /tasks, /agents/greatness-claude)'),
      body: z.string().optional().describe('JSON body string for POST/PUT')
    },
    async (args) => {
      var parsed = args.body ? JSON.parse(args.body) : undefined;
      var fn = { GET: apiGet, POST: apiPost, PUT: apiPut, DELETE: apiDelete }[args.method];
      var result = await fn(args.path, parsed);
      return text(result);
    }
  );
}

function formatOverview(data) {
  var lines = [];
  var agents = data.agents || [];
  lines.push('=== Agents (' + agents.length + ') ===');
  for (var a of agents) lines.push(formatAgent(a));
  lines.push('');

  var tasks = data.tasks || {};
  var open = tasks.open || [];
  var inProg = tasks.in_progress || [];
  var review = tasks.review || [];
  var done = tasks.done || [];
  lines.push('=== Tasks: ' + open.length + ' open, ' + inProg.length + ' in-progress, ' +
    review.length + ' review, ' + done.length + ' recently done ===');
  for (var t of [].concat(open, inProg, review)) lines.push(formatTask(t));
  lines.push('');

  var plans = data.plans || [];
  if (plans.length) {
    lines.push('=== Plans (' + plans.length + ') ===');
    for (var p of plans) {
      lines.push('Plan #' + p.id + ' [' + p.status + '] ' + p.title);
    }
    lines.push('');
  }

  var msgs = data.messages || [];
  var pending = msgs.filter(function (m) { return m.msg_type === 'request' && m.status !== 'completed' && m.status !== 'resolved'; });
  if (pending.length) {
    lines.push('=== Pending Requests (' + pending.length + ') ===');
    for (var r of pending) lines.push(formatMessage(r));
    lines.push('');
  }

  var bugs = data.bugs || [];
  var openBugs = bugs.filter(function (b) { return b.status === 'open' || b.status === 'in_progress'; });
  if (openBugs.length) {
    lines.push('=== Open Bugs (' + openBugs.length + ') ===');
    for (var b of openBugs) lines.push(formatBug(b));
    lines.push('');
  }

  var aq = data.approval_queue || [];
  if (aq.length) {
    lines.push('=== Approval Queue (' + aq.length + ') ===');
    for (var q of aq) lines.push(formatTask(q));
    lines.push('');
  }

  return lines.join('\n');
}
