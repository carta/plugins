#!/usr/bin/env python3
"""stem_queries.py — the executable manifest of Fund Admin stem SQL.

Single source of truth for the DWH `dwh__execute__query` stems. Each entry pairs
the exact SELECT from references/queries.md (with one substitution slot for the
IN-list) with the `limit`/`format` args and the fetch wave. `emit_stem_sql.py`
reads this to print ready-to-run queries so the LLM never hand-templates SQL or
pastes an IN-list by hand.

`sql` carries a single ``{fund_uuids}`` slot (matching ``id_param``);
`emit_stem_sql.py` fills it with a quoted, comma-joined IN-list. **Every stem is
fund-scoped**, so `wave` is 1 for all of them and the whole fetch is one concurrent
batch (SKILL.md Step 2) with no ordering dependency between stems. The three
corporation-filtered stems (`financing`, `captable`, `corporations`) reach their
corporation scope through a subquery — see ``_CORP_SCOPE``.

`limit` is capped at **10,000** for every stem because that is the DWH's real
ceiling — the server clamps any higher value (`min(limit, 10000)`) and reports the
remainder via `next_offset`. Declaring 20,000 was misleading: it read as headroom
while the query was in fact being cut off. A stem whose data exceeds 10,000 rows is
handled by pagination, not by a bigger number — `save_query_result.py` flags the
short page and `build_datadir.py` refuses to build until it is completed.

Keep each `sql` in lockstep with its queries.md section — the STEM_CONTRACT
drift-guard test asserts every stem's SELECT still covers the builder's
load-bearing columns. Stdlib-only, Python 3.9-safe.
"""

# The corporation scope, expressed server-side.
#
# `financing`, `captable` and `corporations` filter by corporation, not by fund.
# They used to take an explicit ``{corporation_ids}`` IN-list that the LLM read out
# of the wave-1 `ownership` result and pasted back in — ~1,150 UUIDs for a mid-size
# firm, too long for one call, so it got hand-chunked into ~4 calls *per stem*, each
# costing minutes of pure token emission (measured: ~15 min for `financing` alone on
# a 15-fund firm). Reading the same set back out of FUND_CORPORATION_OWNERSHIP in a
# subquery keeps every stem fund-scoped: one wave, no ownership dependency, ~900
# chars of SQL instead of ~47,000.
#
# This reproduces the old scope exactly. `ownership`'s own QUALIFY only dedupes to
# the latest AS_OF_DATE per (CORPORATION_ID, FUND_ID) pair, so it never narrows the
# distinct corporation set. It is also strictly *more* correct: the old path was
# bounded by `ownership`'s own row `limit`, so a firm large enough to truncate
# `ownership` silently narrowed all three stems' scope.
_CORP_SCOPE = (
    "(SELECT DISTINCT CORPORATION_ID FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP\n"
    "                        WHERE FUND_ID IN ({fund_uuids}))"
)

