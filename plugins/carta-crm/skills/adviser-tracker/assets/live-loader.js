// Loads the stored adviser tracker page from crm-api when the page opens, and shows what state it is in.
// The page reads through crm_read_tool only. A read never waits on a build: a missing page answers
// `building` and this script asks again.
(function (root) {
  'use strict';

  var GATEWAY_TOOL = 'crm_read_tool';
  var PAGE_TOOL = 'crm:get_adviser_tracker_page';
  var CONNECTOR_META = 'carta-connector';
  var DEFAULT_CONNECTOR = 'Carta';
  // A build takes about 30 s, so a short wait shows the page within a couple of seconds of it finishing.
  var POLL_MS = 2000;
  var MAX_POLLS = 300;
  // The one stamp for every call this page makes: it marks a call as issued by the page, not the model.
  var INSTRUMENTATION = { skills: [], from_ui: true };
  var STATES = ['ready', 'building', 'failed', 'not_configured'];
  var NOT_SET_UP = /unknown tool|tool not found|not available|not registered|no such tool/i;
  var CODE_MESSAGES = {
    needs_reauth: 'Reconnect Carta in Settings, then reload this page.',
    server_not_connected: 'Add the Carta connector in Settings, then reload this page.',
    selection_required: 'More than one Carta connector matches. Choose one in Settings.',
    server_not_found: 'This page names a Carta connector you do not have.',
    not_granted: 'This page is not allowed to read your CRM. It has to be published again.',
    not_in_manifest: 'This page is not allowed to read your CRM. It has to be published again.',
    blocked_by_policy: 'Your organization blocks this connector.',
    approval_required: 'Approve the connector request, then reload this page.'
  };
  var FALLBACK_MESSAGE = 'Carta did not answer. Reload this page to try again.';

  function parseJson(text) {
    try { var value = JSON.parse(text); return value !== null && typeof value === 'object' ? value : null; } catch (e) { return null; }
  }

  function textOf(result) {
    var blocks = result && Array.isArray(result.content) ? result.content : [];
    for (var i = 0; i < blocks.length; i++) if (blocks[i] && blocks[i].type === 'text' && blocks[i].text) return blocks[i].text;
    return null;
  }

  function payloadOf(result) {
    var structured = result && result.structuredContent;
    if (structured && typeof structured === 'object') {
      var keys = Object.keys(structured);
      if (keys.length === 1 && keys[0] === 'result' && typeof structured.result === 'string') return parseJson(structured.result);
      return structured;
    }
    var text = textOf(result);
    return text ? parseJson(text) : null;
  }

  // The state a tool result stands for. Prose means the tool is not offered or the call failed.
  function resolveState(result) {
    var payload = payloadOf(result);
    if (payload && STATES.indexOf(payload.state) >= 0) return payload;
    var text = textOf(result);
    if (text && NOT_SET_UP.test(text)) return { state: 'not_configured' };
    return { state: 'failed', error: text || 'no_answer' };
  }

  function failureOf(error) {
    var code = error && typeof error.code === 'string' ? error.code : null;
    if (code === 'tool_error' && error.message) return resolveState({ content: [{ type: 'text', text: error.message }] });
    return { state: 'failed', error: CODE_MESSAGES[code] || FALLBACK_MESSAGE };
  }

  function connectorName(doc) {
    var meta = doc.querySelector('meta[name="' + CONNECTOR_META + '"]');
    var named = meta && meta.getAttribute('content');
    return (named && named.trim()) || DEFAULT_CONNECTOR;
  }

  function fetchPage(mcp, server) {
    return mcp.callTool(server, GATEWAY_TOOL, { name: PAGE_TOOL, arguments: {}, _instrumentation_v2: INSTRUMENTATION })
      .then(resolveState, failureOf);
  }

  // The Mandate view's one line naming the deal field it counts through. The server's answer leaves out
  // a null field, so a missing bankField means no field qualifies.
  function fieldNotice(page) {
    var field = page.bankField;
    if (field && typeof field.label === 'string' && field.label) return 'Deals are counted through the ' + field.label + ' field.';
    return 'No bank field qualifies, so deals are counted from every company field.';
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var api = { resolveState: resolveState, failureOf: failureOf, connectorName: connectorName, fetchPage: fetchPage, fieldNotice: fieldNotice };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  var doc = root.document;
  var status = doc.getElementById('live-status');

  function show(title, message, withReload) {
    status.hidden = false;
    status.innerHTML = '';
    var box = doc.createElement('div');
    var heading = doc.createElement('h1');
    heading.textContent = title;
    var text = doc.createElement('p');
    text.textContent = message;
    box.appendChild(heading);
    box.appendChild(text);
    if (withReload) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.textContent = 'Try again';
      button.addEventListener('click', function () { root.location.reload(); });
      box.appendChild(button);
    }
    status.appendChild(box);
  }

  function showRefresh(asOf) {
    var chip = doc.getElementById('live-refresh');
    var when = new Date(asOf);
    chip.textContent = '';
    var label = doc.createElement('span');
    label.textContent = 'Updated ' + (isNaN(when.getTime()) ? asOf : when.toLocaleString()) + ' ';
    var button = doc.createElement('button');
    button.type = 'button';
    button.textContent = 'Refresh';
    button.addEventListener('click', function () { root.location.reload(); });
    chip.appendChild(label);
    chip.appendChild(button);
    chip.hidden = false;
  }

  function showReady(page) {
    var data = root.TrackerPageData.withMonograms(root.TrackerPageData.buildPageData(page.answer, String(page.asOf).slice(0, 10), fieldNotice(page)), page.answer);
    status.hidden = true;
    root.__startTracker(data);
    showRefresh(page.asOf);
  }

  function load(mcp, server, polls) {
    return fetchPage(mcp, server).then(function (page) {
      if (page.state === 'ready') return showReady(page);
      if (page.state === 'not_configured') {
        return show('Adviser tracker is not set up', 'The adviser tracker is not turned on for this organization yet. Ask a Carta admin to turn it on, then reload this page.', false);
      }
      if (page.state === 'failed') return show('The adviser tracker could not load', String(page.error || FALLBACK_MESSAGE), true);
      if (polls >= MAX_POLLS) return show('The adviser tracker is still building', 'It is taking longer than expected. Reload this page in a few minutes.', true);
      show('Building your adviser tracker', 'This takes about a minute the first time. This page updates by itself.', false);
      return sleep(POLL_MS).then(function () { return load(mcp, server, polls + 1); });
    });
  }

  function start() {
    show('Loading your adviser tracker', 'One moment.', false);
    var claude = root.claude;
    if (!claude || typeof claude.use !== 'function') return show('Cannot reach Carta', 'Open this page from claude.ai.', false);
    return claude.use('mcp').then(function (mcp) {
      if (!mcp) return show('Not allowed to read your CRM', 'Open this page from claude.ai.', false);
      return load(mcp, connectorName(doc), 0);
    }).catch(function (error) {
      show('The adviser tracker could not load', error && error.message ? String(error.message) : FALLBACK_MESSAGE, true);
    });
  }

  start();
})(typeof window !== 'undefined' ? window : this);
