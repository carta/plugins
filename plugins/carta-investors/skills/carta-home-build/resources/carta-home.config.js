// ── Carta Home — Skill Directory config ──
// EDIT THIS FILE to change the directory's categories. Its skills come from
// .claude-plugin/skill-directory.json — see DIR_CATEGORIES below.
// Assembled into carta-home by scripts/build_artifact.py — do NOT edit the built HTML.

// Marketing curates the Plugin news row by tagging Contentful entries, so changing
// what appears there is not a code change. Only the tag ID itself lives here.
const NEWS_TAG = "pluginHomeInvestors";

// ── Dashboard launchers ──
// `prompt` is the contract, not `buildSkill` — it routes to whichever skill owns the
// dashboard in this install, so home never has to know which one that is.
// `buildSkill` is read by carta-home-build at build time only. It lists candidates in
// preference order: Step 3 takes the first that resolves, so an install carrying only the
// router still builds the dashboard. When every candidate is absent the entry is skipped,
// no URL reaches DASHBOARD_URLS, and the tile falls back to its prompt.
const DASHBOARDS = [
  {
    key: 'soi',
    label: 'Open Schedule of Investments',
    footerId: 'soi-card-footer',
    prompt: 'Show me the schedule of investments for my firm',
    buildSkill: ['carta-soi', 'carta-portfolio-analytics-routing'],
  },
  {
    key: 'perf',
    label: 'Open Fund Performance',
    footerId: 'perf-card-footer',
    prompt: 'Show me the TVPI, DPI, MOIC and IRR for my funds',
    // The only builder: the router's benchmarks route answers in chat rather than
    // publishing an artifact.
    buildSkill: ['carta-fund-performance'],
  },
  {
    key: 'lp',
    label: 'Open LP Summary',
    footerId: 'lp-card-footer',
    prompt: 'Show me a summary of our LPs',
    buildSkill: ['carta-lp-summary'],
    // Step 5 builds it only for a firm whose get_current_user flag is true; the card
    // shows on the same condition (app/segment-dashboards.js).
    requires: 'has_fund_admin',
  },
];

// Baked in at build time by build_artifact.py from --dashboard-url key=url, or this
// sentinel from --dashboard-building key. `{}` when nothing was passed — every tile then
// renders its prompt instead.
const DASH_BUILDING = 'building';
// A build that dies between publishes never redeploys, so the card would sit on
// "Preparing" forever. Generous against the ~3min fan-out: late is cheap, early is wrong.
// When this fires, the card does NOT claim the dashboard is gone — see
// dashExpireBuilding in carta-home.app.js — because a slow-but-still-running build can
// (and regularly does) redeploy after this timer, and the card should look no different
// than "still working" until it actually does.
const DASH_BUILDING_TIMEOUT_MS = 5 * 60 * 1000;
const DASHBOARD_URLS = {{DASHBOARD_URLS}};

// ── Skill directory categories ──
// Categories, in display order. The skills inside each one are not listed here: they live
// in the plugin's .claude-plugin/skill-directory.json, keyed by skill, and each names its
// category by `id`. The build bakes that file in as the first paint, and
// app/skill-directory.js swaps in the published list once the page is idle, so a skill
// that ships later appears without a rebuild. Rename an `id` only together with every
// entry that points at it.
// `requires` names an optional product entitlement ('manco' → has_active_manco,
// 'tactyc' → has_tactyc) on a category here, or on a single skill in the JSON file;
// either hides only when get_current_user reports the flag as an explicit false, so an
// unavailable or unknown flag still shows it. A category whose every skill is gated out
// hides too.
const DIR_CATEGORIES = [
  {
    id: 'portfolio',
    name: 'Portfolio analytics',
    tagline: 'View your schedule of investments and analyze fund performance and benchmarks data',
  },
  {
    id: 'lp-reporting',
    name: 'LP reporting',
    tagline: 'Generate LP tear sheets and annual meeting decks for your investors.',
  },
  {
    id: 'compliance',
    name: 'Compliance',
    tagline: 'Pull Form ADV and Form PF inputs directly from fund data.',
  },
  {
    id: 'fund-accounting',
    name: 'Fund accounting',
    tagline: 'Ask about fund data like NAV, and build consolidated P&L, trial balance, and balance sheets in Excel.',
  },
  {
    id: 'fund-modeling',
    name: 'Fund modeling',
    tagline: 'Project fund performance to close and build your own modeling tools.',
  },
  {
    id: 'manco',
    name: 'ManCo & budgeting',
    requires: 'manco',
    tagline: 'Track ManCo budget vs. actuals, model scenarios, and flag overruns.',
  },
  {
    id: 'fund-admin',
    name: 'Fund admin',
    tagline: 'Send work to your Carta fund admin team and track it.',
  },
];

