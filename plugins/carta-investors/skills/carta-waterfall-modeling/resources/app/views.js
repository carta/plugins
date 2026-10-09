// ── Page state and pure renderers (state in, HTML string out) ──
const S = {
  nodes: [],                 // [{node_id, label, is_root}] root first; one entry for a core run
  nodeId: null,
  data: {},                  // nodeId -> {allocations, grand_totals}
  filters: {},               // {groupKey: true}; kept when the entity changes
  filterOpen: false,
  filterSearch: '',
  expanded: {},              // `${nodeId}|${groupIndex}` -> true
};

function currentKey() { return S.nodeId; }

// The baked entities arrive root first. Names fall back to "Entity N" by position.
function loadEntities(entities) {
  S.nodes = [];
  S.data = {};
  (Array.isArray(entities) ? entities : []).forEach(function (e, i) {
    const id = String(i);
    S.nodes.push({ node_id: id, is_root: !!e.is_root, label: e.display_name ? e.display_name : 'Entity ' + (i + 1) });
    S.data[id] = { allocations: Array.isArray(e.allocations) ? e.allocations : [], grand_totals: e.grand_totals || null };
  });
  S.nodeId = S.nodes.length ? S.nodes[0].node_id : null;
}

// ── Filtering and totals ──

// What the filter and the filter list identify a row by: its holder.
function groupKey(g) {
  if (IS_CORE) return String(g.key != null ? g.key : (g.organization_name == null ? '' : g.organization_name));
  const first = (g.interest_allocations || [])[0];
  if (first && first.holder_id != null) return String(first.holder_id);
  return String(g.group_name == null ? '' : g.group_name);
}
function groupLabel(g) {
  return IS_CORE ? g.organization_name : g.group_name;
}

function filterItems(d) {
  const seen = {};
  const items = [];
  (d ? d.allocations : []).forEach(function (g) {
    const id = groupKey(g);
    if (seen[id]) return;
    seen[id] = true;
    items.push({ id: id, label: groupLabel(g) == null ? '' : String(groupLabel(g)) });
  });
  return items;
}

// Picking another entity keeps the filter, so an entity where none of the picked holders
// appear shows the empty state until "Reset all".
function selectedFilter() {
  const ids = {};
  Object.keys(S.filters).forEach(function (id) { if (S.filters[id]) ids[id] = true; });
  return ids;
}

// Rows in API order, narrowed by the filter. Filtering never reorders.
function visibleGroups(d) {
  const sel = selectedFilter();
  const n = Object.keys(sel).length;
  const rows = d.allocations.map(function (g, i) { return { g: g, i: i }; });
  return { rows: n ? rows.filter(function (r) { return sel[groupKey(r.g)]; }) : rows, filtered: n > 0, count: n };
}

// The Total row's proceeds: the sum of the proceeds that reached this entity.
function totalProceeds(d) {
  let sum = 0;
  d.allocations.forEach(function (g) {
    const p = num(g.allocated_proceeds && g.allocated_proceeds.proceeds);
    if (p !== null) sum += p;
  });
  return sum;
}

// ── Table pieces ──
function td(col, text, cls) {
  return '<td data-col="' + col + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + text + '</td>';
}

const NO_IC_TIP = 'No invested capital, so no multiple of its own. Its proceeds still count toward the row above.';

function niagaraChildRow(a) {
  const moic = num(a.moic);
  const noOwnMultiple = moic === null && num(a.invested_capital) === 0;
  const ap = a.allocated_proceeds || {};
  return '<tr class="wf-child">' +
    '<td></td>' +
    td('name', esc(a.type_name)) +
    td('label', esc(a.interest_label)) +
    td('proceeds', esc(fmtCurrency(ap.proceeds)), 'num') +
    td('pct', esc(fmtPercent(ap.percentage_of_total)), 'num') +
    td('moic', noOwnMultiple ? '<span class="wf-dash" title="' + esc(NO_IC_TIP) + '" tabindex="0">—</span>' : esc(fmtMoic(a.moic)), 'num') +
    td('invested', esc(fmtCurrency(a.invested_capital)), 'num') +
    td('units', esc(fmtQty(ap.units)), 'num') +
    td('irr', esc(fmtPercent(a.irr_percentage)), 'num') +
    '</tr>';
}

