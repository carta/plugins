// ── Page state and pure renderers (state in, HTML string out) ──
const S = {
  nodes: [],                 // [{node_id, label, is_root}] root first; one entry for a core run
  nodeId: null,
  view: 'proceeds',          // proceeds | breakpoints
  data: {},                  // nodeId -> {allocations, grand_totals}
  bp: {},                    // nodeId -> breakpoints array, or null when unavailable
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
  S.bp = {};
  (Array.isArray(entities) ? entities : []).forEach(function (e, i) {
    const id = String(i);
    S.nodes.push({ node_id: id, is_root: !!e.is_root, label: e.display_name ? e.display_name : 'Entity ' + (i + 1) });
    S.data[id] = { allocations: Array.isArray(e.allocations) ? e.allocations : [], grand_totals: e.grand_totals || null };
    S.bp[id] = Array.isArray(e.breakpoints) ? e.breakpoints : null;
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
    td('invested', esc(fmtCurrency(a.invested_capital)), 'num') +
    td('units', esc(fmtQty(ap.units)), 'num') +
    td('moic', noOwnMultiple ? '<span class="wf-dash" title="' + esc(NO_IC_TIP) + '" tabindex="0">—</span>' : esc(fmtMoic(a.moic)), 'num') +
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
    td('invested', esc(fmtCurrency(g.total_invested_capital)), 'num') +
    td('units', esc(fmtQty(ap.units)), 'num') +
    td('moic', esc(fmtMoic(g.moic)), 'num') +
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
    '<th class="num">Proceeds</th><th class="num">% of Proceeds</th><th class="num">Invested Capital</th>' +
    '<th class="num">Participating Quantity</th><th class="num">MOIC</th><th class="num">IRR</th></tr></thead>';
  const bodies = v.rows.map(function (r) { return niagaraGroupBody(r.g, r.i, isOpen(r.i)); }).join('');
  // A filtered table is a partial one, so it carries no Total.
  const gt = d.grand_totals || {};
  const foot = v.filtered ? '' : '<tfoot><tr class="wf-total"><td></td>' +
    '<td colspan="2" data-col="name">Total</td>' +
    td('proceeds', esc(fmtCurrency(totalProceeds(d))), 'num') +
    td('pct', '100.00%', 'num') +
    td('invested', esc(fmtCurrency(gt.total_invested_capital)), 'num') +
    td('units', esc(fmtQty(gt.participating_units)), 'num') +
    td('moic', '', 'num') + td('irr', '', 'num') + '</tr></tfoot>';
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
  const head = '<thead><tr><th>Stakeholder</th><th>Securities</th><th class="num">Outstanding shares</th><th class="num">Cost</th>' +
    '<th class="num">Projected payout</th><th class="num">Return multiple</th><th class="num">IRR</th></tr></thead>';
  const rows = v.rows.map(function (r) {
    const g = r.g;
    const secs = (Array.isArray(g.participating_securities) ? g.participating_securities : [])
      .map(function (s) { return s && typeof s === 'object' ? s.name : s; }).filter(Boolean).join(', ');
    return '<tr>' + td('name', esc(g.organization_name)) + td('securities', secs ? esc(secs) : dash) +
      td('outstanding', esc(fmtQty(g.outstanding_shares)), 'num') + td('cost', esc(fmtCurrency(g.cost_of_holdings)), 'num') +
      td('proceeds', esc(fmtCurrency(g.value_of_holdings)), 'num') +
      td('moic', num(g.return_multiple) === null ? dash : esc(fmtMoic(g.return_multiple)), 'num') +
      td('irr', num(g.irr) === null ? dash : esc(fmtPercent(g.irr)), 'num') + '</tr>';
  }).join('');
  const foot = v.filtered ? '' : '<tfoot><tr class="wf-total">' + td('name', 'Total') + td('securities', '') +
    td('outstanding', esc(fmtQty(gt.outstanding_shares)), 'num') + td('cost', esc(fmtCurrency(gt.cost_of_holdings)), 'num') +
    td('proceeds', esc(fmtCurrency(gt.value_of_holdings)), 'num') + td('moic', '', 'num') + td('irr', '', 'num') + '</tr></tfoot>';
  return tableWrap('<table class="wf-table wf-flat">' + head + '<tbody>' + rows + '</tbody>' + foot + '</table>');
}

// ── Breakpoints ──
function renderBreakpoints() {
  const bp = S.bp[S.nodeId];
  if (!bp) return "<p class=\"wf-empty\">Breakpoints aren't available for this run.</p>";
  if (!bp.length) return '<p class="wf-empty">No breakpoints for this run.</p>';
  let head;
  let rows;
  if (IS_CORE) {
    head = '<thead><tr><th>Description</th><th class="num">From</th><th class="num">To</th><th class="num">Delta</th><th class="num">Value in tier</th></tr></thead>';
    rows = bp.map(function (b) {
      return '<tr>' + td('name', '<span class="wf-strong">' + esc(b.description) + '</span>') + td('from', esc(fmtCurrency(b.from_value)), 'num') +
        td('to', esc(fmtCurrency(b.to_value)), 'num') + td('delta', esc(fmtCurrency(b.delta)), 'num') +
        td('value_in_tier', esc(fmtCurrency(b.value_in_tier)), 'num') + '</tr>';
    }).join('');
  } else {
    head = '<thead><tr><th>Breakpoint</th><th class="num">From</th><th class="num">To</th><th class="num">Proceeds in tier</th>' +
      '<th class="num">Remaining proceeds</th><th class="num">Participating quantity</th><th class="num">Proceeds per unit</th></tr></thead>';
    rows = bp.map(function (b) {
      return '<tr>' + td('name', '<span class="wf-strong">' + esc(b.name) + '</span>') + td('from', esc(fmtCurrency(b.from)), 'num') +
        td('to', esc(fmtCurrency(b.to)), 'num') + td('proceeds_in_tier', esc(fmtCurrency(b.proceeds_in_tier)), 'num') +
        td('remaining', esc(fmtCurrency(b.remaining_proceeds)), 'num') + td('units', esc(fmtQty(b.participating_units)), 'num') +
        td('per_unit', esc(fmtCurrency(b.proceeds_per_unit)), 'num') + '</tr>';
    }).join('');
  }
  return tableWrap('<table class="wf-table wf-flat">' + head + '<tbody>' + rows + '</tbody></table>');
}

// ── Page chrome ──
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
  return '<header class="wf-head"><div class="wf-title-row"><h1>' + esc(CFG.target_name) + ' waterfall</h1>' + open + '</div>' + chain +
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
  const toggle = '<div class="wf-seg" role="group" aria-label="View">' +
    '<button type="button" data-action="view" data-view="proceeds" aria-pressed="' + (S.view === 'proceeds') + '">Proceeds</button>' +
    '<button type="button" data-action="view" data-view="breakpoints" aria-pressed="' + (S.view === 'breakpoints') + '">Breakpoints</button></div>';
  if (S.view !== 'proceeds') return '<div class="wf-belt">' + toggle + '</div>';
  return '<div class="wf-belt">' + toggle + (d ? renderFilter(d) : '') + '</div>';
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
  if (S.view === 'breakpoints') return renderBreakpoints();
  const d = S.data[currentKey()];
  return IS_CORE ? renderCoreProceeds(d) : renderNiagaraProceeds(d);
}

function renderApp() {
  const d = S.data[currentKey()];
  return renderHeader() +
    '<section class="wf-results" aria-label="Waterfall results">' + renderResultsTitle() + renderBelt(d) + '</section>' +
    '<section class="wf-body" id="wf-body">' + renderBody() + '</section>' +
    '<footer class="wf-foot">Results for the ' + esc(CFG.waterfall_date) + ' run.</footer>';
}