// ── What's new: the microapps Carta Home features ──
// The What's new carousel shows the open microapps, then one skill from
// Contentful, then the locked microapps, up to WHATS_NEW_SLOTS items (app/whats-new.js),
// so a locked one can be pushed out. `unlockedBy` is the product flag that makes a
// microapp usable for the firm (from get_current_user, or derived: see
// WHATS_NEW_DERIVED_FLAGS in app/whats-new.js); without it the item is locked, with
// `lockedLabel` in place of its set-up button. The label links to `unlockPath`, a page in
// the viewer's own Carta (the web app host for get_current_user's `environment`, never its
// API `base_url`, + the path, `{organization_pk}` filled with the firm's organization
// account), once both are known; else to
// `unlockUrl`, the product's carta.com demo request page, which app/whats-new.js tags
// `utm_campaign=carta-home-whatsnew-<key>` so Marketing can attribute the visit to Carta
// Home and to the microapp. With neither, the label is plain text. `key` names the
// microapp in Home (tracking, the campaign tag); `skill` is the skill that builds it:
// "Set up in Claude Code" copies `/<skill>`, and that skill never also takes What's new's
// skill slot. `preview` keys WHATS_NEW_PREVIEWS (app/whats-new.js).
// The Fund Administration demo page, where locked Fund Modeling and ManCo both lead.
const FUND_ADMIN_DEMO_URL = 'https://carta.com/demo/fund-admin/?utm_medium=product&utm_source=claude';
const WHATS_NEW_MICROAPPS = [
  {
    key: 'fund-modeling',
    title: 'Fund Modeling',
    headline: 'See how every assumption moves your returns',
    description: 'Model fund return scenarios based on Carta data and see how different assumptions move LP returns and GP carry.',
    skill: 'carta-fund-modeling',
    unlockedBy: 'has_fund_admin',
    lockedLabel: 'Available with Carta Fund Administration',
    unlockUrl: FUND_ADMIN_DEMO_URL,
    preview: 'fundModeling',
  },
  {
    key: 'manco-budgeting',
    title: 'ManCo Budgeting',
    headline: "Budget vs. actuals that doesn't need rebuilding",
    description: 'Track management company budget vs. actuals in a live dashboard traced back to Carta journal entries.',
    skill: 'carta-manco-reporting',
    unlockedBy: 'has_active_manco',
    lockedLabel: 'Available with Carta ManCo',
    // Carta's in-app ManCo upgrade page. Until it can be built, the demo page the carta-manco
    // skill uses: ManCo is sold with Fund Administration.
    unlockPath: '/marketing/firm/{organization_pk}/management-companies',
    unlockUrl: FUND_ADMIN_DEMO_URL,
    preview: 'mancoBudgeting',
  },
  {
    key: 'analytics',
    title: 'Portfolio Analytics',
    headline: 'Your whole portfolio in one dashboard',
    description: 'Explore your whole portfolio in one interactive dashboard, from all your reporting metrics to valuations and tearsheets.',
    skill: 'carta-portfolio-analytics-app',
    // Not a get_current_user flag: app/whats-new.js looks up the firm's Data Collection
    // setting (resolveDataCollection) and leaves this item out until it knows.
    unlockedBy: 'has_data_collection',
    // No link: carta.com has no Data Collection page to send the viewer to.
    lockedLabel: 'Available with Data Collection',
    preview: 'portfolioAnalytics',
  },
];

// ── What's new: what each skill hands back, for its preview ──
// A new skill's preview shows the kind of thing it produces: a deck, a one-page
// document, a spreadsheet, or an answer in chat about funds, companies or a checklist.
// A skill takes its Skill Directory category's kind (`byCategory`), else 'funds';
// `bySkill` lists only the skills whose output differs from their category's.
// A deck, document or spreadsheet skill is picked over a newer chat answer
// (rankWhatsNew in app/whats-new.js).
const WHATS_NEW_SKILL_OUTPUTS = {
  bySkill: {
    'carta-brand-extraction': 'deck',
    'carta-spa-audit': 'checklist',
  },
  byCategory: {
    'lp-reporting': 'document',
    'fund-accounting': 'spreadsheet',
    'manco': 'spreadsheet',
    'portfolio': 'companies',
  },
};
