// Page content — assembled into captable-home by build_artifact.py.
// Do NOT edit the built HTML; edit this file and re-run the build.
// `{{COMPANY}}` falls back to "this company", so keep it a standalone noun.
// `[square brackets]` mark a value the user fills in.

// Marketing curates the Plugin news row by tagging Contentful entries, so changing
// what appears there is not a code change. This tag is cap-table-specific:
// `pluginCartaHome` belongs to carta-investors' own home and curates a different row.
const NEWS_TAG = "pluginHomeCapTable";

// Keyed by drill-down page id: the prompt that carries the same question into chat,
// shown at the foot of the page once the user has read the data.
const DASHBOARD_PROMPTS = {
  'captable-page': 'Show me the fully diluted ownership breakdown for {{COMPANY}}, by share class and option pool',
  'rounds-page': 'Show the financing round history for {{COMPANY}} and who invested in each round',
  'option-pool-page': 'Show me each option plan at {{COMPANY}} with its pool size, shares available, and utilization',
  'stakeholders-page': 'Show me the stakeholders for {{COMPANY}} and how much each one holds',
  'drafts-page': 'Show me the draft certificates and option grants for {{COMPANY}}',
};

// "What to try next" fallback cards. `topics` are matched against a personalized
// prompt so the grid never shows two cards on the same subject.
const CAP_PROMPTS = [
  {
    text: 'Show me the fully diluted ownership breakdown for {{COMPANY}} by share class',
    topics: ['ownership', 'fully diluted', 'share class'],
  },
  {
    text: "What's expiring soon across the 409A valuations, SAFEs, and option pool at {{COMPANY}}?",
    topics: ['expiring', '409a', 'option pool', 'safe'],
  },
  {
    text: 'Show the financing round history for {{COMPANY}} and who invested in each round',
    topics: ['financing', 'round history', 'raised'],
  },
  {
    text: 'What would each holder walk away with if {{COMPANY}} sold for $250M?',
    topics: ['waterfall', 'exit', 'sold', 'acquisition'],
  },
];

// "What's new" cards. Newest first; keep this to three so the row stays one line.
// The tag is a recency claim a customer reads at face value, so only carry "New" for
// something that actually shipped recently — check the skill's own history first.
const WHATS_NEW = [
  {
    tag: 'New',
    title: 'Register of allotments',
    body: 'The UK statutory register — every allotment with its holder, share class, quantity, price, date, and SH01 filing status.',
    prompt: 'Show me the register of allotments for {{COMPANY}}',
  },
  {
    tag: 'New',
    title: 'Issue from a spreadsheet',
    body: 'Upload a spreadsheet of certificates, option grants or profits interest units and have the rows drafted for review, instead of entering each one by hand.',
    prompt: 'Draft the option grants in this spreadsheet for {{COMPANY}}',
  },
  {
    tag: 'Updated',
    title: 'Compensation scorecard',
    body: 'See how employees sit against market — band distribution across the company, plus each employee’s compa-ratio and percentile.',
    prompt: 'Which employees at {{COMPANY}} are below P50 for their role?',
  },
];

// Skill Directory categories, in display order. The skills inside each one are not
// listed here: they live in the plugin's .claude-plugin/skill-directory.json, keyed by
// skill, and each names its category by `id`. The build bakes that file in as the
// fallback, and app/skill-directory.js swaps in the published list when the page opens.
// Rename an `id` only together with every entry that points at it.
const DIR_CATEGORIES = [
  {
    id: 'reporting',
    name: 'Cap table & reporting',
    tagline: 'Look up grants, vesting, stakeholders, and securities, or export to Excel.',
  },
  {
    id: 'equity',
    name: 'Equity & vesting',
    tagline: 'Check vesting progress, signature status, and SAFE / note conversion math.',
  },
  {
    id: 'issuance',
    name: 'Issuance & changes',
    tagline: 'Issue new equity and fix details on certificates or option grants already on file.',
  },
  {
    id: 'governance',
    name: 'Governance & risk',
    tagline: 'Track what needs attention, financing history, valuations, voting math, and exit payouts.',
  },
  {
    id: 'compensation',
    name: 'Compensation',
    tagline: 'Compare pay against market and classify roles into the compensation taxonomy.',
  },
];