# stem -> {id_param, wave, limit, format, sql}
STEMS = {
    "nav_latest": {
        "id_param": "fund_uuids", "wave": 1, "limit": 200, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, fund_name, entity_type_name,\n"
            "       cumulative_commitment_amount, cumulative_lp_contributions,\n"
            "       cumulative_gp_contributions,\n"
            "       cumulative_lp_distributions, ending_lp_nav, ending_gp_nav,\n"
            "       lp_dpi, lp_rvpi, lp_tvpi, month_end_date\n"
            "FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS\n"
            "WHERE fund_uuid IN ({fund_uuids}) AND is_firm_rollup = FALSE\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC)=1"
        ),
    },
    "investments": {
        "id_param": "fund_uuids", "wave": 1, "limit": 5000, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, issuer_name, entity_link_id, general_ledger_issuer_id,\n"
            "       asset_name, asset_class_type, investment_date,\n"
            "       SUM(total_cost) AS total_cost,\n"
            "       SUM(remaining_value) AS remaining_value,\n"
            "       SUM(total_proceeds) AS total_proceeds,\n"
            "       SUM(count_remaining_shares) AS count_remaining_shares,\n"
            "       MAX(is_active_investment) AS is_active_investment,\n"
            "       MAX(is_public_asset) AS is_public_asset,\n"
            "       MAX(latest_fmv_effective_date) AS latest_fmv_effective_date,\n"
            "       MAX(latest_update_effective_date) AS latest_update_effective_date\n"
            "FROM FUND_ADMIN.AGGREGATE_INVESTMENTS\n"
            "WHERE fund_uuid IN ({fund_uuids})\n"
            "GROUP BY fund_uuid, issuer_name, entity_link_id, general_ledger_issuer_id,\n"
            "         asset_name, asset_class_type, investment_date\n"
            "ORDER BY remaining_value DESC NULLS LAST"
        ),
    },
    "cashflows": {
        "id_param": "fund_uuids", "wave": 1, "limit": 10000, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, month_end_date, lp_contributions, lp_distributions,\n"
            "       ending_lp_nav, cumulative_lp_contributions, cumulative_lp_distributions\n"
            "FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS\n"
            "WHERE fund_uuid IN ({fund_uuids}) AND is_firm_rollup = FALSE\n"
            "ORDER BY month_end_date"
        ),
    },
    "fund_metrics": {
        "id_param": "fund_uuids", "wave": 1, "limit": 50, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, dry_powder, total_mgmt_fees, total_opx,\n"
            "       fund_reporting_currency, vintage_year, vintage_date, total_moic\n"
            "FROM FUND_ADMIN.AGGREGATE_FUND_METRICS\n"
            "WHERE fund_uuid IN ({fund_uuids})\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid "
            "ORDER BY month_end_date DESC, last_refreshed_at DESC)=1"
        ),
    },
    "accrued_carry": {
        "id_param": "fund_uuids", "wave": 1, "limit": 200, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, SUM(ACTUAL_AMOUNT) AS accrued_carry, MAX(EFFECTIVE_DATE) AS as_of\n"
            "FROM FUND_ADMIN.ALLOCATIONS\n"
            "WHERE ALLOCATION_BUCKET_NAME = 'Carried interest accrued'\n"
            "  AND IS_GENERAL_PARTNER = TRUE\n"
            "  AND fund_uuid IN ({fund_uuids})\n"
            "GROUP BY fund_uuid"
        ),
    },
    "distributed_carry": {
        "id_param": "fund_uuids", "wave": 1, "limit": 200, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, ABS(SUM(ACTUAL_AMOUNT)) AS carry_distributed, MAX(EFFECTIVE_DATE) AS as_of\n"
            "FROM FUND_ADMIN.ALLOCATIONS\n"
            "WHERE ALLOCATION_BUCKET_NAME = 'Carried interest earned'\n"
            "  AND IS_GENERAL_PARTNER = TRUE\n"
            "  AND fund_uuid IN ({fund_uuids})\n"
            "GROUP BY fund_uuid"
        ),
    },
    "cohort": {
        "id_param": "fund_uuids", "wave": 1, "limit": 2000, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, performance_quarter_start_date,\n"
            "       vintage_year, fund_aum_bucket, entity_type_name, fund_count,\n"
            "       tvpi, net_irr, dpi, moic,\n"
            "       tvpi_5, tvpi_10, tvpi_25, tvpi_50, tvpi_75, tvpi_90, tvpi_95,\n"
            "       net_irr_50th, net_irr_75th, net_irr_90th,\n"
            "       dpi_5, dpi_10, dpi_25, dpi_50, dpi_75, dpi_90, dpi_95,\n"
            "       moic_5, moic_10, moic_25, moic_50, moic_75, moic_90, moic_95\n"
            "FROM FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS\n"
            "WHERE fund_uuid IN ({fund_uuids})\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid "
            "ORDER BY performance_quarter_start_date DESC) <= 8"
        ),
    },
    "partners": {
        "id_param": "fund_uuids", "wave": 1, "limit": 5000, "format": "ndjson",
        "sql": (
            "SELECT partner_name, partner_country, partner_state, fund_uuid,\n"
            "       PARTNER_CLASS_NAME AS partner_class_name,\n"
            "       TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS commitment,\n"
            "       TOTAL_CAP_CONTRIBUTION                   AS contributed,\n"
            "       TOTAL_DISTRIBUTION                       AS distributed,\n"
            "       TOTAL_NET_ASSET_BALANCE                  AS nav\n"
            "FROM FUND_ADMIN.PARTNER_DATA\n"
            "WHERE fund_uuid IN ({fund_uuids}) AND IS_LIMITED_PARTNER = TRUE\n"
            "ORDER BY commitment DESC NULLS LAST"
        ),
    },
    "gp_partners": {
        "id_param": "fund_uuids", "wave": 1, "limit": 5000, "format": "ndjson",
        "sql": (
            "SELECT partner_name, partner_country, partner_state, fund_uuid,\n"
            "       TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS commitment,\n"
            "       TOTAL_CAP_CONTRIBUTION                   AS contributed,\n"
            "       TOTAL_DISTRIBUTION                       AS distributed,\n"
            "       TOTAL_NET_ASSET_BALANCE                  AS nav\n"
            "FROM FUND_ADMIN.PARTNER_DATA\n"
            "WHERE fund_uuid IN ({fund_uuids}) AND IS_GENERAL_PARTNER = TRUE\n"
            "ORDER BY commitment DESC NULLS LAST"
        ),
    },
    "gp_carry": {
        "id_param": "fund_uuids", "wave": 1, "limit": 500, "format": "ndjson",
        "sql": (
            "WITH gp_map AS (\n"
            "  SELECT DISTINCT GP_ENTITY_NAME, FUND_UUID, FUND_NAME\n"
            "  FROM FUND_ADMIN.ALLOCATIONS\n"
            "  WHERE ALLOCATION_BUCKET_NAME = 'Carried interest accrued'\n"
            "    AND ENTITY_TYPE_NAME = 'Fund' AND IS_GENERAL_PARTNER = TRUE\n"
            "    AND GP_ENTITY_NAME IS NOT NULL\n"
            "    AND FUND_UUID IN ({fund_uuids})\n"
            ")\n"
            "SELECT m.FUND_UUID AS fund_uuid, m.FUND_NAME AS fund_name,\n"
            "       a.FUND_NAME AS gp_entity_name, a.PARTNER_NAME AS partner_name,\n"
            "       MAX(a.PARTNER_TYPE) AS partner_type,\n"
            "       ROUND(SUM(a.ACTUAL_AMOUNT)) AS accrued_carry\n"
            "FROM FUND_ADMIN.ALLOCATIONS a\n"
            "JOIN gp_map m ON m.GP_ENTITY_NAME = a.FUND_NAME\n"
            "WHERE a.ALLOCATION_BUCKET_NAME = 'Carried interest accrued'\n"
            "  AND a.ENTITY_TYPE_NAME = 'GP'\n"
            "GROUP BY 1, 2, 3, 4"
        ),
    },
    "waterfall": {
        "id_param": "fund_uuids", "wave": 1, "limit": 2000, "format": "ndjson",
        "sql": (
            "SELECT fund_id, fund_name, config_name, carry_rate, preferred_return,\n"
            "       gp_catchup_rate, gp_catchup_limit, recommended_config_rank, is_automated\n"
            "FROM FUND_ADMIN.PROFIT_ALLOCATION_WATERFALL_CONFIG\n"
            "WHERE fund_id IN ({fund_uuids})"
        ),
    },
    "deal_irr": {
        "id_param": "fund_uuids", "wave": 1, "limit": 2000, "format": "ndjson",
        "sql": (
            "SELECT fund_uuid, issuer_name, deal_irr, performance_quarter_end_date\n"
            "FROM FUND_ADMIN.TEMPORAL_DEAL_IRR\n"
            "WHERE fund_uuid IN ({fund_uuids})\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid, issuer_id "
            "ORDER BY performance_quarter_end_date DESC)=1"
        ),
    },
    "ownership": {
        "id_param": "fund_uuids", "wave": 1, "limit": 5000, "format": "ndjson",
        "sql": (
            "SELECT FUND_ID, CORPORATION_ID, PERCENTAGE, AS_OF_DATE\n"
            "FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP\n"
            "WHERE FUND_ID IN ({fund_uuids})\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, FUND_ID "
            "ORDER BY AS_OF_DATE DESC)=1"
        ),
    },
    "financing": {
        "id_param": "fund_uuids", "wave": 1, "limit": 3000, "format": "ndjson",
        "sql": (
            "SELECT investment_name, round, post_money_valuation, "
            "COALESCE(closing_date, raised_date) AS round_date, corporation_id\n"
            "FROM FUND_ADMIN.FINANCING_HISTORY\n"
            "WHERE corporation_id IN " + _CORP_SCOPE + "\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_id "
            "ORDER BY COALESCE(closing_date, raised_date) DESC NULLS LAST)=1"
        ),
    },
    # Per-share-class cap table + liquidation-preference terms (§15). Corporation-
    # filtered like `financing`, scoped via _CORP_SCOPE. Latest snapshot per
    # (CORPORATION_ID, SECURITY_CLASS_ID). Optional / non-gating in the builder: a
    # firm with no Carta cap tables just yields an empty file.
    #
    # NOTE: the underlying table is large — SUMMARY_CAP_TABLE scans ~1.04M rows for a
    # 15-fund firm before QUALIFY collapses it to ~5,200. That is comfortably the
    # biggest stem, and its 20000 `limit` is silently clamped to 10000 server-side,
    # so a firm with roughly double that share-class count would truncate without
    # warning. Tracked separately.
    "captable": {
        "id_param": "fund_uuids", "wave": 1, "limit": 10000, "format": "ndjson",
        "sql": (
            "SELECT CORPORATION_ID, SECURITY_CLASS_ID, SECURITY_CLASS_NAME,\n"
            "       SECURITY_CLASS_TYPE_DETAILED, SENIORITY, MULTIPLIER,\n"
            "       PARTICIPATING_PREFERRED, PREFERENCE_CAP, ORIGINAL_ISSUE_PRICE,\n"
            "       CONVERSION_RATIO, CONVERSION_PRICE, OUTSTANDING_SHARES,\n"
            "       FULLY_DILUTED_QUANTITY, FULLY_DILUTED_OWNERSHIP, CASH_RAISED,\n"
            "       DIVIDEND_TYPE, DIVIDEND_COUPON, IS_COMPOUNDING, AS_OF_DATE\n"
            "FROM FUND_ADMIN.SUMMARY_CAP_TABLE\n"
            "WHERE CORPORATION_ID IN " + _CORP_SCOPE + "\n"
            "QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, SECURITY_CLASS_ID "
            "ORDER BY AS_OF_DATE DESC)=1"
        ),
    },
    # corporations: CORPORATION_BASIC_INFO_V2 — the entity_link -> corporation bridge
    # every other corp enrichment resolves through. The table is itself row-scoped to
    # the active firm context, so the filter is belt-and-braces rather than load-
    # bearing; it stays because the manifest has no firm-context/no-IN-list mechanism
    # (see test_manifest_id_param_matches_placeholder, which requires every stem's
    # declared id_param placeholder to appear literally in its SQL). Note the join key:
    # this table's `corporation_uuid` IS ownership's `CORPORATION_ID`. Optional — a firm
    # whose portcos aren't Carta cap-table customers has no rows, so a missing/empty
    # file must NOT gate the build.
    "corporations": {
        "id_param": "fund_uuids", "wave": 1, "limit": 10000, "format": "ndjson",
        "sql": (
            "SELECT entity_link_id, corporation_uuid, corporation_name\n"
            "FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2\n"
            "WHERE corporation_uuid IN " + _CORP_SCOPE
        ),
    },
}


