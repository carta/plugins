// Page content — assembled into captable-home by build_artifact.py.
// Do NOT edit the built HTML; edit this file and re-run the build.
// `{{COMPANY}}` (dashboard and directory prompts) and `[[COMPANY]]` (Suggested for you)
// fall back to "this company", so keep the name a standalone noun. `[square brackets]`
// mark a value the user fills in.

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

// "Suggested for you" pad prompts: they fill the row when Carta has fewer than four
// personalized ones. `[[COMPANY]]` is the one editable blank; it fills in with the company
// name and types in when the row scrolls into view. `topics` are matched against a
// personalized prompt so the row never shows two cards on the same subject.
const CAP_PROMPTS = [
  {
    text: 'Show me the fully diluted ownership breakdown for [[COMPANY]] by share class',
    topics: ['ownership', 'fully diluted', 'share class'],
  },
  {
    text: "What's expiring soon across the 409A valuations, SAFEs, and option pool at [[COMPANY]]?",
    topics: ['expiring', '409a', 'option pool', 'safe'],
  },
  {
    text: 'Show the financing round history for [[COMPANY]] and who invested in each round',
    topics: ['financing', 'round history', 'raised'],
  },
  {
    text: 'How would the outstanding SAFEs and notes at [[COMPANY]] convert in a new priced round?',
    topics: ['conversion', 'convert', 'priced round', 'safe', 'note'],
  },
];

// "What's new" fallback cards, shown in the carousel (as skill items) only when Carta
// supplies neither the microapp nor a recently launched skill. Newest first. The tag is a
// recency claim a customer reads at face value, so only carry "New" for something that
// actually shipped recently — check the skill's own history first. `output` names what the
// skill hands back, for its preview (see WHATS_NEW_SKILL_OUTPUTS below for the kinds).
// `skill` is the card's skill: the card shows only while the Skill Directory lists it.
// `body` shows only when that skill has no `whatsNewCopy`; otherwise its copy leads.
const WHATS_NEW = [
  {
    tag: 'New',
    title: 'Register of allotments',
    skill: 'carta-register-of-allotments',
    body: 'The UK statutory register — every allotment with its holder, share class, quantity, price, date, and SH01 filing status.',
    prompt: 'Show me the register of allotments for {{COMPANY}}',
    output: 'register',
  },
  {
    tag: 'New',
    title: 'Issue from a spreadsheet',
    skill: 'carta-issuance',
    body: 'Upload a spreadsheet of certificates, option grants or profits interest units and have the rows drafted for review, instead of entering each one by hand.',
    prompt: 'Draft the option grants in this spreadsheet for {{COMPANY}}',
    output: 'document',
  },
  {
    tag: 'Updated',
    title: 'Compensation scorecard',
    skill: 'carta-compensation-scorecard',
    body: 'See how employees sit against market — band distribution across the company, plus each employee’s compa-ratio and percentile.',
    prompt: 'Which employees at {{COMPANY}} are below P50 for their role?',
    output: 'chart',
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
  {
    id: 'setup',
    name: 'Company setup',
    tagline: 'Add and edit stakeholders, equity plans, share classes, documents, and board approvals.',
  },
];

// ── What's new: the microapp Carta Home features ──
// The What's new carousel shows the open microapps, then the newest skills from Contentful,
// then the locked microapps, up to WHATS_NEW_SLOTS items (app/whats-new.js), so a locked one
// can be pushed out. `unlockedBy` is the product flag (from get_current_user) that makes a
// microapp usable for the company; without it the item is locked, and `lockedLabel` replaces
// its set-up button with a link to `unlockUrl`, the product's carta.com demo page, which
// app/whats-new.js tags `utm_campaign=carta-home-whatsnew-<slug>` so Marketing can attribute
// the visit to Carta Home and to the microapp. With no `unlockUrl` the label is plain text.
// `slug` names the microapp in Home (tracking, the campaign tag); `skill` is the skill that
// builds it: "Set up in Claude Code" copies `/<skill>`, and that skill never also takes a
// What's new skill slot. `preview` keys WHATS_NEW_PREVIEWS (app/whats-new.js).
const WHATS_NEW_MICROAPPS = [
  {
    slug: 'total-compensation',
    title: 'Total Compensation',
    headline: 'Explore your pay bands and market benchmarks live',
    description: 'A console for your compensation data: filter by job area, compare peer groups, and see where each employee sits against market, all loaded with your Carta Total Compensation data.',
    skill: 'carta-compensation-app',
    unlockedBy: 'has_ctc',
    lockedLabel: 'Available with Carta Total Compensation',
    unlockUrl: 'https://carta.com/demo/total-comp/?utm_medium=product&utm_source=claude',
    preview: 'totalCompensation',
  },
];

// ── What's new: what each skill hands back, for its preview ──
// A new skill's preview shows the kind of thing it produces: a one-page document, a
// statutory register, a spreadsheet, a chart, or an answer in chat (`rows`, the default). A skill takes its Skill
// Directory category's kind (`byCategory`); `bySkill` lists only the skills whose output
// differs from their category's. A document, spreadsheet or chart skill is picked over a
// newer chat answer (rankWhatsNew in app/whats-new.js).
const WHATS_NEW_SKILL_OUTPUTS = {
  bySkill: {
    'carta-reporting': 'spreadsheet',
    'carta-reporting-excel': 'spreadsheet',
    'carta-issuance': 'document',
    'carta-manage-securities': 'rows',
    'carta-register-of-allotments': 'register',
    'carta-round-history': 'chart',
    'carta-valuation-history': 'chart',
  },
  byCategory: {
    'reporting': 'spreadsheet',
    'issuance': 'document',
    'compensation': 'rows',
    'governance': 'rows',
    'equity': 'rows',
  },
};
