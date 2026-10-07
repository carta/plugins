# Portfolio Valuations — User Guide

## How to Start

Just say something like:

> "I want to work on my valuations today"
> "Let's review our portfolio valuations"
> "Run all my Q2 valuations"
> "Show me MangoCart's valuations"

The skill activates from those phrases. The default flow is
**dashboard → bulk-create drafts → drill-down**: see your whole
portfolio at a glance, create draft valuations across the companies that
need one, then double-click into any single company to complete, review,
and finalize it.

---

## What you'll see

### 1. Firm selection

If you have an active firm, it confirms:
> "Do you want to work with **Krakatoa Ventures**?"

Otherwise, it picks for you (one firm) or asks (multiple).

### 2. Portfolio dashboard

A snapshot of every Carta-managed direct investment with:
- Latest valuation date
- Status (Draft / Final / Archived)
- Company value
- Holdings value

Rendered as a static artifact when an artifact-rendering MCP is
available, or a markdown table otherwise. The dashboard is a snapshot —
no live refresh.

### 3. Bulk-create drafts

From the dashboard, you can create **draft** valuations across the
companies that need one in a single pass. You choose:

- **Which companies** — everything eligible, a named subset, or pick by
  row number (e.g. `1, 3, 7`).
- **A valuation date** for the run (one date applied to the whole batch).
- **An approach per company** — GPC, Manual EV, or Post-Money (a recent
  financing round). Each company defaults to a roll-forward of its last
  period where one exists.

Every valuation is created as a **Draft** — nothing is finalized
automatically. Approaches that need extra inputs (comps for GPC, the
transaction price for Backsolve, the round details for Post-Money) are
configured afterward, per company.

### 4. Run progress

As the batch runs, you'll see per-company progress and an end-of-run
summary listing each company, its approach, and a link to open it in
Carta. Failures are isolated — one company failing doesn't stop the
rest.

### 5. Drill into one to finish it

After the batch, the follow-up menu lets you:

- **Dig into a specific holding** — open one company and work through it
  step by step (cap table, financials, set approaches, comps, GPC
  analysis, allocation, audit notes, **finalize**).
- **Ask about your portfolio** — which holdings are most overdue, how a
  new round affects a valuation, current status.
- **Export** — download a tearsheet for a holding, or export the
  portfolio SOI.

Finalizing happens **per company** inside the drill-down, once its
company value and holdings value are in place — there is no bulk
"finalize everything" step.

### 6. Single-company shortcut

Naming one company up front ("show me MangoCart's valuations") skips
the dashboard and batch picker — you go straight to that company's
valuation list and the interactive routing table. Good for a quick
look at one specific thing.

---

## Interactive drill-down

Once you're inside a single candidate (either via shortcut or by
drilling in from Step 5), say what you want:

- **"Pull cap table"** → shows share classes and ownership.
- **"Show financials"** → renders the latest revenue / EBITDA / KPIs.
- **"Run GPC analysis"** → configures methodology, picks multiples,
  shows quartile statistics.
- **"Find comps"** / **"Update comps"** → browse industry suggestions,
  search by ticker, or edit the saved set.
- **"Run allocation"** / **"Run waterfall"** / **"Run OPM"** →
  distributes the company value across share classes.
- **"Set approaches"** / **"Use GPC"** / **"Manual EV"** → configures
  which valuation approach the candidate uses.
- **"Draft audit notes"** / **"Summarize rationales"** → produces a
  narrative memo for workpapers (chat-only, doesn't write to the DB).
- **"Finalize this valuation"** → marks the candidate FINAL after
  verifying prerequisites (positive EV, positive holdings). Because this
  can't be undone, you'll be asked to confirm first.

Other changes are saved as soon as you ask for them — there's no "are
you sure?" step. After each save you'll see exactly what changed
(previous value → saved value, numbers in full) so you can check it and
ask for a fix if anything is off.

Ask **"what's left?"** or **"am I done?"** at any time to see the
End Goal checklist:

1. Cap table data is present
2. Financials data is present
3. Required approach inputs are in place
4. Company value is positive
5. Holdings value is positive
6. Status is FINAL

---

## Deleting a Valuation

If you ask to delete a valuation, you'll be shown a warning and asked
to type **YES** (all capitals) to confirm. Any other response cancels
the deletion.
