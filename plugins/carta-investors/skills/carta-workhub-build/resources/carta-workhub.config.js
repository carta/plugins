// Composer tiles. Labelled blanks, not filled examples: they tell the sender what
// the team needs. See SKILL.md for why they omit the chat-routing preamble.

const TASK_PRESETS = [
  { name: 'Call capital', detect: 'capital call',
    requires: [
      { label: 'Fund', has: "fund\\s*:?\\s*\\S|fund\\s+[ivx\\d]" },
      { label: 'Total amount', has: "\\$\\s?[\\d,]|\\bamount\\b[^\\n]*\\d" },
      { label: 'Due date', has: "\\bdue\\b[^\\n]*\\d|\\bdue\\b[^\\n]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)" },
      { label: 'Call type', has: "pro-?\\s?rata|subsequent close|in-?\\s?line|hybrid" },
    ],
    template: [
    'Issue a capital call.',
    'Fund:',
    'Total amount:',
    'Due date:',
    'Call type (pro-rata, subsequent close, bring investors in-line, hybrid):',
    'Anything else we should know:',
  ] },
  { name: 'New investment', detect: 'new investment|book an investment',
    requires: [
      { label: 'Fund', has: "fund\\s*:?\\s*\\S|fund\\s+[ivx\\d]" },
      { label: 'Company', has: "\\b(inc|ltd|llc|corp|gmbh)\\b|company\\s*:?\\s*\\S" },
      { label: 'Amount and security', has: "\\$\\s?[\\d,]" },
      { label: 'Close date', has: "\\bclos(e|ed|ing)\\b[^\\n]*\\d|\\bdate\\b[^\\n]*\\d" },
    ],
    template: [
    'Book a new investment.',
    'Fund:',
    'Company:',
    'Amount and security (e.g. $2M Series B preferred):',
    'Close date:',
    'Documents attached or where to find them:',
  ] },
  { name: 'Update valuation', detect: 'valuation|revalue',
    requires: [
      { label: 'Company', has: "\\b(inc|ltd|llc|corp|gmbh)\\b|company\\s*:?\\s*\\S" },
      { label: 'New value', has: "\\$\\s?[\\d,]" },
      { label: 'Effective date', has: "as of[^\\n]*\\d|effective[^\\n]*\\d|\\bdate\\b[^\\n]*\\d" },
    ],
    template: [
    'Update a portfolio company valuation.',
    'Fund:',
    'Company:',
    'New value and basis (e.g. $40M enterprise value):',
    'Effective date:',
    'Supporting source:',
  ] },
  { name: 'Initiate payment', detect: 'pay an invoice|payment|invoice',
    requires: [
      { label: 'Payee', has: "pay(ee)?\\s*:?\\s*\\S|\\binvoice\\b[^\\n]*\\S" },
      { label: 'Amount', has: "\\$\\s?[\\d,]" },
      { label: 'Account to pay from', has: "account\\s*:?\\s*\\S|\\bfrom\\b[^\\n]*\\b(cash|account|bank)\\b" },
    ],
    template: [
    'Pay an invoice.',
    'Fund or entity paying:',
    'Payee:',
    'Amount:',
    'Invoice date and number:',
    'Account to pay from:',
  ] },
  { name: 'Request distribution', detect: 'distribution',
    requires: [
      { label: 'Fund', has: "fund\\s*:?\\s*\\S|fund\\s+[ivx\\d]" },
      { label: 'Total amount', has: "\\$\\s?[\\d,]" },
      { label: 'Allocation basis', has: "pro rata|by commitment|basis\\s*:?\\s*\\S|waterfall" },
      { label: 'Payment date', has: "pa(y|id|yment)[^\\n]*\\d|\\bdate\\b[^\\n]*\\d" },
    ],
    template: [
    'Process a distribution.',
    'Fund:',
    'Total amount:',
    'Allocation basis (e.g. pro rata by commitment):',
    'Payment date:',
    'Anything else we should know:',
  ] },
  { name: 'LP subsequent close', detect: 'subsequent close',
    requires: [
      { label: 'Fund', has: "fund\\s*:?\\s*\\S|fund\\s+[ivx\\d]" },
      { label: 'Close date', has: "\\bclos(e|ing)\\b[^\\n]*\\d|\\bdate\\b[^\\n]*\\d" },
      { label: 'New LPs and commitments', has: "\\$\\s?[\\d,]" },
    ],
    template: [
    'Add a subsequent close.',
    'Fund:',
    'Close date:',
    'New LPs and commitments:',
    'Late interest treatment:',
    'Documents attached or where to find them:',
  ] },
  { name: 'LP transfer', detect: 'transfer',
    requires: [
      { label: 'Fund', has: "fund\\s*:?\\s*\\S|fund\\s+[ivx\\d]" },
      { label: 'Transferring from', has: "\\bfrom\\b[^\\n]*\\S" },
      { label: 'Transferring to', has: "\\bto\\b[^\\n]*\\S" },
      { label: 'Effective date', has: "effective[^\\n]*\\d|\\bdate\\b[^\\n]*\\d" },
    ],
    template: [
    'Transfer an LP commitment.',
    'Fund:',
    'Transferring from:',
    'Transferring to:',
    'Amount or full commitment:',
    'Effective date:',
  ] },
];

