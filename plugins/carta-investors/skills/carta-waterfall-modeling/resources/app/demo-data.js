// Canned results for --demo builds, so every state of the page can be walked offline.
// Never bundled into a published page. Pick a state with ?demo=<state>:
//   single (default) · multi · core
// Names and figures are synthetic.

const DEMO_STATE = (new URLSearchParams(location.search).get('demo') || 'single').toLowerCase();

const DEMO_BASE = {
  owner_kind: 'FIRM', owner_id: '1001',
  target_kind: 'LLC_INTEREST_ISSUER', target_id: 'demo-target-1', execution_id: 'demo-exec-1',
  get_command: 'waterfall_modeling:get:niagara_results',
  target_name: 'Northwind Holdings LLC', root_name: 'Northwind Holdings LLC', is_multi_entity: false,
  equity_value: '10000000.00', waterfall_date: '2026-06-30', currency: 'USD',
  inputs: [
    { label: 'Equity value', display_value: '$10,000,000.00' },
    { label: 'Waterfall date', display_value: '2026-06-30' },
  ],
};

function _interest(holderId, holder, type, label, proceeds, ic, units, irr) {
  return {
    holder_id: holderId, holder_name: holder, type_name: type, interest_label: label,
    allocated_proceeds: { proceeds: proceeds.toFixed(2), units: String(units) },
    invested_capital: ic.toFixed(2),
    moic: ic > 0 ? (proceeds / ic).toFixed(4) : null,
    irr_percentage: irr == null ? null : String(irr),
  };
}

// Deliberately not in proceeds order: the page must show rows as the API returns them.
const DEMO_NODES = {
  root: {
    name: 'Northwind Holdings LLC', total: 10000000,
    interests: [
      _interest('h-trust', 'Alder Family Trust', 'Class A Units', 'A-1', 2400000, 1000000, 1000000, 21.4),
      _interest('h-trust', 'Alder Family Trust', 'Class B Units', 'B-1', 1100000, 600000, 400000, 14.2),
      _interest('h-blue', 'Blue Ridge Capital', 'Preferred Units', 'P-1', 3800000, 2500000, 2500000, 12.6),
      _interest('h-carry', 'Carry Partners LLC', 'Profits Interests', 'PI-1', 150000, 0, 120000, null),
      _interest('h-employee', 'Employee Pool', 'Profits Interests', 'PI-2', -12500.5, 25000, 300000, -8.3),
      _interest('h-maple', 'Maple Fund II LP', 'Class A Units', 'A-2', 2200000, 1500000, 1500000, 9.7),
      _interest('other-holders', 'Other holders', 'Class A Units', 'A-3', 362500.5, 250000, 250000, 11.1),
    ],
    breakpoints: [
      { name: 'Return of capital', from: '0.00', to: '5875000.00', proceeds_in_tier: '5875000.00', remaining_proceeds: '4125000.00', participating_units: '5870000', proceeds_per_unit: '1.0009' },
      { name: 'Preferred return (8%)', from: '5875000.00', to: '7000000.00', proceeds_in_tier: '1125000.00', remaining_proceeds: '3000000.00', participating_units: '2500000', proceeds_per_unit: '0.4500' },
      { name: 'Common participation', from: '7000000.00', to: null, proceeds_in_tier: '3000000.00', remaining_proceeds: '0.00', participating_units: '6070000', proceeds_per_unit: '0.4942' },
    ],
  },
  n2: {
    name: 'Northwind Operating LLC', total: 3800000,
    interests: [
      _interest('o-1', 'Northwind Holdings LLC', 'Class A Units', 'A-1', 3000000, 2000000, 2000000, 10.2),
      _interest('o-2', 'Operating Management Co', 'Class B Units', 'B-1', 800000, 400000, 400000, 16.9),
    ],
    breakpoints: [
      { name: 'Return of capital', from: '0.00', to: '2400000.00', proceeds_in_tier: '2400000.00', remaining_proceeds: '1400000.00', participating_units: '2400000', proceeds_per_unit: '1.0000' },
      { name: 'Common participation', from: '2400000.00', to: null, proceeds_in_tier: '1400000.00', remaining_proceeds: '0.00', participating_units: '2400000', proceeds_per_unit: '0.5833' },
    ],
  },
  n3: {
    name: null, total: 2200000,
    interests: [
      _interest('v-1', 'Maple Fund II LP', 'Limited Partner Interests', 'LP-1', 2200000, 1500000, 1500000, 9.7),
    ],
    breakpoints: null,
  },
};

function _sumBy(list, f) { return list.reduce(function (s, x) { return s + f(x); }, 0); }

