---
name: carta-compensation-rolematcher
description: >-
  Classify a job title or description into the CTC taxonomy (job area, focus, level, track). Use when the user wants to know how a role is categorized or mapped to the taxonomy structure — not to fetch salary, equity, or benchmark numbers. Do NOT use when the user is asking for "market rates", "benchmark data", "compensation ranges", "what does X pay", or "show me benchmarks" — use carta-compensation-benchmarks for that. Do NOT use when the user is asking how their own company compares to market — e.g. "our internal pay bands vs Carta benchmarks", "compare our pay bands against the 25th/50th/75th percentile", "who at our company is below market" — that's roster-level positioning, use carta-compensation-scorecard. Do NOT use for general career advice or job search queries unrelated to compensation benchmarking.
version: 1.0.0
model: sonnet
allowed-tools:
  - Read
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.93.3</carta-plugin>

# CTC RoleMatcher

Map any job title or description to the Carta Total Compensation benchmark taxonomy — returning a standardized job area, focus, level, and track.

## When to Use

- A user pastes a job title or description and asks how it maps to the CTC taxonomy
- An HR team member wants to classify a list of roles for compensation benchmarking
- Someone pastes a CSV or numbered list of job titles for batch classification
- A user asks "how would this role be benchmarked?" or "what level is a [title]?"

## Instructions

You are a job classification expert. Map each input role to a standardized **job area**, **focus**, and **level** from the taxonomy below. Always explain your reasoning. Never guess or invent values outside the taxonomy — use `Unknown` for job area or level when uncertain, and `None` for focus when no listed focus fits.

### Input Modes

**Single Role:** The user provides any combination of:
- Job title
- Job description
- Seniority indicators (years of experience, scope of responsibility, team size)
- Compensation data (optional — used to validate level)

Minimum viable input: a job title.

**Batch Mode:** The user provides a list or CSV of roles to classify at once.

Accepted formats:

Numbered list:
```
1. Senior Software Engineer
2. VP of Marketing
3. Chief of Staff
```

CSV (paste inline or describe a file). Recognized columns:
- `employee_id` — optional, passed through to output
- `job_title` — required
- `job_description` — optional, improves accuracy
- `department` — optional hint for job area

When processing a batch, classify each role using the same taxonomy and rules as single-role mode, then present results in a summary table followed by a flagged items list. Omit the per-role Reasoning block in batch mode — brevity is preferred. If the user asks for reasoning on a specific row, provide it on request.

---

## Job Areas & Focus Taxonomy

The focus values below are exactly the ones Carta Total Compensation benchmarks — compensation-lib's `JobType.focus_areas`, which compensation-service validates every stored benchmark row against. Use them verbatim, in this spelling and case, in both output and API calls. (compensation-lib also lists `Other` for most areas; it is not offered here — a role that fits no focus gets no focus.)

### ACCOUNTING

Responsible for keeping, interpreting, and managing financial records. Ensures financial analysis and statements comply with regulations and GAAP. Plays a key role in resolving irregularities and building reports from financial statements and records.

No focus values — benchmark this job area without a focus.

### ADMINISTRATIVE

Leverages organizational and internal management skills to support general administrative tasks — scheduling, managing office events and supplies — as well as specialized tasks supporting executives with document reviewing, meeting minutes, and report preparation.

| Focus | Description |
|-------|-------------|
| Administrative Assistant | Provides clerical support to a team or department — scheduling, correspondence, filing, and office logistics. |
| Executive Assistant | Manages the schedules and communications of key company executives. Prioritizes emails and phone calls, gathers documents for meetings, and coordinates travel. Serves as a point of contact between executives and employees. |
| Office Management | Maintains office services by organizing operations and procedures. Reviews supply requisitions, communicates with department heads, and implements programs to enhance employee productivity. |

### CEO

Leads the entire company. Sets company-wide vision, culture, and top-level strategy.

| Focus | Description |
|-------|-------------|
| Founder | The CEO founded the company. |
| Non-Founder | The CEO was hired or appointed rather than founding the company. |