// The queue's categories, in display order. A task joins the one listing its
// workflow_template; a capital activity is a call or a distribution only by its
// name, which fund-admin builds from the activity type, so `named` decides there.
// A template listed nowhere lands in Other. `icon` is the inner markup of a
// 24×24 stroked SVG.
const TASK_REQUEST_ICON = '<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.28 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.28a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.72 6.4a9.95 9.95 0 0 1 2.7-2.69"/>';
// The keys the queue files its own rows under (requests, a seeded review, a seeded
// tracker period, the catch-all); every other row finds its category by template.
// The templates the queue routes on; the app files read these names.
const TASK_TEMPLATE_REQUEST = 'request-generic';
const TASK_TEMPLATE_CAPITAL_ACTIVITY = 'request-capital-activity';
const TASK_TEMPLATE_PACKAGE = 'publish-financial-package';
// Capital calls and Distributions share these; the name decides between them.
const TASK_TEMPLATES_CAPITAL_ACTIVITY = [TASK_TEMPLATE_CAPITAL_ACTIVITY, 'draft-request-capital-activity'];
// Every tab, Completed included, shows only these workflows: the ones a Workhub
// panel opens (request thread, capital call review, reporting tracker) rather than
// sending the GP to Carta. One list for all tabs, so finished work never shows a
// kind of task the open tabs leave out. Add a template here once a panel opens it.
const TASK_TEMPLATES_WITH_TILES = [TASK_TEMPLATE_REQUEST, TASK_TEMPLATE_CAPITAL_ACTIVITY, TASK_TEMPLATE_PACKAGE];

const TASK_CATEGORY_REQUEST = 'request';
const TASK_CATEGORY_CAPITAL = 'capital';
const TASK_CATEGORY_REPORTING = 'reporting';
const TASK_CATEGORY_OTHER = 'other';

const TASK_CATEGORIES = [
  { key: TASK_CATEGORY_REQUEST, name: 'Requests to Carta',
    templates: [TASK_TEMPLATE_REQUEST, 'investment-workspace-request'],
    icon: TASK_REQUEST_ICON },
  { key: TASK_CATEGORY_CAPITAL, name: 'Capital calls',
    templates: [...TASK_TEMPLATES_CAPITAL_ACTIVITY, 'request-capital-call'],
    icon: '<path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"/><path d="m16 19 3 3 3-3"/><path d="M18 12h.01"/><path d="M19 16v6"/><path d="M6 12h.01"/><circle cx="12" cy="12" r="2"/>' },
  { key: 'cash', name: 'Cash reconciliation',
    templates: ['cash-reconciliation'],
    icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>' },
  { key: 'fees', name: 'Management fees',
    templates: ['review-management-fees', 'draft-review-management-fees'],
    icon: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>' },
  { key: 'expense', name: 'Expense payments',
    templates: ['prepare-and-pay-expense', 'draft-prepare-and-pay-expense', 'expense-accrual'],
    icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>' },
  { key: 'distribution', name: 'Distributions',
    templates: TASK_TEMPLATES_CAPITAL_ACTIVITY, named: /distribution/i,
    icon: '<path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"/><path d="M18 12h.01"/><path d="M19 22v-6"/><path d="m22 19-3-3-3 3"/><path d="M6 12h.01"/><circle cx="12" cy="12" r="2"/>' },
  { key: 'intercompany', name: 'Intercompany payment',
    templates: ['settle-intercompany-balances', 'request-related-party-transfer', 'draft-request-related-party-transfer'],
    icon: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>' },
  { key: 'kyc', name: 'KYC compliance',
    templates: ['review-kyc'],
    icon: '<circle cx="10" cy="8" r="5"/><path d="M2 21a8 8 0 0 1 10.434-7.62"/><circle cx="18" cy="18" r="3"/><path d="m22 22-1.9-1.9"/>' },
  { key: TASK_CATEGORY_REPORTING, name: 'Financial reporting',
    templates: [TASK_TEMPLATE_PACKAGE],
    icon: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m9 15 2 2 4-4"/>' },
  { key: 'soi', name: 'SOI review',
    templates: ['review-soi-v2', 'draft-review-soi-v2'],
    icon: '<path d="M16 5H3"/><path d="M16 12H3"/><path d="M16 19H3"/><path d="M21 5h.01"/><path d="M21 12h.01"/><path d="M21 19h.01"/>' },
  // Other borrows Requests' icon, as the design does.
  { key: TASK_CATEGORY_OTHER, name: 'Other', templates: [],
    icon: TASK_REQUEST_ICON },
];