function _niagaraGroups(interests, grouping) {
  const order = [];
  const map = {};
  interests.forEach(function (it) {
    const key = grouping === 'BY_HOLDER' ? it.holder_name : it.type_name;
    if (!map[key]) { map[key] = []; order.push(key); }
    map[key].push(it);
  });
  const total = _sumBy(interests, function (i) { return Number(i.allocated_proceeds.proceeds); });
  return order.map(function (key) {
    const list = map[key];
    const proceeds = _sumBy(list, function (i) { return Number(i.allocated_proceeds.proceeds); });
    const ic = _sumBy(list, function (i) { return Number(i.invested_capital); });
    return {
      group_name: key,
      allocated_proceeds: {
        proceeds: proceeds.toFixed(2), percentage_of_total: (total ? proceeds / total * 100 : 0).toFixed(4),
        units: String(_sumBy(list, function (i) { return Number(i.allocated_proceeds.units); })),
      },
      total_invested_capital: ic.toFixed(2),
      moic: ic > 0 ? (proceeds / ic).toFixed(4) : null,
      interest_allocations: list.map(function (i) {
        const p = Number(i.allocated_proceeds.proceeds);
        return Object.assign({}, i, {
          allocated_proceeds: Object.assign({}, i.allocated_proceeds, { percentage_of_total: (total ? p / total * 100 : 0).toFixed(4) }),
        });
      }),
    };
  });
}

function _niagaraEntity(key, isRoot) {
  const node = DEMO_NODES[key];
  return {
    display_name: node.name, is_root: isRoot,
    allocations: _niagaraGroups(node.interests, 'BY_HOLDER'),
    breakpoints: node.breakpoints,
    grand_totals: {
      total_invested_capital: _sumBy(node.interests, function (i) { return Number(i.invested_capital); }).toFixed(2),
      participating_units: String(_sumBy(node.interests, function (i) { return Number(i.allocated_proceeds.units); })),
    },
  };
}

const DEMO_CORE = {
  holders: [
    { key: 'ORGANIZATION: 11', organization_name: 'Redwood Ventures', participating_securities: ['Series A Preferred'], outstanding_shares: '2500000', cost_of_holdings: '2500000.00', value_of_holdings: '5100000.00', return_multiple: '2.0400', irr: '19.8' },
    { key: 'STAKEHOLDER: 5', organization_name: 'Dana Whitfield', participating_securities: ['Common', 'Options'], outstanding_shares: '3000000.5', cost_of_holdings: '30000.00', value_of_holdings: '2400000.00', return_multiple: '80.0000', irr: null },
    { key: 'ORGANIZATION: 12', organization_name: 'Lakeshore Seed Fund', participating_securities: ['Seed Preferred'], outstanding_shares: '800000', cost_of_holdings: '800000.00', value_of_holdings: '-0.00', return_multiple: null, irr: null },
    { key: 'OTHER_HOLDERS', organization_name: 'Other holders', participating_securities: [], outstanding_shares: '400000', cost_of_holdings: '100000.00', value_of_holdings: '2500000.00', return_multiple: '25.0000', irr: null },
  ],
  breakpoints: [
    { description: 'Series A liquidation preference', from_value: '0.00', to_value: '2500000.00', delta: '2500000.00', value_in_tier: '2500000.00' },
    { description: 'Seed liquidation preference', from_value: '2500000.00', to_value: '3300000.00', delta: '800000.00', value_in_tier: '800000.00' },
    { description: 'Participation', from_value: '3300000.00', to_value: '10000000.00', delta: '6700000.00', value_in_tier: '6700000.00' },
  ],
};

function _coreEntity() {
  const rows = DEMO_CORE.holders;
  const sum = function (f) { return _sumBy(rows, function (r) { return Number(r[f]) || 0; }); };
  return {
    display_name: null, is_root: true, allocations: rows, breakpoints: DEMO_CORE.breakpoints,
    grand_totals: { outstanding_shares: String(sum('outstanding_shares')), cost_of_holdings: sum('cost_of_holdings').toFixed(2), value_of_holdings: sum('value_of_holdings').toFixed(2) },
  };
}

(function installDemo() {
  const cfg = Object.assign({}, DEMO_BASE);
  if (DEMO_STATE === 'multi') {
    cfg.is_multi_entity = true;
    cfg.entities = [_niagaraEntity('root', true), _niagaraEntity('n2', false), _niagaraEntity('n3', false)];
  } else if (DEMO_STATE === 'core') {
    cfg.get_command = 'waterfall_modeling:get:core_results';
    cfg.target_kind = 'CORE_COMPANY';
    cfg.target_name = 'Lumen Analytics, Inc.';
    cfg.root_name = cfg.target_name;
    cfg.entities = [_coreEntity()];
  } else {
    cfg.entities = [_niagaraEntity('root', true)];
  }
  WF_CONFIG = cfg;
})();