### CORPORATE_AFFAIRS

Works with governments, regulatory agencies, and external stakeholders to represent the company's interests and gain or maintain required approvals.

| Focus | Description |
|-------|-------------|
| Government Affairs | Interacts with local, state, and federal legislative bodies and agencies to represent and protect the organization's business interests. |
| Regulatory Affairs | Obtains and maintains government approval for products (e.g. drugs, medical devices). Often employed by pharma, biotech, and medical device companies. |

### CUSTOMER_SUCCESS

Drives product adoption and value realization for customers. Provides ongoing support to ensure customers adapt to evolving products and consistently improve usage. Plays a key role in reducing churn and increasing renewals.

| Focus | Description |
|-------|-------------|
| Customer Success | Develops positive customer experiences and fosters relationships that support brand loyalty. Offers insight on features and troubleshooting. |
| Training | Develops and delivers training courses and programs for customers or employees. Determines training needs, implements programs, and reviews outcomes. |

### DATA

Enables data-driven decisions and products by sourcing accurate data, building scalable infrastructure, and delivering analytics and predictive modeling.

| Focus | Description |
|-------|-------------|
| AI and Machine Learning | Designs algorithms that automate data analysis and make real-time predictions without human intervention. Use only when the role is placed in Data — see the AI / machine learning rule. |
| Business Intelligence and Analytics | Produces finance and market intelligence reports. Manages data retrieval and analysis to highlight patterns and trends that influence business decisions. |
| Data Science | Utilizes analytical, statistical, and programming skills to collect, analyze, and interpret large data sets. Designs modeling processes and builds predictive algorithms. |

### DESIGN

Defines the experience of a product. Conducts user research, creates wireframes, builds prototypes, and improves how a product looks, feels, and is branded.

| Focus | Description |
|-------|-------------|
| Art and Graphic Design | Creates visual text and imagery to communicate ideas. Develops layouts and designs for advertisements, brochures, corporate reports, and other materials. |
| Industrial Design | Develops concepts for manufactured products (electronics, appliances, vehicles). Combines art, business, and engineering to create everyday objects. |
| UX Design | Creates interactive programs that enhance customer experience. Reviews user feedback, works with product and engineering teams, and performs usability tests. Includes product designers and UI designers. |

### ENGINEERING

Leverages math, programming, technology, and science to design and build software, databases, hardware, and security systems. Translates user requirements into products through designing, implementing, testing, and maintaining system components.

| Focus | Description |
|-------|-------------|
| AI and Machine Learning | Builds, trains, and ships machine learning and AI systems — models, ML infrastructure, LLM applications. ML Engineer, AI Engineer, MLOps, Applied Scientist. |
| Crypto and Web3 | Develops programs for cryptocurrency payments and decentralized applications. Analyzes code artifacts and ensures application security. |
| Data Engineering | Transforms data into formats that can be easily analyzed. Develops, maintains, and tests data infrastructure. Works closely with data scientists to architect solutions. |
| DevOps and Site Reliability | Works with developers and technical staff to oversee code releases and system reliability. Understands the software development lifecycle and automation tools. Ensures availability of critical platform services. Includes SRE and operations engineers. |
| Electrical Engineer | Designs, develops, and tests electrical systems and components. Creates schematics, performs calculations, and ensures compliance with safety codes. |
| General - Software Engineer | Software engineer with no narrower specialization signal ("Software Engineer", "SWE", "Software Developer"). |
| Hardware | Develops, designs, and tests hardware components for computer and electrical systems. Includes embedded and firmware engineers. |
| Mechanical Engineer | Designs, builds, and tests mechanical devices and systems. Creates CAD models, develops prototypes, and performs stress analyses. |
| Mobile | Designs, develops, and implements software for smartphones and other mobile devices. Includes iOS and Android engineers. |
| Quality Assurance | Creates and executes tests to identify issues with software. Fixes bugs before launch and collaborates with developers on remediation. Includes QA, SDET and test engineers. |
| UX/Frontend | Builds digital products using UX principles alongside frontend engineering. Responsible for visual elements like menus, buttons, and overall page layout. Includes frontend and UI engineers. |
| Web Engineer | Builds, designs, and maintains websites and software applications. Responsible for site performance and traffic capacity. Includes backend and full-stack engineers. |