function niagaraGroupBody(g, i, open) {
  const ap = g.allocated_proceeds || {};
  const interests = Array.isArray(g.interest_allocations) ? g.interest_allocations : [];
  // One interest: its IRR is the group's. Several: a single rate would not be honest.
  const irr = interests.length === 1 ? fmtPercent(interests[0].irr_percentage) : '';
  const head = '<tr class="wf-group-row" data-gi="' + i + '">' +
    '<td class="wf-tw-cell"><button type="button" class="wf-tw" data-gi="' + i + '" aria-expanded="' + (open ? 'true' : 'false') +
    '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' ' + esc(g.group_name) + '"><span class="wf-caret" aria-hidden="true"></span></button></td>' +
    td('name', esc(g.group_name)) +
    td('label', '') +
    td('proceeds', esc(fmtCurrency(ap.proceeds)), 'num') +
    td('pct', esc(fmtPercent(ap.percentage_of_total)), 'num') +
    td('moic', esc(fmtMoic(g.moic)), 'num') +
    td('invested', esc(fmtCurrency(g.total_invested_capital)), 'num') +
    td('units', esc(fmtQty(ap.units)), 'num') +
    td('irr', esc(irr), 'num') +
    '</tr>';
  return '<tbody class="wf-group' + (open ? ' is-open' : '') + '">' + head + (open ? interests.map(niagaraChildRow).join('') : '') + '</tbody>';
}

function isOpen(i) { return !!S.expanded[currentKey() + '|' + i]; }

function renderNiagaraProceeds(d) {
  const v = visibleGroups(d);
  if (!v.rows.length) return emptyState(v.filtered);
  const multi = v.rows.length > 1;
  const allOpen = v.rows.every(function (r) { return isOpen(r.i); });
  const expandAll = multi
    ? '<button type="button" class="wf-expand-all" data-action="expand-all" aria-pressed="' + (allOpen ? 'true' : 'false') + '">' +
      '<span class="wf-caret' + (allOpen ? ' is-open' : '') + '" aria-hidden="true"></span>' + (allOpen ? 'Collapse all' : 'Expand all') + '</button>'
    : '';
  const head = '<thead><tr><th class="wf-tw-cell">' + expandAll + '</th><th></th><th></th>' +
    '<th class="num">Proceeds</th><th class="num">% of Proceeds</th><th class="num">MOIC</th>' +
    '<th class="num">Invested Capital</th><th class="num">Participating Quantity</th><th class="num">IRR</th></tr></thead>';
  const bodies = v.rows.map(function (r) { return niagaraGroupBody(r.g, r.i, isOpen(r.i)); }).join('');
  // A filtered table is a partial one, so it carries no Total.
  const gt = d.grand_totals || {};
  const foot = v.filtered ? '' : '<tfoot><tr class="wf-total"><td></td>' +
    '<td colspan="2" data-col="name">Total</td>' +
    td('proceeds', esc(fmtCurrency(totalProceeds(d))), 'num') +
    td('pct', '100.00%', 'num') +
    td('moic', '', 'num') +
    td('invested', esc(fmtCurrency(gt.total_invested_capital)), 'num') +
    td('units', esc(fmtQty(gt.participating_units)), 'num') +
    td('irr', '', 'num') + '</tr></tfoot>';
  return tableWrap('<table class="wf-table">' + head + bodies + foot + '</table>');
}

function emptyState(filtered) {
  return '<p class="wf-empty">' + (filtered ? 'No participating interests with current filters' : 'No participating interests') + '</p>';
}
function tableWrap(inner) { return '<div class="wf-table-wrap">' + inner + '</div>'; }

