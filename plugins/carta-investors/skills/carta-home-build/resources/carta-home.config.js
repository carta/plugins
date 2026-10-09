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
    label: 'Open SOI dashboard',
    footerId: 'soi-card-footer',
    prompt: 'Show me the schedule of investments for my firm',
    buildSkill: ['carta-soi', 'carta-portfolio-analytics-routing'],
  },
  {
    key: 'perf',
    label: 'Open fund performance dashboard',
    footerId: 'perf-card-footer',
    prompt: 'Show me the TVPI, DPI, MOIC and IRR for my funds',
    // The only builder: the router's benchmarks route answers in chat rather than
    // publishing an artifact.
    buildSkill: ['carta-fund-performance'],
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
    tagline: 'Claude for Excel: build consolidated P&L, trial balance, and balance sheets.',
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