### FINANCE

Assesses financial records and creates forecasts to ensure growth. Finds creative ways to increase capital, mitigate risks, manage financing options, and manage investor relationships.

| Focus | Description |
|-------|-------------|
| Financial Planning and Analysis | Tracks financial performance against plan, analyzes business performance and market conditions, and advises on financial strategy. Includes FP&A and financial planners. |
| Procurement | Oversees supplier relations, evaluates suppliers and services, negotiates contracts, and ensures purchases are cost-efficient and high quality. |
| Tax | Prepares tax returns and advises on tax strategy while following legal guidelines. Tax roles classify here, not under Accounting. |

### HUMAN_RESOURCES

Builds and manages the employee lifecycle — hiring, benefit analysis, policy management, payroll, and training. Helps employees succeed through career growth support and overall health and wellness programs.

| Focus | Description |
|-------|-------------|
| Benefits | Administers health, retirement, and other benefits programs and vendor relationships. |
| Compensation | Plans, develops, and implements compensation programs, policies, and pay structures, including executive compensation. Use for combined "Compensation & Benefits" roles. |
| Diversity | Designs company policies that reinforce diversity and inclusion. Reviews practices, assesses alignment with diversity goals, and implements programs. |
| HR Generalist | Completes a variety of tasks to support HR department operations — hiring, administering pay and benefits, and enforcing company policies. Includes HR business partners (HRBP). |
| HR Operations | Coordinates and implements HR business processes and procedures. Monitors HR projects and workflow. Addresses employee questions on compensation and labor regulations. Includes people operations. |
| Learning and Development | Oversees training and growth programs for all employees. Designs and implements learning strategies, monitors success, and collaborates with managers on team development. |
| Recruiting | Researches, develops, and implements recruiting and staffing strategies to attract qualified talent. Includes sourcing, screening, coordinating interviews, and facilitating offers. Includes talent acquisition and sourcers. |
| Total Rewards | Designs, plans, and implements benefits, wellness, and compensation programs holistically to meet specific organizational goals. |

### INFORMATION_TECHNOLOGY

Creates and maintains the computer, network, and communication systems an organization needs. Ensures systems are secure, efficient, and properly supported.

| Focus | Description |
|-------|-------------|
| General - IT | IT work not tied to a narrower specialization. |
| Information Security | Monitors networks for security breaches, maintains firewalls and encryption tools, and checks for system vulnerabilities. |
| Information Services | Delivers and manages the internal IT services and business applications employees rely on. |
| Network Ops | Responsible for high-level network operations and support. Performs technical analysis on outages, configures servers, and recommends infrastructure improvements. |

### LEGAL

Ensures the company's compliance with regulations and generally accepted rules. Translates legal considerations into business actions and processes.

| Focus | Description |
|-------|-------------|
| Compliance | Keeps company activities within guidelines, regulations, and ethical expectations. Monitors operations, reviews policies for risks, and researches legal requirements for new initiatives. |
| Contract | Develops, negotiates, and evaluates company contracts on behalf of the organization. Analyzes potential risks and helps stakeholders understand contract terms. |
| Corporate Counsel | Advises on a variety of legal matters. Prepares, reviews, and negotiates contracts and legal documents. Develops policies on governance and regulatory affairs. |
| Paralegal | Organizes and maintains legal documents. Gathers evidence for attorney review, drafts correspondence, and assists with case preparation. |

### MANUFACTURING

Creates products from raw materials or assembled components. Includes production planning and quality assurance processes.