# Optional "wide" variant per stem — a builder-compatible SUPERSET query used to
# force a small firm's result over the harness auto-persist threshold, so it lands
# in a tool-results file (captured by path) instead of coming back inline and
# needing a stdin pipe. `SELECT *` is safe wherever the builder reads its columns
# by raw name; the two stems whose builder columns are SQL *aliases*
# (`partners` -> commitment/contributed/…, `financing` -> round_date) keep those
# alias expressions alongside the star so the columns still exist. `investments`
# drops the GROUP BY (lot-level rows — the builder re-aggregates per issuer).
# The GROUP-BY carry stems are omitted: they are per-fund tiny and can't `SELECT *`.
WIDE = {
    "nav_latest": (
        "SELECT * FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS\n"
        "WHERE fund_uuid IN ({fund_uuids}) AND is_firm_rollup = FALSE\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC)=1"
    ),
    "investments": (
        "SELECT * FROM FUND_ADMIN.AGGREGATE_INVESTMENTS\n"
        "WHERE fund_uuid IN ({fund_uuids})\n"
        "ORDER BY remaining_value DESC NULLS LAST"
    ),
    "cashflows": (
        "SELECT * FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS\n"
        "WHERE fund_uuid IN ({fund_uuids}) AND is_firm_rollup = FALSE\n"
        "ORDER BY month_end_date"
    ),
    "fund_metrics": (
        "SELECT * FROM FUND_ADMIN.AGGREGATE_FUND_METRICS\n"
        "WHERE fund_uuid IN ({fund_uuids})\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid "
        "ORDER BY month_end_date DESC, last_refreshed_at DESC)=1"
    ),
    "cohort": (
        "SELECT * FROM FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS\n"
        "WHERE fund_uuid IN ({fund_uuids})\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid "
        "ORDER BY performance_quarter_start_date DESC) <= 8"
    ),
    "deal_irr": (
        "SELECT * FROM FUND_ADMIN.TEMPORAL_DEAL_IRR\n"
        "WHERE fund_uuid IN ({fund_uuids})\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid, issuer_id "
        "ORDER BY performance_quarter_end_date DESC)=1"
    ),
    "waterfall": (
        "SELECT * FROM FUND_ADMIN.PROFIT_ALLOCATION_WATERFALL_CONFIG\n"
        "WHERE fund_id IN ({fund_uuids})"
    ),
    "ownership": (
        "SELECT * FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP\n"
        "WHERE FUND_ID IN ({fund_uuids})\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, FUND_ID "
        "ORDER BY AS_OF_DATE DESC)=1"
    ),
    "partners": (
        "SELECT *, TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS commitment,\n"
        "       TOTAL_CAP_CONTRIBUTION AS contributed,\n"
        "       TOTAL_DISTRIBUTION AS distributed,\n"
        "       TOTAL_NET_ASSET_BALANCE AS nav\n"
        "FROM FUND_ADMIN.PARTNER_DATA\n"
        "WHERE fund_uuid IN ({fund_uuids}) AND IS_LIMITED_PARTNER = TRUE\n"
        "ORDER BY commitment DESC NULLS LAST"
    ),
    "gp_partners": (
        "SELECT *, TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS commitment,\n"
        "       TOTAL_CAP_CONTRIBUTION AS contributed,\n"
        "       TOTAL_DISTRIBUTION AS distributed,\n"
        "       TOTAL_NET_ASSET_BALANCE AS nav\n"
        "FROM FUND_ADMIN.PARTNER_DATA\n"
        "WHERE fund_uuid IN ({fund_uuids}) AND IS_GENERAL_PARTNER = TRUE\n"
        "ORDER BY commitment DESC NULLS LAST"
    ),
    "financing": (
        "SELECT *, COALESCE(closing_date, raised_date) AS round_date\n"
        "FROM FUND_ADMIN.FINANCING_HISTORY\n"
        "WHERE corporation_id IN " + _CORP_SCOPE + "\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_id "
        "ORDER BY COALESCE(closing_date, raised_date) DESC NULLS LAST)=1"
    ),
    "captable": (
        "SELECT * FROM FUND_ADMIN.SUMMARY_CAP_TABLE\n"
        "WHERE CORPORATION_ID IN " + _CORP_SCOPE + "\n"
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, SECURITY_CLASS_ID "
        "ORDER BY AS_OF_DATE DESC)=1"
    ),
    # corporations gates ALL corp enrichment (financing/ownership/captable depend on
    # corpUuid resolving here) — a small firm's non-wide result must not be allowed to
    # return inline and get dropped. Mirrors the non-wide stem's filter column
    # (corporation_uuid) and its _CORP_SCOPE subquery exactly.
    "corporations": (
        "SELECT * FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2\n"
        "WHERE corporation_uuid IN " + _CORP_SCOPE
    ),
}


def in_list(ids):
    """Render an id list as a SQL IN-list body: ``'a','b','c'`` (single-quoted,
    comma-joined). Ids are UUIDs from Carta with no embedded quotes."""
    return ",".join("'%s'" % str(i) for i in ids)


def render(stem, ids, wide=False):
    """Return (sql, limit, format) for a stem with its IN-list substituted. When
    ``wide`` is set and the stem has a WIDE variant, emit that superset query (it
    reliably persists to a file so the result is captured by path, not inline)."""
    spec = STEMS[stem]
    template = WIDE[stem] if (wide and stem in WIDE) else spec["sql"]
    sql = template.replace("{%s}" % spec["id_param"], in_list(ids))
    return sql, spec["limit"], spec["format"]
