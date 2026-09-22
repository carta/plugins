#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""emit_stem_sql.py — single source of truth for the DWH stem SQL + batch emitter.

Every stem's SQL is fully STATIC: none of it filters by a hand-templated
`fund_uuid IN (...)` list. `funds` is scoped by the MCP `set_context` call (no
`firm_id` filter needed); `financials`/`forecasts` are likewise context-scoped;
`holdings`/`fdshares`/`deal_irr` reach fund scope through a `NOT ILIKE '%SPV%'`
subquery over `MONTHLY_NAV_CALCULATIONS` instead of an IN-list read back out of
a previously-fetched stem; `capstack` has no fund/firm column to
filter on at all. So there is no `fund_uuids.txt` step and no substitution
slot — this is simpler than the fund-modeling equivalent (see
`carta-fund-modeling/scripts/emit_stem_sql.py`), which still fills a
`{fund_uuids}` IN-list per firm.

Two runtime parameters, both for `financials` and `forecasts` only (the two
time-series stems), both injected into the WHERE clause before the QUALIFY:
  --since YYYY-MM-DD      the history window, `period_end >= '<since>'`
  --after-instance N      an incremental floor, `instance_id > N` — the in-app
                          refresh passes the cached stem's max instance_id so
                          only submissions logged since the last pull come back.

Usage:
  uv run emit_stem_sql.py batch [--since YYYY-MM-DD]
      Prints a JSON array of `dwh__execute__queries` batch objects:
      {"batch": int, "format": "ndjson", "limit": 10000,
       "stems": [str, ...], "queries": [str, ...]}
      with stems[i] aligned to queries[i]. Covers the 5 light stems only
      (`_BATCH_ORDER`) -- financials/forecasts are excluded and must be
      fetched via their own sql <stem> paged calls (see SKILL.md Step 2).
      All 5 fit in one batch (the cap is 10 queries per batch).
  uv run emit_stem_sql.py sql <stem> [--since YYYY-MM-DD] [--after-instance N]
      Prints one stem's SQL verbatim (for paging or re-running a single stem;
      resolves any of the 9 stems, including the paged-separately
      financials/forecasts/holdings_history/entity_identity).

