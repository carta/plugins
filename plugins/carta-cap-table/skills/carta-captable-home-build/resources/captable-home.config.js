// Page content — assembled into captable-home by build_artifact.py.
// Do NOT edit the built HTML; edit this file and re-run the build.
// `{{COMPANY}}` falls back to "this company", so keep it a standalone noun.
// `[square brackets]` mark a value the user fills in.

// Marketing curates the Plugin news row by tagging Contentful entries, so changing
// what appears there is not a code change.
const NEWS_TAG = "pluginCartaHome";

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
    body: 'Upload a spreadsheet of certificates or option grants and have the rows drafted for review, instead of entering each one by hand.',
    prompt: 'Draft the option grants in this spreadsheet for {{COMPANY}}',
  },
  {
    tag: 'Updated',
    title: 'Compensation scorecard',
    body: 'See how employees sit against market — band distribution across the company, plus each employee’s compa-ratio and percentile.',
    prompt: 'Which employees at {{COMPANY}} are below P50 for their role?',
  },
];

const DIR_CATEGORIES = [
  {
    name: 'Cap table & reporting',
    tagline: 'Look up grants, vesting, stakeholders, and securities, or export to Excel.',
    skills: [
      {
        name: 'Cap table lookup',
        prompts: [
          'Show me every option grant at {{COMPANY}} with its holder, quantity, and status',
          'List every outstanding security for {{COMPANY}} with its share class and quantity',
          'Show me the SAFEs and convertible notes outstanding for {{COMPANY}}',
        ]
      },
      {
        name: 'Excel cap table export',
        prompts: [
          'Export the cap table report for {{COMPANY}} to Excel',
          'Export the securities ledger for {{COMPANY}} to Excel, sorted by issue date',
        ]
      },
      {
        name: 'Register of allotments (UK)',
        prompts: [
          'Show me the register of allotments for {{COMPANY}}',
          'Which allotments at {{COMPANY}} are still missing an SH01 filing?',
        ]
      },
    ]
  },
  {
    name: 'Equity & vesting',
    tagline: 'Check vesting progress, signature status, and SAFE / note conversion math.',
    skills: [
      {
        name: 'Vesting progress',
        prompts: [
          "How much has [employee name]'s option grant vested so far?",
          "When does [employee name]'s cliff hit, and how many shares are still unvested?",
          "Show me the vesting schedule for [employee name]'s RSUs at {{COMPANY}}",
        ]
      },
      {
        name: 'Signature status',
        prompts: [
          'Which grants at {{COMPANY}} are still waiting on a witness signature?',
          'Which awards are awaiting spousal consent, and which requests have expired?',
        ]
      },
      {
        name: 'SAFE & note conversion',
        prompts: [
          'How would the outstanding SAFEs and notes for {{COMPANY}} convert at $2.50 per share?',
          'If we raise a $10M round at a $60M pre-money valuation, how many shares do our SAFEs convert into?',
        ]
      },
    ]
  },
  {
    name: 'Issuance & changes',
    tagline: 'Issue new equity and fix details on certificates or option grants already on file.',
    skills: [
      {
        name: 'Issue equity',
        prompts: [
          'Issue a 10,000-share NSO grant to [employee name] at {{COMPANY}}',
          'Draft the option grants in this spreadsheet for {{COMPANY}}',
          'Resume issuing from my last draft set for {{COMPANY}}',
        ]
      },
      {
        name: 'Fix a grant or certificate',
        prompts: [
          "Update the vesting start date on [employee name]'s option grant",
          'Correct the exercise price on certificate [certificate label] for {{COMPANY}}',
        ]
      },
    ]
  },
  {
    name: 'Governance & risk',
    tagline: 'Track what needs attention, financing history, valuations, voting math, and exit payouts.',
    skills: [
      {
        name: 'Risk & expiration alerts',
        prompts: [
          "What's expiring soon across our 409A valuations, SAFEs, and option pool?",
          'Which convertible notes mature in the next 90 days?',
          'Is the option pool running low at {{COMPANY}}?',
        ]
      },
      {
        name: 'Voting coalition finder',
        prompts: [
          'Which stockholders do we need to approve this charter amendment?',
          'Can we reach 66% approval without [investor name]?',
          "Here's our voting rights report — what's the smallest coalition that passes the protective provision?",
        ]
      },
      {
        name: 'Financing round history',
        prompts: [
          'Show the financing round history for {{COMPANY}} and who invested in each round',
          'What was the price per share and total raised in our last priced round?',
        ]
      },
      {
        name: 'Valuation & FMV history',
        prompts: [
          'What is the current 409A valuation for {{COMPANY}}?',
          'How has our FMV changed over time, and when does the current 409A expire?',
        ]
      },
      {
        name: 'Market norms',
        prompts: [
          'What is a typical option pool size at our stage?',
          'How do our SAFE valuation caps and discount rates compare to the market?',
        ]
      },
      {
        name: 'Exit waterfall',
        prompts: [
          'What would each holder walk away with if {{COMPANY}} sold for $250M?',
          'At what sale price do common holders start seeing proceeds?',
          'What is the return multiple for our Series A investors at a $500M exit?',
        ]
      },
    ]
  },
  {
    name: 'Compensation',
    tagline: 'Compare pay against market and classify roles into the compensation taxonomy.',
    skills: [
      {
        name: 'Market pay benchmarks',
        prompts: [
          'What are the market benchmarks for a [job title]?',
          'Put the P25/P50/P75 salary and equity ranges for our sales roles in a CSV',
        ]
      },
      {
        name: 'Comp scorecard',
        prompts: [
          'How is our pay positioned against market for our employees?',
          'Which employees at {{COMPANY}} are below P50 for their role?',
        ]
      },
      {
        name: 'Role classification',
        prompts: [
          "How would the title '[job title]' map to the compensation taxonomy?",
          'What job area, focus, level, and track does this job description fall into?',
        ]
      },
    ]
  },
];
