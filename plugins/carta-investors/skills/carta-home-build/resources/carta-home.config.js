// ── Carta Home — Skill Directory config ──
// EDIT THIS FILE to change which skills appear in the directory and who sees them.
// Every category shows to every role. `requires` names an optional product
// entitlement ('manco' → has_active_manco, 'tactyc' → has_tactyc) and works on a
// category or on a single skill; either hides only when get_current_user reports the
// flag as an explicit false, so an unavailable or unknown flag still shows it.
// A category whose every skill is gated out hides too.
// A skill takes either `prompt` (copyable) or `note` (static text, no copy button).
// Assembled into carta-home by scripts/build_artifact.py — do NOT edit the built HTML.

// ── Skill directory data ──
const DIR_CATEGORIES = [
  {
    name: 'Portfolio analytics',
    tagline: 'View your schedule of investments and analyze fund performance and benchmarks data',
    skills: [
      { name: 'Schedule of investments', prompt: 'Show me the schedule of investments for my firm' },
      { name: 'Fund performance',        prompt: 'Show me the TVPI, DPI, MOIC and IRR for my funds' },
      { name: 'Co-investor lookup',      prompt: 'Who are other investors who have co-invested in my portfolio companies?' },
      { name: 'Fund benchmarks',         prompt: 'How do our funds compare to peer benchmarks?' },
    ]
  },
  {
    name: 'LP reporting',
    tagline: 'Generate LP tear sheets and annual meeting decks for your investors.',
    skills: [
      { name: 'Tear sheet download', prompt: "Use my firm's tear sheet template and generate tear sheets for this quarter" },
      { name: 'AGM deck builder',    prompt: 'Produce an annual general meeting deck to show our investors' },
    ]
  },
  {
    name: 'Compliance',
    tagline: 'Pull Form ADV and Form PF inputs directly from fund data.',
    skills: [
      { name: 'Form ADV', prompt: 'What is our regulatory AUM' },
    ]
  },
  {
    name: 'Fund accounting',
    tagline: 'Claude for Excel: build consolidated P&L, trial balance, and balance sheets.',
    skills: [
      { name: 'Consolidating balance sheet', prompt: "Show me my firm's balance sheet as of this month" },
      { name: 'Consolidating P&L',           prompt: "Show me my firm's P&L as of this month" },
    ]
  },
  {
    name: 'Fund modeling',
    tagline: 'Project fund performance to close and build your own modeling tools.',
    skills: [
      { name: 'Fund forecasting', requires: 'tactyc', prompt: "What is my funds' TVPI projected at fund close?" },
      { name: 'Fund modeling',    note: 'In Claude Code, use /carta-fund-modeling to build out a React app that lets you model scenarios.' },
    ]
  },
  {
    name: 'ManCo & budgeting',
    requires: 'manco',
    tagline: 'Track ManCo budget vs. actuals, model scenarios, and flag overruns.',
    skills: [
      { name: 'Budget vs. actuals',    prompt: 'Compare YTD actuals against the budget' },
      { name: 'Budget actuals',        prompt: 'Write actuals into an Excel sheet' },
      { name: 'Budget scenarios',      prompt: 'Build what-if scenarios over our budget' },
      { name: 'Create + fetch budget', prompt: 'Build a fund/ManCo budget in Excel from Carta prior-year actuals' },
    ]
  },
];