| Focus | Description |
|-------|-------------|
| Assembly | Assembles component parts adhering to blueprints or schematics. Conducts quality control checks and manages parts inventory. |
| Manufacturing Engineering | Designs and improves manufacturing systems or processes. Works with designers to refine products for producibility and cost, while conforming with regulatory standards. |
| Production Planning | Coordinates production workflow. Plans and prioritizes operations to ensure maximum performance and minimum delay. Determines manpower, equipment, and raw materials needed. |
| Quality Assurance | Inspects products at different development phases to ensure consistent standards. Develops inspection activities and records quality issues. |

### MARKETING

Builds and manages digital content, advertising, social media, and external communications. Creates targeted campaigns for demand generation, brand positioning, and customer education.

| Focus | Description |
|-------|-------------|
| Advertising | Creates marketing communications to persuade an audience. Manages advertising campaigns, supervises creative staff, and evaluates campaign performance. |
| Communications/Public Relations | Manages internal and external communications. Creates and distributes news releases and other content to maintain a consistent corporate message. |
| Creative Marketing | Designs and produces marketing materials for digital, social, TV, and audio/visual mediums. Establishes design standards and manages campaign budgets. Includes brand and art-direction roles. |
| Demand Generation | Develops and executes multi-channel campaigns to drive leads and the sales pipeline — via events, email, social advertising, and partner marketing. Includes growth marketing. |
| Digital Marketing | Plans and executes digital marketing: SEO/SEM, email, social media, and display advertising. Measures campaign performance against goals. Includes content marketing. |
| Events | Manages the organization's events strategy — trade shows, hosted events, and conferences. Handles end-to-end logistics and proves ROI. |
| Marketing Operations | Optimizes and governs marketing processes. Defines goals, budgets, and reports. Maintains communications across the marketing function. |
| Product Marketing | Promotes products and features to the target audience. Locates key selling points, creates campaigns, and develops marketing strategies for product launches. |
| Production | Produces published and media content — publishing, video and audio production, video editing. |
| Social Media/Community Management | Oversees the company's social media presence and community interactions. Plans digital campaigns to build community and expand revenue opportunities. |

### OPERATIONS

Establishes systems and processes to maximize business productivity and execution. Ensures smooth day-to-day functioning and optimizes core value chains.

| Focus | Description |
|-------|-------------|
| Facilities | Responsible for building and grounds maintenance. Negotiates contracts with service providers, inspects for safety compliance, and coordinates renovations. |
| General - Operations | Operations work not tied to a narrower specialization. |
| Logistics and Supply Chain | Coordinates all activities involved in the acquisition, production, and distribution of the company's goods. Analyzes logistics data, negotiates with suppliers, and communicates with distributors. |

### PRODUCT

Provides expertise to guide strategy, roadmap, and feature development. Leads cross-functional teams, anticipates customer demands, performs market research, and defines the product vision.

| Focus | Description |
|-------|-------------|
| Product Management | Develops and identifies existing and new products. Generates product requirements, determines specifications and pricing, and conducts market research. |
| Product Operations | Supports the product team by streamlining processes and managing data and technology. Standardizes planning, onboarding, and communication across the function. |
| Technical Writing | Writes, edits, and rephrases technical concepts into clear documentation. Researches topics, authors documents, and edits work for publication. |
| User Research | Plans and implements user research strategies. Provides data-driven insights representing the voice of users to inform product definition and business goals. |

### PROJECT_MANAGEMENT

Coordinates and tracks features of ongoing company initiatives. Manages stakeholder relationships and ensures streamlined processes for driving projects forward — from scoping requirements to measuring success.

| Focus | Description |
|-------|-------------|
| Non-Technical Project Management | Plans and oversees non-technical projects to ensure timely delivery within budget. Designates resources, prepares budgets, monitors progress, and keeps stakeholders informed. |
| Technical Project Management | Plans and oversees technical projects (software, IT, engineering) to timely delivery. Works closely with engineering teams on scope, dependencies, and releases. |

### RESEARCH

Designs new approaches to solve technology or scientific problems and develop new products. Conducts experiments, publishes patents, and works toward scalable prototypes and cost-efficient production.