// ── core_results table: flat rows, no sub-rows ──
function renderCoreProceeds(d) {
  const v = visibleGroups(d);
  if (!v.rows.length) return emptyState(v.filtered);
  const gt = d.grand_totals || {};
  const dash = '—';
  const head = '<thead><tr><th>Stakeholder</th><th>Securities</th><th class="num">Projected payout</th>' +
    '<th class="num">Return multiple</th><th class="num">Cost</th><th class="num">Outstanding shares</th><th class="num">IRR</th></tr></thead>';
  const rows = v.rows.map(function (r) {
    const g = r.g;
    const secs = (Array.isArray(g.participating_securities) ? g.participating_securities : [])
      .map(function (s) { return s && typeof s === 'object' ? s.name : s; }).filter(Boolean).join(', ');
    return '<tr>' + td('name', esc(g.organization_name)) + td('securities', secs ? esc(secs) : dash) +
      td('proceeds', esc(fmtCurrency(g.value_of_holdings)), 'num') +
      td('moic', num(g.return_multiple) === null ? dash : esc(fmtMoic(g.return_multiple)), 'num') +
      td('cost', esc(fmtCurrency(g.cost_of_holdings)), 'num') + td('outstanding', esc(fmtQty(g.outstanding_shares)), 'num') +
      td('irr', num(g.irr) === null ? dash : esc(fmtPercent(g.irr)), 'num') + '</tr>';
  }).join('');
  const foot = v.filtered ? '' : '<tfoot><tr class="wf-total">' + td('name', 'Total') + td('securities', '') +
    td('proceeds', esc(fmtCurrency(gt.value_of_holdings)), 'num') + td('moic', '', 'num') +
    td('cost', esc(fmtCurrency(gt.cost_of_holdings)), 'num') + td('outstanding', esc(fmtQty(gt.outstanding_shares)), 'num') +
    td('irr', '', 'num') + '</tr></tfoot>';
  return tableWrap('<table class="wf-table wf-flat">' + head + '<tbody>' + rows + '</tbody>' + foot + '</table>');
}

// ── Page chrome ──
// The Carta mark from theme-with-ink/assets/carta-logo.svg; it paints in currentColor.
const CARTA_LOGO = '<svg class="wf-logo" role="img" aria-label="Carta" fill="none" viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg"><rect x="0.64" y="0.64" width="62.72" height="30.72" stroke="currentColor" stroke-width="1.28"/><path d="M8.4 16.62C8.4 13.42 11.1 11.53 13.53 11.53C15.27 11.53 16.9 12.19 17.76 13.69L16.14 14.63C15.86 14.21 15.48 13.86 15.03 13.62C14.58 13.39 14.08 13.26 13.57 13.27C12.14 13.27 10.44 14.38 10.44 16.59C10.44 18.8 12.06 19.93 13.7 19.93C14.84 19.93 15.79 19.3 16.35 18.32L18.01 19.08C17.07 20.78 15.39 21.68 13.44 21.68C10.98 21.67 8.4 19.79 8.4 16.62L8.4 16.62ZM23.94 21.68C25.29 21.68 26.56 21.08 27.22 20.22V21.4H29.23V11.78H27.22V12.97C26.6 12.1 25.29 11.53 23.94 11.53C20.98 11.53 18.92 13.68 18.92 16.6C18.92 19.52 21 21.68 23.94 21.68V21.68ZM24.13 13.36C25.99 13.36 27.26 14.74 27.26 16.6C27.26 18.47 25.99 19.85 24.13 19.85C22.28 19.85 20.96 18.45 20.96 16.57C20.96 14.68 22.28 13.36 24.13 13.36V13.36ZM40.01 13.69H37.93V11.77H40.03V9.26H42.1V11.77H44.2V13.69H42.1V21.4H40.01V13.69ZM49.96 21.68C51.32 21.68 52.59 21.08 53.25 20.22V21.4H55.26V11.78H53.25V12.97C52.62 12.1 51.32 11.53 49.96 11.53C47.01 11.53 44.94 13.68 44.94 16.6C44.94 19.52 47.03 21.68 49.96 21.68V21.68ZM50.16 13.36C52.01 13.36 53.29 14.74 53.29 16.6C53.29 18.47 52.01 19.85 50.16 19.85C48.31 19.85 46.99 18.45 46.99 16.57C46.99 14.68 48.3 13.36 50.16 13.36V13.36ZM33.77 21.39H31.69V11.77H33.6V13.56C34.07 12.5 34.78 11.8 35.94 11.75C36.18 11.74 36.41 11.75 36.65 11.77L36.62 13.7C34.96 13.7 33.77 14.59 33.77 17.07V21.4H33.77L33.77 21.39Z" fill="currentColor"/></svg>';