Stdlib-only, Python 3.9-safe.
"""
import argparse
import json
import re
import sys

_ORDER = ["funds", "financials", "forecasts", "holdings", "fdshares",
          "deal_irr", "capstack", "holdings_history", "entity_identity", "corporation_links"]
# The batch is deliberately a SUBSET of _ORDER: financials/forecasts are large
# paged stems (dedup over COMPANY_FINANCIALS, ~4.7MB on a large firm) that can
# push a single parallel dwh__execute__queries call past the MCP session/exec
# timeout. They are fetched separately via their own singular paged `sql`
# calls (see SKILL.md Step 2) instead of riding along in the batch.
_BATCH_ORDER = ["funds", "holdings", "fdshares", "deal_irr", "capstack"]
_MAX_PER_BATCH = 10

# Both runtime values are interpolated into SQL, so they are shape-checked first.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_SPV_SCOPE = (
    "(SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS\n"
    "                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')"
)

# Paging contract: each stem ends with a UNIQUE total order over its own SELECT
# columns. The MCP hoists that trailing ORDER BY onto its LIMIT/OFFSET wrapper, so a
# non-unique or non-output ordering lets tied rows overlap and drop across pages.
_FUNDS_SQL = (
    "SELECT DISTINCT fund_uuid, fund_name, entity_type_name\n"
    "FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS\n"
    "WHERE is_firm_rollup = FALSE\n"
    "  AND entity_type_name NOT ILIKE '%SPV%'\n"
    "ORDER BY entity_type_name, fund_name, fund_uuid"
)

# Dedup tie-break mirrors the financials service's latest-filing order: as_of_date,
# then instance_id (monotonic instance surrogate) — as_of_date alone ties nondeterministically.
# instance_id is SELECTed so a refresh can read the cached max back as its incremental floor.
# general_ledger_issuer_id / corporation_id (a UUID here) / llc_entity_id are the row's
# identity keys for the builder's company_key(); per-issuer constants, so the QUALIFY is unaffected.
_FINANCIALS_TEMPLATE = (
    "SELECT legal_name, name, mnemonic, report_type, unit_type, currency,\n"
    "       float_value, string_value, period_end, period_start, frequency, as_of_date,\n"
    "       instance_id, general_ledger_issuer_id, corporation_id, llc_entity_id\n"
    "FROM FUND_ADMIN.COMPANY_FINANCIALS\n"
    "WHERE instance_type = 'Actual'\n"
    "  AND (float_value IS NOT NULL OR (string_value IS NOT NULL AND string_value <> ''))\n"
    "  AND as_of_date <= CURRENT_DATE          -- ignore forward-dated submissions\n"
    "{since_clause}"
    "{after_clause}"
    "QUALIFY ROW_NUMBER() OVER (\n"
    "    PARTITION BY legal_name, COALESCE(mnemonic, name),\n"
    "                 COALESCE(frequency, ''), period_end\n"
    "    ORDER BY as_of_date DESC NULLS LAST, instance_id DESC) = 1\n"
    "ORDER BY legal_name, COALESCE(mnemonic, name), COALESCE(frequency, ''), period_end"
)
_FINANCIALS_SINCE_PLACEHOLDER = (
    "  -- OPTIONAL history window; add only when the user chose one (see SKILL Step 1b):\n"
    "  -- AND period_end >= '<since>'\n"
)

_FORECASTS_TEMPLATE = (
    "SELECT legal_name, name, mnemonic, unit_type, currency,\n"
    "       as_of_date, period_end, float_value, is_latest, instance_id,\n"
    "       general_ledger_issuer_id, corporation_id, llc_entity_id\n"  # identity keys for company_key()
    "FROM FUND_ADMIN.COMPANY_FINANCIALS\n"
    "WHERE instance_type = 'Estimate' AND float_value IS NOT NULL\n"
    "{since_clause}"
    "{after_clause}"
    "ORDER BY legal_name, name, mnemonic, period_end, as_of_date,\n"
    "         unit_type, currency, float_value, is_latest, instance_id"
)
_FORECASTS_SINCE_PLACEHOLDER = (
    "  -- Same optional window, applied to the TARGET period (never to as_of_date — a\n"
    "  -- recent forecast about an old quarter is exactly what the accuracy backtest needs):\n"
    "  -- AND period_end >= '<since>'\n"
)
_AFTER_PLACEHOLDER = (
    "  -- OPTIONAL incremental floor; the in-app refresh sets it to the cached max instance_id:\n"
    "  -- AND instance_id > <after_instance>\n"
)

_HOLDINGS_SQL = (
    "SELECT issuer_name, fund_uuid, asset_name, asset_class_type, count_remaining_shares,\n"
    "       remaining_value, remaining_value_per_share, latest_fmv_effective_date,\n"
    "       total_cost, total_proceeds, total_unrealized_gain_loss, investment_date, tags_json,\n"
    "       is_active_investment, is_option_or_warrant_asset, is_public_asset,\n"
    "       entity_link_id, general_ledger_issuer_id,\n"  # identity keys for company_key()
    "       fund_investment_key\n"  # unique per row; the paging tiebreaker below
    "FROM FUND_ADMIN.AGGREGATE_INVESTMENTS\n"
    "WHERE fund_uuid IN " + _SPV_SCOPE + "\n"
    "ORDER BY issuer_name, fund_uuid, asset_name, asset_class_type, fund_investment_key"
)

# One row per (corporation, fund): the fund's own fully-diluted PERCENTAGE of the
# company, straight from the warehouse — Carta already computes it, we just keep
# it. The builder both SUMS these into the firm-wide ownership figure AND retains
# the per-fund rows for the "ownership by fund" breakdown. (This used to SUM in
# SQL and emit one collapsed row per corporation; that threw the per-fund detail
# away.) `own_pct` stays a 0-1 fraction; FD/as-of ride along per fund so the
# builder can pick the freshest snapshot. FINANCING_HISTORY supplies the last
# round and the display name (one row per corporation, repeated across its funds).
_FDSHARES_SQL = (
    "WITH own AS (\n"
    "  SELECT CORPORATION_ID, FUND_ID, AS_OF_DATE, FULLY_DILUTED, OWNERSHIP_QUANTITY,\n"
    "         TRY_TO_NUMBER(PERCENTAGE, 38, 18) AS own_pct\n"
    "  FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP\n"
    "  WHERE FUND_ID IN " + _SPV_SCOPE + "\n"
    "    AND FULLY_DILUTED > 1000 AND IS_PRO_FORMA = FALSE\n"
    "  QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, FUND_ID ORDER BY AS_OF_DATE DESC)=1\n"
    "),\n"
    "fin AS (\n"
    "  SELECT corporation_id, investment_name, round, post_money_valuation,\n"
    "         COALESCE(closing_date, raised_date) AS round_date\n"
    "  FROM FUND_ADMIN.FINANCING_HISTORY\n"
    "  QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_id ORDER BY COALESCE(closing_date, raised_date) DESC NULLS LAST)=1\n"
    ")\n"
    "SELECT o.CORPORATION_ID AS corporation_id, f.investment_name AS name,\n"
    "       o.FUND_ID AS fund_id, o.own_pct, o.OWNERSHIP_QUANTITY AS own_qty,\n"
    "       o.FULLY_DILUTED AS fd_shares, o.AS_OF_DATE AS as_of,\n"
    "       f.round, f.post_money_valuation AS post_money, f.round_date\n"
    "FROM own o\n"
    "JOIN fin f ON o.CORPORATION_ID = f.corporation_id\n"
    "WHERE f.investment_name IS NOT NULL\n"
    "ORDER BY corporation_id, fund_id"  # one row per (corp, fund) — unique
)

_DEAL_IRR_SQL = (
    "SELECT issuer_name, fund_uuid, deal_irr, performance_quarter_end_date\n"
    "FROM FUND_ADMIN.TEMPORAL_DEAL_IRR\n"
    "WHERE fund_uuid IN " + _SPV_SCOPE + "\n"
    "QUALIFY ROW_NUMBER() OVER (PARTITION BY issuer_name, fund_uuid\n"
    "                           ORDER BY performance_quarter_end_date DESC, deal_irr DESC)=1\n"
    "ORDER BY issuer_name, fund_uuid"  # one row per (issuer, fund) from the QUALIFY — unique
)

_CAPSTACK_SQL = (
    "WITH corp AS (\n"
    "  SELECT corporation_uuid, corporation_name\n"
    "  FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2\n"
    "  WHERE corporation_uuid IS NOT NULL\n"
    "  QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_uuid ORDER BY last_refreshed_at DESC) = 1\n"
    ")\n"
    "SELECT s.legal_name, COALESCE(c.corporation_name, s.legal_name) AS corp_name,\n"
    "       s.corporation_id, s.security_class_id, s.security_class_name,\n"
    "       s.security_class_type, s.security_class_type_detailed, s.as_converted_shareclass_name,\n"
    "       s.outstanding_shares, s.fully_diluted_quantity, s.authorized_shares,\n"
    "       s.fully_diluted_ownership, s.plan_size, s.shares_available_under_plan,\n"
    "       s.weighted_average_exercise_price, s.original_issue_price, s.conversion_ratio,\n"
    "       s.conversion_price, s.seniority, s.multiplier, s.participating_preferred,\n"
    "       s.preference_cap, s.dividend_coupon, s.dividend_type, s.dividend_accrual,\n"
    "       s.is_compounding, s.earliest_issue_date, s.as_of_date,\n"
    "       s.cash_raised:USD::NUMBER AS cash_raised_usd,\n"
    "       s.principal:USD::NUMBER   AS principal_usd,\n"
    "       s.interest:USD::NUMBER    AS interest_usd\n"
    "FROM FUND_ADMIN.SUMMARY_CAP_TABLE s\n"
    "LEFT JOIN corp c ON c.corporation_uuid = s.corporation_id\n"
    "QUALIFY ROW_NUMBER() OVER (PARTITION BY s.corporation_id, s.security_class_id\n"
    "                           ORDER BY s.as_of_date DESC) = 1\n"
    "ORDER BY corporation_id, security_class_id"  # one row per (corp, class) — unique
)

# The historical (time-series) twin of `holdings` — one row per position per
# EFFECTIVE_DATE, so the app can draw a value-per-share / FMV / cost line over
# time on Company 360. Large, paged sibling of `holdings`: fetched via its own
# paged `sql holdings_history` call, NOT in the light batch (excluded from
# `_BATCH_ORDER`), exactly like `financials`/`forecasts`. Columns verified on the
# live warehouse.
#
# This is an event-driven slowly-changing dimension: each row is one position lot
# valid over the half-open interval [EFFECTIVE_DATE, NEXT_EFFECTIVE_DATE) (NULL
# next = still current). A given EFFECTIVE_DATE carries ONLY the lots that changed
# that day, not the whole portfolio — so the builder reconstructs an as-of total
# by summing every lot whose interval covers each date. NEXT_EFFECTIVE_DATE is
# load-bearing for that; without it the per-date sum is a partial (wrong) total.
# Firm/SPV-scoped via `fund_uuid` like `holdings`.
_HOLDINGS_HISTORY_SQL = (
    "SELECT issuer_name, fund_uuid, asset_name, asset_class_type,\n"
    "       effective_date, next_effective_date, is_current_state,\n"
    "       count_remaining_shares, remaining_value, remaining_value_per_share,\n"
    "       total_cost, total_unrealized_gain_loss, total_proceeds,\n"
    "       is_option_or_warrant_asset, entity_link_id, general_ledger_issuer_id, _pk\n"  # _pk unique per row; the paging tiebreaker below
    "FROM FUND_ADMIN.AGGREGATE_INVESTMENTS_HISTORY\n"
    "WHERE fund_uuid IN " + _SPV_SCOPE + "\n"
    "ORDER BY issuer_name, fund_uuid, asset_name, asset_class_type,\n"
    "         effective_date, next_effective_date, _pk"
)

# One row per (firm, entity link) — every portfolio company the firm tracks, including
# paper corporations and GL-only issuers whose corporation columns are NULL. It is the
# bridge from a holdings/KPI row's key to the Carta corporation (numeric id, UUID,
# is_carta_customer). Context-scoped; no corporation filter, or the non-customers vanish.
_ENTITY_IDENTITY_SQL = (
    "SELECT entity_link_id, corporation_id, corporation_uuid, is_carta_customer, corporation_name\n"
    "FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2\n"
    "ORDER BY corporation_name, entity_link_id"  # entity_link_id is per-firm unique — a total order
)

# One row per (GL issuer, corporation) link; an issuer often links to several corporations.
# It is how a KPI or cap-table row keyed only by corporation UUID reaches its entity link.
_CORPORATION_LINKS_SQL = (
    "SELECT general_ledger_issuer_id, corporation_id, is_carta_customer\n"
    "FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS\n"
    "ORDER BY general_ledger_issuer_id, corporation_id"
)


def _check_since(since):
    if since is not None and not _DATE_RE.match(since):
        raise ValueError("--since must be YYYY-MM-DD, got %r" % (since,))
    return since


def _check_after_instance(after_instance):
    if after_instance is not None and (not isinstance(after_instance, int) or after_instance < 0):
        raise ValueError("--after-instance must be a non-negative integer, got %r" % (after_instance,))
    return after_instance


def _stems(since=None, after_instance=None):
    """Return an ordered dict {stem: sql}, `_ORDER`-aligned. `since` ('YYYY-MM-DD')
    injects `AND period_end >= '<since>'` and `after_instance` (int) injects
    `AND instance_id > <after_instance>`, each into `financials` and `forecasts`
    only — the two time-series stems — in place of their placeholder comment,
    before the QUALIFY."""
    _check_since(since)
    _check_after_instance(after_instance)
    if since:
        financials_since = "  AND period_end >= '%s'\n" % since
        forecasts_since = "  AND period_end >= '%s'\n" % since
    else:
        financials_since = _FINANCIALS_SINCE_PLACEHOLDER
        forecasts_since = _FORECASTS_SINCE_PLACEHOLDER
    if after_instance is not None:
        after = "  AND instance_id > %d\n" % after_instance
    else:
        after = _AFTER_PLACEHOLDER

    out = {
        "funds": _FUNDS_SQL,
        "financials": _FINANCIALS_TEMPLATE.format(since_clause=financials_since, after_clause=after),
        "forecasts": _FORECASTS_TEMPLATE.format(since_clause=forecasts_since, after_clause=after),
        "holdings": _HOLDINGS_SQL,
        "fdshares": _FDSHARES_SQL,
        "deal_irr": _DEAL_IRR_SQL,
        "capstack": _CAPSTACK_SQL,
        "holdings_history": _HOLDINGS_HISTORY_SQL,
        "entity_identity": _ENTITY_IDENTITY_SQL,
        "corporation_links": _CORPORATION_LINKS_SQL,
    }
    return {stem: out[stem] for stem in _ORDER}


def batches(since=None):
    """Group the 5 light (non-paged) stems into `dwh__execute__queries` batch
    objects of at most `_MAX_PER_BATCH` queries, preserving `_BATCH_ORDER`.
    `financials`/`forecasts` are excluded — see `_BATCH_ORDER` comment above.
    `stems[i]` aligns with `queries[i]` so the caller can map each result back
    to its stem."""
    all_stems = _stems(since)
    items = [(stem, all_stems[stem]) for stem in _BATCH_ORDER]
    out = []
    for i in range(0, len(items), _MAX_PER_BATCH):
        chunk = items[i:i + _MAX_PER_BATCH]
        out.append({
            "batch": len(out),
            "format": "ndjson",
            "limit": 10000,
            "stems": [s for s, _ in chunk],
            "queries": [sql for _, sql in chunk],
        })
    return out


def main(argv):
    ap = argparse.ArgumentParser(description="Emit static Fund Admin stem SQL.")
    sub = ap.add_subparsers(dest="command", required=True)

    p_batch = sub.add_parser("batch", help="print the 5 light stems as dwh__execute__queries batches")
    p_batch.add_argument("--since", metavar="YYYY-MM-DD",
                          help="inject a period_end history window into financials/forecasts")

    p_sql = sub.add_parser("sql", help="print one stem's SQL")
    p_sql.add_argument("stem", choices=_ORDER)
    p_sql.add_argument("--since", metavar="YYYY-MM-DD",
                        help="inject a period_end history window into financials/forecasts")
    p_sql.add_argument("--after-instance", metavar="N", type=int,
                        help="inject an incremental floor `instance_id > N` into financials/forecasts")

    a = ap.parse_args(argv[1:])

    try:
        if a.command == "batch":
            sys.stdout.write(json.dumps(batches(a.since), ensure_ascii=False) + "\n")
            return 0
        sys.stdout.write(_stems(a.since, a.after_instance)[a.stem] + "\n")
    except ValueError as e:
        sys.stderr.write("emit_stem_sql: %s\n" % e)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