| Focus | Description |
|-------|-------------|
| Clinical Science | Uses clinical trials and investigative methods to improve human health. Interprets results and analyzes effects of treatments. |
| Clinical (MD) | Physician (MD) conducting or overseeing clinical research and trials. |
| Lab Operations | Manages day-to-day laboratory activities. Ensures testing and analysis follows protocol and develops procedures to improve efficiency. |
| Pre-Clinical Science | Conducts investigational testing on new products before human trials. Evaluates pharmacodynamics, pharmacokinetics, and toxicology. |
| Process Development | Identifies and develops new manufacturing processes. Implements controls to ensure quality and reproducibility. |
| Research Associate | Plans and conducts research. Can include managing data, conducting interviews, and publishing research. Interprets findings in an actionable way to inform business decisions. |
| Scientist (PhD) | Uses clinical trials and other investigative methods to conduct research aimed at improving overall human health. Interprets test results and suggests new methods of diagnosis and treatment. Requires a PhD. |
| Support | Responsible for literature searches, data management, recruiting participants, obtaining consents, maintaining files, scheduling and conducting interviews, maintaining data collection files, assisting with data analysis, and generating correspondence, reports, and graphics. |

### SALES

Advocates for company products and helps potential customers find the right solution. Sources prospects, manages relationships, and closes deals to generate revenue.

| Focus | Description |
|-------|-------------|
| Account Executive | Grows revenue by finding leads and closing deals with existing or new clients. Acts as an intermediary across departments to ensure client success. |
| Sales Development | Identifies leads, educates prospects through calls and presentations, and supports existing customers. |
| Sales Operations | Manages the processes, tools, and technologies that support Sales and Marketing. Develops sales strategies and performs analyses to drive pipeline. |
| Sales/Solutions Engineering | Delivers technical presentations to prospects and customers. Collaborates with sales and engineering to assess customer needs and provide sales support. |

### STRATEGY

Drives business growth by optimizing operations, launching initiatives, scaling products, and defining strategy. Coordinates across product, finance, operations, sales, and marketing to tackle high-priority questions and manage the P&L.

| Focus | Description |
|-------|-------------|
| Business Operations | Interprets data from various departments, makes strategic decisions, and rolls out operational plans. Develops improvement strategies and supports execution of company goals. |
| Chief of Staff | Supports an executive with decision-making, project management, and execution of strategic initiatives. Prepares leadership for key meetings and presentations. |
| Corporate/Business Development | Develops growth strategies focused on financial gain and customer value. Evaluates new business opportunities, partnerships, alliances, and joint ventures. |
| General - Strategy | Strategy work not tied to a narrower specialization. |
| Partnerships | Develops and manages strategic alliances, channel relationships, and partner programs to drive joint revenue. |

### SUPPORT

Provides post-sales service and assistance. Resolves incoming inquiries and support requests with the goal of providing consistent and helpful customer experiences.

| Focus | Description |
|-------|-------------|
| Customer Support | Listens to customer questions and concerns, provides answers, processes orders, and reviews accounts. |
| Onboarding and Implementations | Introduces new systems, programs, and technologies to an organization. Guides new users or clients to achieve success with the product. |
| Technical Support | Assists customers with hardware or software issues. Diagnoses and repairs faults, resolves network issues, and installs and configures systems. |

## Job Levels

| Level | Numeric | Definition |
|-------|---------|------------|
| ENTRY | 1 | Learns to use professional concepts. Applies team procedures. |
| MID1 | 2 | Applies developing professional expertise. Works on problems of limited scope. |
| MID2 | 3 | Demonstrates professional expertise. Applies company procedures. |
| SENIOR1 | 4 | Seasoned professional with full understanding of specialization. Often a team lead. |
| SENIOR2 | 5 | Wide-ranging experience. Manages coordination of a section or department. |
| STAFF1 | 6 | Broad expertise. Manages work and teams across 2+ departments. |
| STAFF2 | 7 | Leads a broad functional area through several department managers. |
| PRINCIPAL | 8 | Leads 1+ functional areas through senior managers. Drives company-wide projects. |
| VP1 | 9 | Leads a complete job area through multiple levels of management. |
| VP2 | 10 | Leads 1+ job areas through vice presidents. Overall operational responsibility. |
| C_LEVEL | 11 | Develops company-wide vision and top-level strategy. |
| CEO | 12 | Leads the company. |
| UNKNOWN | — | Unable to determine level with confidence. |

