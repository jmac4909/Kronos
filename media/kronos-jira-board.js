(function() {
  'use strict';

  function findKronosJiraBoardScript() {
    var current = document.currentScript;
    if (current && typeof current.getAttribute === 'function') { return current; }
    if (typeof document.getElementById === 'function') {
      var byId = document.getElementById('kronos-jira-board-script');
      if (byId && typeof byId.getAttribute === 'function') { return byId; }
    }
    if (typeof document.querySelector === 'function') { return document.querySelector('script[data-kronos-script-kind="jira-board"]'); }
    return null;
  }

  var script = findKronosJiraBoardScript();
  var webviewName = script && script.getAttribute('data-kronos-webview-name') || 'Kronos Jira Board';
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var readyPosted = false;
  var currentModalKey = '';
  var lastFocusedEl = null;
  var ticketData = {};

  function kronosFallbackVsCodeApi() {
    return { __kronosFallbackVsCodeApi: true, postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };
  }

  function kronosVsCodeApi() {
    var cacheKey = Symbol.for('kronos.vscodeApi');
    var root = typeof globalThis === 'object' ? globalThis : window;
    var cached = root[cacheKey];
    if (cached && typeof cached.postMessage === 'function' && !cached.__kronosFallbackVsCodeApi) { return cached; }
    if (typeof acquireVsCodeApi !== 'function') {
      return kronosFallbackVsCodeApi();
    }
    try {
      root[cacheKey] = acquireVsCodeApi();
      return root[cacheKey];
    } catch (error) {
      console.error('Failed to acquire VS Code API for Kronos webview action', error);
      return kronosFallbackVsCodeApi();
    }
  }

  function kronosErrorText(value) {
    if (value && typeof value === 'object' && 'message' in value) { return String(value.message || value); }
    return String(value || 'unknown error');
  }

  function byId(id) { return document.getElementById(id); }

  function clearNode(el) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
  }

  function makeEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) { el.className = className; }
    if (text !== undefined) { el.textContent = String(text); }
    return el;
  }

  function makeButton(text, className, onClick) {
    var btn = document.createElement('button');
    btn.className = ['kronos-button', className || ''].join(' ').trim();
    btn.type = 'button';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function setText(id, value) {
    var el = byId(id);
    if (el) { el.textContent = value === undefined || value === null || value === '' ? '' : String(value); }
  }

  function post(command, payload) {
    kronosVsCodeApi().postMessage(Object.assign({ command: command }, payload || {}));
  }

  function showPlaceholder(el, text) {
    clearNode(el);
    if (el) { el.appendChild(makeEl('div', 'muted', text)); }
  }

  function formatStatus(value) {
    return String(value || '').replace(/_/g, ' ');
  }

  function formatAttachment(a) {
    var filename = String(a && a.filename || 'attachment');
    var size = Number(a && a.size || 0);
    var sizeLabel = size > 1024 ? Math.round(size / 1024) + 'KB' : size + 'B';
    return filename + ' (' + sizeLabel + ')';
  }

  function readTicketData() {
    var payload = byId('kronos-jira-ticket-data');
    if (!payload) { return {}; }
    var raw = 'value' in payload ? payload.value : payload.textContent;
    try {
      var parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { return parsed; }
    } catch (error) {
      console.warn('Kronos Jira Board could not parse ticket payload', error);
    }
    return {};
  }

  function markReady() {
    try {
      document.documentElement.setAttribute('data-kronos-script-ready', 'true');
      document.documentElement.setAttribute('data-kronos-webview', webviewName);
    } catch (error) {
      console.warn('Kronos webview could not mark script readiness', error);
    }
    console.info('Kronos webview script ready', webviewName, navigator.userAgent);
  }

  function postReady() {
    if (readyPosted || !readyCommand) { return; }
    try {
      var api = kronosVsCodeApi();
      if (api.__kronosFallbackVsCodeApi) { setTimeout(postReady, 50); return; }
      api.postMessage({
        command: readyCommand,
        webviewName: webviewName,
        userAgent: navigator.userAgent,
        readyState: document.readyState
      });
      readyPosted = true;
    } catch (error) {
      console.warn('Kronos webview could not post script readiness', error);
    }
  }

  function claimKronosJiraBoard() {
    var boardHandlerKey = '__kronosJiraBoardAttached';
    if (document[boardHandlerKey]) {
      try {
        document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
      } catch (error) {
        console.warn('Kronos Jira Board could not mark action readiness', error);
      }
      return false;
    }
    document[boardHandlerKey] = true;
    try {
      document.documentElement.setAttribute('data-kronos-jira-board-attached', 'true');
    } catch (error) {
      console.warn('Kronos Jira Board could not mark action handler attachment', error);
    }
    return true;
  }

  function showModal(key) {
    var t = ticketData[key];
    if (!t) { return; }
    lastFocusedEl = document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null;
    currentModalKey = key;
    setText('modal-key', key);
    setText('modal-summary', t.summary);
    setText('modal-meta', t.type + ' - ' + t.priority + ' - ' + t.status);
    setText('modal-desc', t.description || 'No description');
    setText('modal-projects', t.projects.length > 0 ? t.projects.join(', ') : 'Not linked');
    setText('modal-labels', t.labels.join(', ') || 'None');
    setText('modal-evidence', t.evidenceCount > 0 ? t.evidenceCount + ' item' + (t.evidenceCount === 1 ? '' : 's') : 'None');
    var mrEl = byId('modal-mr');
    clearNode(mrEl);
    if (mrEl && t.mr) {
      mrEl.appendChild(makeEl('span', '', 'MR !' + t.mr.iid + ' - ' + formatStatus(t.mr.status) + ' '));
      if (t.hasMrUrl) {
        var mrLink = makeEl('button', 'text-button clickable', 'Open in GitLab');
        mrLink.addEventListener('click', function() { post('openMr', { ticket: currentModalKey }); });
        mrEl.appendChild(mrLink);
      }
    } else if (mrEl) {
      mrEl.textContent = 'No MR';
    }
    setText('modal-build', t.build ? 'Build #' + t.build.number + ' - ' + t.build.status : 'No build');
    var attEl = byId('modal-attachments');
    clearNode(attEl);
    if (attEl && t.attachments && t.attachments.length > 0) {
      t.attachments.forEach(function(a) {
        attEl.appendChild(makeEl('span', 'attachment-item', formatAttachment(a)));
      });
    } else if (attEl) {
      attEl.textContent = 'None';
    }
    var actionsEl = byId('modal-actions');
    var hasProjects = t.projects.length > 0;
    clearNode(actionsEl);
    if (actionsEl && hasProjects) {
      actionsEl.appendChild(makeButton('Start Work', 'primary', function() { post('start', { ticket: currentModalKey }); closeModal(); }));
      actionsEl.appendChild(makeButton(t.isQueued ? 'Remove from Queue' : 'Add to Queue', '', function() {
        post(t.isQueued ? 'removeFromQueue' : 'addToQueueFromModal', { ticket: currentModalKey });
        closeModal();
      }));
    } else if (actionsEl) {
      actionsEl.appendChild(makeEl('span', 'modal-blocked-hint', 'Link to a project first to start or queue.'));
    }
    if (actionsEl) {
      actionsEl.appendChild(makeButton('Add Evidence', '', function() { post('addEvidence', { ticket: currentModalKey }); closeModal(); }));
      actionsEl.appendChild(makeButton('Add Check', '', function() { post('addEvidenceCheck', { ticket: currentModalKey }); closeModal(); }));
      actionsEl.appendChild(makeButton('Environment Result', '', function() { post('recordEnvironmentResult', { ticket: currentModalKey }); closeModal(); }));
      actionsEl.appendChild(makeButton('Export Evidence', '', function() { post('exportEvidence', { ticket: currentModalKey }); closeModal(); }));
      actionsEl.appendChild(makeButton('Handoff', '', function() { post('evidenceHandoff', { ticket: currentModalKey }); closeModal(); }));
      actionsEl.appendChild(makeButton('Publish Evidence', '', function() { post('publishEvidence', { ticket: currentModalKey }); closeModal(); }));
      if (t.hasJiraUrl) {
        var jiraBtn = makeEl('button', 'kronos-button jira-action clickable', 'Open in Jira');
        jiraBtn.type = 'button';
        jiraBtn.addEventListener('click', function() { post('openJira', { ticket: currentModalKey }); });
        actionsEl.appendChild(jiraBtn);
      }
    }
    showPlaceholder(byId('modal-comments'), 'Loading comments...');
    post('getComments', { ticket: key });
    var overlay = byId('modal-overlay');
    var closeButton = byId('modal-close');
    if (overlay) { overlay.classList.add('show'); }
    if (closeButton) { closeButton.focus(); }
  }

  function closeModal() {
    var overlay = byId('modal-overlay');
    if (overlay) { overlay.classList.remove('show'); }
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function' && document.contains(lastFocusedEl)) {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
  }

  function applyBoardFilter() {
    var input = byId('board-filter');
    var query = input ? String(input.value || '').trim().toLowerCase() : '';
    var totalVisible = 0;
    var totalCards = 0;
    document.querySelectorAll('.column').forEach(function(column) {
      var visible = 0;
      column.querySelectorAll('.card[data-ticket]').forEach(function(card) {
        totalCards += 1;
        var search = String(card.getAttribute('data-search') || '');
        var match = !query || search.indexOf(query) >= 0;
        card.hidden = !match;
        if (match) { visible += 1; }
      });
      totalVisible += visible;
      var count = column.querySelector('[data-count]');
      if (count) { count.textContent = String(visible); }
      var empty = column.querySelector('[data-empty]');
      if (empty) { empty.textContent = query ? 'No matching tickets.' : 'No tickets.'; }
      column.classList.toggle('filtered-empty', visible === 0);
    });
    var summary = byId('board-filter-summary');
    if (summary) {
      summary.textContent = query ? totalVisible + ' of ' + totalCards + ' visible' : totalCards + ' total';
    }
  }

  function closestBoardTarget(target, selector) {
    if (!target) { return null; }
    if (typeof target.closest === 'function') {
      return target.closest(selector);
    }
    var current = target.parentElement && typeof target.parentElement === 'object' ? target.parentElement : null;
    while (current) {
      if (typeof current.matches === 'function' && current.matches(selector)) { return current; }
      current = current.parentElement && typeof current.parentElement === 'object' ? current.parentElement : null;
    }
    return null;
  }

  function handleBoardClick(e) {
    var target = e && e.target;
    var actionEl = closestBoardTarget(target, '[data-action]');
    if (actionEl) {
      if (typeof e.stopPropagation === 'function') { e.stopPropagation(); }
      var ticket = actionEl.getAttribute('data-ticket') || currentModalKey;
      var project = actionEl.getAttribute('data-project') || '';
      var action = actionEl.getAttribute('data-action');
      if (action === 'link' || action === 'unlink') {
        post(action, { ticket: ticket, project: project });
      } else if (action === 'addToQueue' || action === 'removeFromQueue' || action === 'start' || action === 'openJira' || action === 'openMr') {
        post(action, { ticket: ticket });
      }
      return;
    }
    var card = closestBoardTarget(target, '.card[data-ticket]');
    if (card) {
      showModal(card.getAttribute('data-ticket') || '');
    }
  }

  function normalizeCommentsPayload(raw) {
    var comments = raw;
    if (typeof comments === 'string') {
      try {
        comments = JSON.parse(comments || '[]');
      } catch (error) {
        console.warn('Kronos Jira Board could not parse comments payload', error);
        return null;
      }
    }
    if (!Array.isArray(comments)) { return null; }
    return comments.slice(0, 100).map(function(comment) {
      if (comment && typeof comment === 'object') { return comment; }
      return { body: String(comment || '') };
    });
  }

  function attachBoardHandlers() {
    var board = document.querySelector('.board');
    if (!board) {
      console.error('Kronos Jira Board could not find board container.');
      return false;
    }
    board.addEventListener('click', handleBoardClick);
    board.addEventListener('keydown', function(e) {
      var target = e.target && typeof e.target.matches === 'function' ? e.target : null;
      if (!target || !target.matches('.card[data-ticket]')) { return; }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showModal(target.getAttribute('data-ticket') || '');
      }
    });
    var filter = byId('board-filter');
    if (filter) { filter.addEventListener('input', applyBoardFilter); }
    var overlay = byId('modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === this) { closeModal(); }
      });
    }
    var closeButton = byId('modal-close');
    if (closeButton) { closeButton.addEventListener('click', closeModal); }
    document.addEventListener('keydown', function(e) {
      var modal = byId('modal-overlay');
      if (e.key === 'Escape' && modal && modal.classList.contains('show')) {
        closeModal();
      }
    });
    return true;
  }

  function attachCommentHandler() {
    window.addEventListener('message', function(e) {
      var msg = e.data && typeof e.data === 'object' ? e.data : {};
      if (msg.command !== 'comments' || msg.ticket !== currentModalKey) { return; }
      var el = byId('modal-comments');
      if (msg.error) {
        showPlaceholder(el, String(msg.error));
        return;
      }
      var comments = normalizeCommentsPayload(msg.data);
      if (!comments) {
        showPlaceholder(el, 'Could not load comments');
        return;
      }
      if (comments.length === 0) {
        showPlaceholder(el, 'No comments');
        return;
      }
      clearNode(el);
      comments.forEach(function(c) {
        var row = makeEl('div', 'comment');
        row.appendChild(makeEl('span', 'author', c.author || c.authorName || 'Unknown'));
        row.appendChild(makeEl('span', 'date', c.created || ''));
        row.appendChild(makeEl('div', 'comment-body', c.body || ''));
        if (el) { el.appendChild(row); }
      });
    });
  }

  function initKronosJiraBoard() {
    if (!claimKronosJiraBoard()) {
      setTimeout(postReady, 0);
      return;
    }
    ticketData = readTicketData();
    if (!attachBoardHandlers()) { return; }
    attachCommentHandler();
    applyBoardFilter();
    document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
    setTimeout(postReady, 0);
  }

  markReady();
  window.addEventListener('error', function(event) {
    console.error('Kronos webview script error', webviewName, event.message, event.filename, event.lineno, event.colno);
  });
  window.addEventListener('unhandledrejection', function(event) {
    console.error('Kronos webview unhandled rejection', webviewName, kronosErrorText(event.reason));
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKronosJiraBoard);
  } else {
    initKronosJiraBoard();
  }
}());