function renderHeader() {
  const inputs = (Array.isArray(CFG.inputs) ? CFG.inputs : []).map(function (i) {
    return '<div class="wf-input"><dt>' + esc(i.label) + '</dt><dd>' + esc(i.display_value) + '</dd></div>';
  }).join('');
  const chain = CFG.is_multi_entity
    ? '<p class="wf-chain">Proceeds are distributed from <strong>' + esc(CFG.root_name) + '</strong> and flow down through the ownership chain.</p>'
    : '';
  const open = CFG.carta_url
    ? '<a class="wf-open" href="' + esc(CFG.carta_url) + '" target="_blank" rel="noopener noreferrer">Open in Carta</a>'
    : '';
  return '<header class="wf-head">' + CARTA_LOGO + '<div class="wf-title-row"><h1>' + esc(CFG.target_name) + ' waterfall</h1>' + open + '</div>' + chain +
    (inputs ? '<dl class="wf-inputs">' + inputs + '</dl>' : '') + '</header>';
}

function renderFilterList(d) {
  const q = S.filterSearch.toLowerCase();
  const items = filterItems(d).filter(function (i) { return i.label.toLowerCase().indexOf(q) >= 0; });
  if (!items.length) return '<p class="wf-filter-empty">No matching results found</p>';
  return items.map(function (i, n) {
    return '<label class="wf-check"><input type="checkbox" data-filter-id="' + esc(i.id) + '"' + (S.filters[i.id] ? ' checked' : '') +
      ' id="wf-fopt-' + n + '"><span>' + esc(i.label) + '</span></label>';
  }).join('');
}

function renderFilter(d) {
  const n = Object.keys(selectedFilter()).length;
  const label = 'Filter by interest holder' + (n ? ' (' + n + ')' : '');
  return '<div class="wf-filter">' +
    '<button type="button" class="wf-btn wf-filter-trigger" id="wf-filter-trigger" data-action="filter-toggle" aria-expanded="' + (S.filterOpen ? 'true' : 'false') + '">' +
    esc(label) + '</button>' +
    (S.filterOpen
      ? '<div class="wf-pop"><input type="search" class="wf-search" id="wf-filter-search" placeholder="Search" aria-label="Search" value="' + esc(S.filterSearch) + '">' +
        '<div class="wf-filter-list" id="wf-filter-list">' + renderFilterList(d) + '</div>' +
        '<div class="wf-pop-foot"><button type="button" class="wf-btn wf-small" data-action="filter-reset">Reset all</button></div></div>'
      : '') + '</div>';
}

function renderBelt(d) {
  return d ? '<div class="wf-belt">' + renderFilter(d) + '</div>' : '';
}

function renderResultsTitle() {
  if (S.nodes.length < 2) return '<h2 class="wf-results-title">Waterfall results</h2>';
  const opts = S.nodes.map(function (n) {
    return '<option value="' + esc(n.node_id) + '"' + (n.node_id === S.nodeId ? ' selected' : '') + '>' + esc(n.label) + '</option>';
  }).join('');
  return '<div class="wf-results-title"><h2>Waterfall results:</h2>' +
    '<select class="wf-select" id="wf-entity" data-action="entity" aria-label="Entity">' + opts + '</select></div>';
}

function renderBody() {
  const d = S.data[currentKey()];
  return IS_CORE ? renderCoreProceeds(d) : renderNiagaraProceeds(d);
}

function renderApp() {
  const d = S.data[currentKey()];
  return renderHeader() +
    '<section class="wf-results" aria-label="Waterfall results">' + renderResultsTitle() + renderBelt(d) + '</section>' +
    '<section class="wf-body" id="wf-body">' + renderBody() + '</section>';
}