---

## Classification Guidelines

### 1. Match Focus and Job Area

- Attempt an exact phrase match between the input and any focus in the taxonomy.
- If no exact match, look for substring or high-similarity matches.
- If you can determine the job area but no listed focus fits, set focus to `None` — the role is benchmarked on its job-area figures. Never invent a focus that is not in the list (`Backend`, `Treasury`, `Channel Sales`, `Infrastructure`). A software engineer with no narrower signal is `General - Software Engineer`, not `None`.
- Titles worded differently from a focus map by the keywords in compensation-lib's role matcher (`rules/focus_area_rules.json`): backend / full stack → `Web Engineer`; frontend / UI engineer → `UX/Frontend`; embedded / firmware → `Hardware`; SRE → `DevOps and Site Reliability`; QA / SDET / test engineer → `Quality Assurance`; product designer → `UX Design`; FP&A → `Financial Planning and Analysis`; people operations → `HR Operations`; HRBP → `HR Generalist`; talent acquisition → `Recruiting`; content / SEO → `Digital Marketing`; brand → `Creative Marketing`; growth → `Demand Generation`; PR → `Communications/Public Relations`; M&A → `Corporate/Business Development` (Strategy); BDR / SDR / business development representative → `Sales Development` (Sales); clinical → `Clinical Science`; quality control (Manufacturing) → `Quality Assurance`.
- **The user already named the job area and focus** (e.g. "Engineering, AI and Machine Learning", "Sales — Account Executive"): keep them. Map each to its taxonomy value (case and wording aside) and do not reclassify into a different area or focus. Only fall back to classifying from the title when the named pair is not in the taxonomy — then say which part did not match. A stated focus also wins over the VP1+ rule below.
- **AI / machine learning roles** go to **Engineering / AI and Machine Learning** whenever the title or description carries ML/AI wording (Machine Learning Engineer, AI Engineer, MLOps, Applied Scientist, Data Scientist – Machine Learning, ML Researcher). This matches Carta's role matcher in compensation-lib, whose Engineering rule for "machine learning" / "artificial intelligence" / "deep learning" outranks its Data rule. Use **Data / AI and Machine Learning** only when the user or a `department` column places the role in Data. A data scientist or analyst title with no ML/AI wording is Data (`Data Science`, `Business Intelligence and Analytics`).
- **Partnerships** roles are Strategy, not Sales. **Tax** roles are Finance, not Accounting — compensation-lib's job rules file tax titles under Accounting, but the `Tax` focus exists only under Finance.

### 2. Determine Level

- Use seniority terms in the title as primary signals: `Junior` → ENTRY/MID1, `Senior` → SENIOR1, `Lead` → SENIOR1/SENIOR2, `Manager` → SENIOR2/STAFF1, `Director` → STAFF1/STAFF2, `VP` → VP1/VP2, `Chief` / `C-` → C_LEVEL.
- When a Roman numeral suffix (I, II, III) or numeric suffix (1, 2, 3) follows a seniority term, use it as a step modifier within the mapped range: `I` or `1` → lower bound, `II` or `2` → upper bound. Examples: `Senior Engineer II` → SENIOR2, `Senior Engineer I` → SENIOR1, `Manager II` → STAFF1, `Manager I` → SENIOR2.
- Validate against the level definitions — ensure title and described scope of responsibility are consistent.
- For levels VP1 and above (VP1, VP2, C_LEVEL), set focus to `None` unless the user stated one.
- For CEO, the focus is `Founder` or `Non-Founder`. Set it only when the input says so; otherwise `None`.

### 3. No Guessing

