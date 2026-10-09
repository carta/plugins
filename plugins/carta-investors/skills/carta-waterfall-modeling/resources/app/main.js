// ── DOM wiring ──
function appRoot() { return typeof document !== 'undefined' ? document.getElementById('wf-app') : null; }

function render() {
  const root = appRoot();
  if (!root) return;
  const active = document.activeElement;
  const activeId = active && active.id && root.contains(active) ? active.id : null;
  const caret = activeId && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  root.innerHTML = renderApp();
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (caret !== null && el.setSelectionRange) { try { el.setSelectionRange(caret, caret); } catch (e) { /* not a text field */ } }
    }
  }
}

function toggleGroup(i) {
  const k = currentKey() + '|' + i;
  if (S.expanded[k]) delete S.expanded[k]; else S.expanded[k] = true;
}
function toggleAll() {
  const d = S.data[currentKey()];
  if (!d) return;
  const rows = visibleGroups(d).rows;
  const allOpen = rows.every(function (r) { return isOpen(r.i); });
  rows.forEach(function (r) {
    const k = currentKey() + '|' + r.i;
    if (allOpen) delete S.expanded[k]; else S.expanded[k] = true;
  });
}

function onClick(ev) {
  const t = ev.target && ev.target.closest ? ev.target : null;
  if (!t) return;
  const popOpen = S.filterOpen;
  if (popOpen && !t.closest('.wf-filter')) { S.filterOpen = false; render(); }
  const actionEl = t.closest('[data-action]');
  const action = actionEl && actionEl.getAttribute('data-action');
  if (action === 'expand-all') { toggleAll(); render();
  } else if (action === 'filter-toggle') { S.filterOpen = !S.filterOpen; S.filterSearch = ''; render();
  } else if (action === 'filter-reset') { S.filters = {}; S.filterSearch = ''; render();
  } else {
    const row = t.closest('[data-gi]');
    if (row && !t.closest('.wf-child')) { toggleGroup(Number(row.getAttribute('data-gi'))); render(); }
  }
}

function onChange(ev) {
  const t = ev.target;
  if (!t || !t.getAttribute) return;
  const action = t.getAttribute('data-action');
  if (action === 'entity') {
    S.nodeId = t.value; S.filterOpen = false; S.filterSearch = ''; render();
  } else if (t.hasAttribute('data-filter-id')) {
    const id = t.getAttribute('data-filter-id');
    if (t.checked) S.filters[id] = true; else delete S.filters[id];
    render();
  }
}

function onInput(ev) {
  const t = ev.target;
  if (t && t.id === 'wf-filter-search') {
    S.filterSearch = t.value;
    const d = S.data[currentKey()];
    const list = document.getElementById('wf-filter-list');
    if (d && list) list.innerHTML = renderFilterList(d);
  }
}

function onKey(ev) {
  if (ev.key === 'Escape' && S.filterOpen) { S.filterOpen = false; render(); }
}

loadEntities(CFG.entities);

(function boot() {
  const root = appRoot();
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  document.addEventListener('click', function (ev) {
    if (S.filterOpen && !(ev.target.closest && ev.target.closest('.wf-filter'))) { S.filterOpen = false; render(); }
  });
  document.addEventListener('keydown', onKey);
  render();
})();