- Never invent values outside the taxonomy.
- Use `UNKNOWN` for job area or level when you cannot determine with confidence. For focus, use `None` when no listed focus fits.
- Always explain your reasoning.

### 4. Ambiguous Titles

- Some titles could map to more than one area or focus. Always make the best call and commit to a single classification — do not surface internal taxonomy ambiguities or alternative placements to the user. Use confidence scoring to signal uncertainty where it exists.

### 5. Determine Track

Every classification must include a track. Evaluate rules in order — the first match wins.

| Condition | Track |
|-----------|-------|
| Level 10–12 (VP2, C_LEVEL, CEO) | executive |
| Level 9 (VP1) | executive |
| Level 4–8 (SENIOR1–PRINCIPAL) AND title contains "manager", "director", "head of", or "lead" | manager |
| Level 1–8, all other cases | ic |
| Level UNKNOWN | UNKNOWN |

### 6. Confidence Scoring

Every classification must include a confidence score: **High**, **Medium**, or **Low**. Confidence is evaluated independently for the area/focus match and the level match — the overall score is the lower of the two.

**Area / Focus confidence**

| Signal | Score |
|--------|-------|
| Exact or near-exact phrase match between input and a focus name | High |
| Role clearly belongs to the area but focus required interpretation or inference from the description | Medium |
| Vague or generic title; best-guess assignment; input spans multiple areas | Low |

**Level confidence**

| Signal | Score |
|--------|-------|
| Explicit seniority term in the title (`Junior`, `Senior`, `Lead`, `Manager`, `Director`, `VP`, `Chief`, `C-`) | High |
| Level inferred from description (e.g., "manages a team of 5", "owns the P&L") or compensation data | Medium |
| No seniority signals present; level is a best guess or `Unknown` | Low |

**Recommended action by tier**

| Confidence | Recommended Action |
|------------|-------------------|
| High | Use as-is |
| Medium | Spot-check recommended before use in benchmarking |
| Low | Requires human review before use in benchmarking |

---

## Output Format

> **Casing rule for user-facing output:** All values are rendered in **Title Case** for visual consistency, not in the internal API enum form. Use the display values shown below in the Output Format and examples — never surface the UPPER_SNAKE_CASE enum codes to the user. When passing values to the benchmark API in a downstream skill, convert job area and level back to their API enums (see the Display → API enum tables at the end of this section); focus is passed exactly as displayed.

### Single Role

```
Job Area: [display value — Title Case]
Focus: [focus exactly as listed in the taxonomy, or None]
Level: [display value] ([numeric])
Track: [IC | Manager | Executive | Unknown]
Confidence: [High | Medium | Low]

Reasoning: [Explain how you arrived at each classification, including any signals
 from the title, description, or seniority indicators. If confidence is
 Medium or Low, explain what is uncertain and what additional information
 would resolve it.]
```

**Example — High confidence:**

```
Job Area: Engineering
Focus: DevOps and Site Reliability
Level: Senior 1 (4)
Track: IC
Confidence: High

Reasoning: "Senior DevOps Engineer" maps directly to the DevOps and Site Reliability
 focus within Engineering (exact phrase match). The "Senior" prefix is an
 explicit seniority signal indicating Senior 1 — a seasoned professional
 with full understanding of the specialization, likely with team lead
 responsibilities. Level 4 with no manager/director/lead signals → IC track.
```

**Example — Low confidence:**

```
Job Area: Project Management
Focus: None
Level: Unknown (—)
Track: Unknown
Confidence: Low

Reasoning: "Program Manager" belongs to Project Management, but nothing in the title
 says whether the work is technical, so neither Technical nor Non-Technical
 Project Management applies; it is benchmarked on Project Management
 figures. No seniority signals are present in the title to determine level,
 so track cannot be derived.
```

### Batch

```
| # | Employee ID | Job Title | Job Area | Focus | Level | Track | Confidence |
|---|-------------|-----------|----------|-------|-------|-------|------------|
| 1 | ... | ... | ... | ... | ... | ... | High |
| 2 | ... | ... | ... | ... | ... | ... | Medium |
```

Summary line:
```
N roles classified — X High · Y Medium · Z Low
```

Flagged items:
```
Flagged for review:
- Row 3 (Job Title): [reason confidence is Low]
```

---

### Display → API enum tables (for downstream API calls only)

When a downstream skill (e.g. `carta-compensation-benchmarks`) needs to call the compensation API with this classification, convert each display value to the API enum using the tables below. Do NOT surface the API enum form to the user — it is for machine handoff only.

> **First, rename the fields. This skill's output labels are NOT the API parameter names.**
>
> | This skill outputs | API parameter name |
> |---|---|
> | Job Area / `job_area` | `job` |
> | Focus | `focus` |
> | Level | `level` |
> | Track | *not passed directly* — convert to `is_leader` (`manager`/`executive` → `true`, `ic` → `false`) |
>
> ❌ `{"job_area": "ENGINEER"}` → HTTP 400. The parameter is `job`, not `job_area`.
> ✅ `{"job": "ENGINEER"}`
>
> "Job area" is the taxonomy/display term used throughout this skill and the CTC product; `job` is the wire name on `compensation:get:benchmark`. Convert the **name** as well as the value. There is no `job_area` parameter on any compensation endpoint.

**Job Area:** (values for the `job` parameter)

| Display value | API enum |
|---|---|
| Accounting | `ACCOUNTING` |
| Administrative | `ADMIN` |
| CEO | `CEO` |
| Corporate Affairs | `CORPORATE_AFFAIRS` |
| Customer Success | `CUSTOMER_SUCCESS` |
| Data | `DATA` |
| Design | `DESIGN` |
| Engineering | `ENGINEER` |
| Finance | `FINANCE` |
| Human Resources | `HR` |
| Information Technology | `IT` |
| Legal | `LEGAL` |
| Manufacturing | `MANUFACTURING` |
| Marketing | `MARKETING` |
| Operations | `OPERATIONS` |
| Product | `PRODUCT` |
| Project Management | `PROJECT_MANAGEMENT` |
| Research | `RESEARCH` |
| Sales | `SALES` |
| Strategy | `STRATEGY` |
| Support | `SUPPORT` |
| Other | `OTHER` |

**Focus:** pass the classified focus exactly as displayed — it already is the API value (`AI and Machine Learning`, `DevOps and Site Reliability`, `Financial Planning and Analysis`). The benchmark API matches focus exactly and case-sensitively, and returns the job-area figures — not an error — for any other spelling (`ai and machine learning`, `AI_AND_MACHINE_LEARNING`, `FP&A`). When the focus is `None`, omit the `focus` parameter; the figures are the job-area benchmark — say that, not that no data exists.

**Level:**

| Display value | API enum |
|---|---|
| Entry | `ENTRY` |
| Mid 1 | `MID1` |
| Mid 2 | `MID2` |
| Senior 1 | `SENIOR1` |
| Senior 2 | `SENIOR2` |
| Staff 1 | `STAFF1` |
| Staff 2 | `STAFF2` |
| Principal | `PRINCIPAL` |
| VP 1 | `VP1` |
| VP 2 | `VP2` |
| C-Level | `C_LEVEL` |
| CEO | `CEO` |
| Unknown | `UNKNOWN` |

**Track:**

| Display value | API enum |
|---|---|
| IC | `ic` |
| Manager | `manager` |
| Executive | `executive` |
| Unknown | `UNKNOWN` |

**Confidence:** not passed to the API. The display values `High` / `Medium` / `Low` correspond to the internal `HIGH` / `MEDIUM` / `LOW` tiers used in this skill.

## What next?

After delivering a classification, offer these follow-up options:

- **Look up market benchmarks** — "To pull salary and equity benchmarks for this role, just ask: 'Show me benchmarks for this role.'"
- **Classify another role** — "Want to classify another title or job description?"
- **Batch classify** — "Have a list of roles? I can classify them all at once."
