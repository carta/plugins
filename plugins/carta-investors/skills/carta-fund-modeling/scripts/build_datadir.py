#!/usr/bin/env python3
"""
build_datadir.py — firm-agnostic Fund Admin -> console-schema transform.

Reads the raw outputs of the SKILL's Fund-Admin queries (references/queries.md)
plus a small meta.json, and writes the scenario-planning data dir that serve.py
serves. NO firm-specific data is embedded — every value comes from the raw query
files; missing optional data degrades to empty / "not available" states. Reusable
for ANY firm.

Stdlib-only, Python 3.9-safe (matches serve.py constraints).

Usage:
    uv run build_datadir.py --raw <rawdir> --out <datadir> --meta <meta.json>

<rawdir> holds pipe-delimited query outputs (the MCP markdown table format is
accepted verbatim — preamble/separator lines are ignored). Columns are matched by
lowercased name, so extra columns are harmless. Logical files (stem.md|psv|tsv|txt):
    nav_latest     required  MONTHLY_NAV_CALCULATIONS latest/fund (queries.md §2):
                             fund_uuid, fund_name, entity_type_name,
                             cumulative_commitment_amount, cumulative_lp_contributions,
                             cumulative_lp_distributions, ending_lp_nav, ending_gp_nav,
                             lp_dpi, lp_rvpi, lp_tvpi
    investments    required  AGGREGATE_INVESTMENTS (§3): fund_uuid, issuer_name,
                             asset_name, asset_class_type, investment_date,
                             total_cost, total_cost_basis, remaining_value,
                             total_proceeds, total_unrealized_gain_loss,
                             count_remaining_shares, remaining_value_per_share,
                             is_active_investment, is_public_asset
    cashflows      optional  MONTHLY_NAV monthly/fund (§5 — the single canonical
                             query; feeds BOTH per-fund LP flows/IRR AND the firm
                             NAV/TVPI trend): fund_uuid, month_end_date,
                             lp_contributions, lp_distributions, ending_lp_nav,
                             cumulative_lp_contributions, cumulative_lp_distributions
    fund_metrics   optional  AGGREGATE_FUND_METRICS (§1/§12): fund_uuid,
                             dry_powder, total_mgmt_fees, total_opx, vintage_year,
                             vintage_date, fund_reporting_currency, total_moic (fund-total
                             gross-of-carry MOIC → snapshot.funds[].grossMoic) — vintage_year/date
                             is the authoritative per-fund vintage (falls back to the
                             cohort table, else null → shown as "—"; never a hardcoded
                             year); fund_reporting_currency drives the firm display
                             currency (never hardcoded USD)
    accrued_carry  optional  ALLOCATIONS GP side (§7): fund_uuid, accrued_carry, as_of
    distributed_carry optional ALLOCATIONS GP side 'Carried interest earned' (§7): fund_uuid,
                             carry_distributed, as_of — realized carry paid to the GP; 0 when none
    waterfall      optional  PROFIT_ALLOCATION_WATERFALL_CONFIG: fund_id|fund_uuid,
                             config_name, carry_rate, preferred_return, gp_catchup_rate,
                             gp_catchup_limit, recommended_config_rank, is_automated
                             — keeps the rank-1 config; seeds per-fund carry/pref/catch-up
    cohort         optional  TEMPORAL_FUND_COHORT_BENCHMARKS (§8): fund_uuid,
                             vintage_year, fund_count, moic, tvpi_*/net_irr_*/dpi_*/moic_*
    deal_irr       optional  TEMPORAL_DEAL_IRR latest/issuer (§10): fund_uuid,
                             issuer_name, deal_irr
    financing      optional  FINANCING_HISTORY latest/corp (§11): investment_name,
                             round, post_money_valuation, round_date|closing_date|raised_date
    partners       optional  PARTNER_DATA per LP (§9): partner_name, partner_country,
                             commitment, contributed, distributed, nav
    gp_partners    attempt   PARTNER_DATA per GP partner (§9, IS_GENERAL_PARTNER): same
                             columns as partners. The GP partners' summed `commitment`
                             is the REAL source of snapshot.funds[].gpCommit (from the DWH;
                             falls back to nav_latest.cumulative_gp_contributions when a
                             fund records no GP-partner commitment). Also enriches
                             gp-base.json (GP Economics tab).
    gp_carry       attempt   ALLOCATIONS per-GP-partner 'Carried interest accrued'
                             (§7b, ENTITY_TYPE_NAME='GP'): fund_uuid, gp_entity_name,
                             partner_name, partner_type, accrued_carry → gp-base.json
                             per-partner carry SHARES (real booked split of the GP
                             entity's carry) for the GP Economics "GP partner carry"
    ownership      optional  FUND_CORPORATION_OWNERSHIP (§4): corporation_id (or a
                             pre-joined company name), percentage (0-1 fraction;
                             NOT fully_diluted, which is a share count), as_of —
                             corp_id is joined to a name via the financing file
    financials     attempt   COMPANY_FINANCIALS (§14): legal_name, name|mnemonic,
                             float_value, currency, period_end — latest revenue/ARR
                             per company (Data Collection); matched by normalized name
    corporations   attempt   CORPORATION_BASIC_INFO_V2 (§16): entity_link_id,
                             corporation_uuid — the entity_link -> corpUuid bridge
                             that drives the corp-scoped joins above

Not an ndjson stem — a directory, read by load_logos() (see there): <rawdir>/logos/,
optional, one image file per company named <corporation_uuid>.<ext> (fetched via the
Carta MCP portco-logo tools, SKILL.md Step 2b). Embedded into each matching company as
comp["logoDataUri"] (a data: URI); a company with no corpUuid or no matching file gets
no logoDataUri and the app falls back to its initials avatar.

meta.json: {"name","slug","navAsOf","mark":{"text","bg","fg"},"carryRate"?,"firmId"?,"firmUuid"?}
"""
import argparse
import ast
import base64
import collections
import copy
import datetime
import json
import os
import re
import sys


# ---------- generic table parsing ----------
def parse_table(path):
    """Parse a raw query dump into row dicts keyed by lowercased column name.
    Accepts BOTH the MCP markdown / bare pipe-delimited table format AND ndjson
    (one JSON object per line — what `dwh__execute__query` writes with
    format="ndjson"). Preamble (`total_rows: …`) and separator lines are ignored,
    so a persisted ndjson blob can be fed in verbatim."""
    if not path or not os.path.exists(path):
        return []
    rows, header = [], None
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            s = line.strip()
            if not s or s.lower().startswith("total_rows"):
                continue  # blank / MCP preamble
            if s[0] == "{":  # ndjson row — keys lowercased, values stringified
                try:
                    obj = json.loads(s)
                except ValueError:
                    continue
                rows.append({str(k).lower(): ("" if v is None else str(v)) for k, v in obj.items()})
                continue
            cells = [c.strip() for c in line.split("|")]
            if all(set(c) <= set("-: ") and c for c in cells):
                continue  # separator row
            if header is None:
                header = [c.lower() for c in cells]
                continue
            if len(cells) < len(header):
                cells += [""] * (len(header) - len(cells))
            rows.append(dict(zip(header, cells)))
    return rows


def find(rawdir, *stems):
    for stem in stems:
        for ext in (".ndjson", ".jsonl", ".md", ".psv", ".tsv", ".txt"):
            p = os.path.join(rawdir, stem + ext)
            if os.path.exists(p):
                return p
    return None


def truncated_stems(rawdir):
    """Return [(stem, next_offset), ...] for stems `save_query_result.py` flagged as
    INCOMPLETE, sorted by stem.

    The DWH clamps every `limit` to 10,000 rows and reports a further page via
    `next_offset`; the capture helper writes a `<stem>.ndjson.truncated` sidecar when
    it sees one. A truncated stem is indistinguishable from a complete one once it is
    on disk — the row count alone looks plausible — so the marker is the only signal,
    and main() refuses to build while any exists."""
    out = []
    try:
        names = os.listdir(rawdir)
    except OSError:
        return out
    for name in names:
        if not name.endswith(".ndjson.truncated"):
            continue
        stem = name[: -len(".ndjson.truncated")]
        next_offset = None
        try:
            with open(os.path.join(rawdir, name), encoding="utf-8") as fh:
                next_offset = (json.load(fh) or {}).get("next_offset")
        except (OSError, ValueError):
            pass
        out.append((stem, next_offset))
    return sorted(out)


def col(row, *names):
    for n in names:
        if n in row:
            v = row[n]
            # Falsy-skip first, matching every existing caller's original
            # contract (None/""/0/False all mean "try the next name") -- only
            # THEN coerce to str for .strip(), since fetch_logos.py reuses this
            # on JSON rows where an id column (corporation_id) can be a real,
            # truthy int that plain (row[n] or "").strip() would crash on.
            if not v:
                continue
            v = v.strip() if isinstance(v, str) else str(v).strip()
            if v != "":
                return v
    return ""


def num(x):
    x = (x or "").strip()
    if x == "" or x.upper() in ("NULL", "NONE"):
        return 0.0
    try:
        return float(x)
    except ValueError:
        return 0.0


def numn(x):
    s = (x or "").strip()
    if s == "" or s.upper() in ("NULL", "NONE"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def slug(s):
    s = re.sub(r"\(.*?\)", "", s or "")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def fid(name):
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper()


def norm_co(n):
    """Normalize a company name for fuzzy matching across datasets."""
    n = re.sub(r"\(.*?\)", "", n or "").strip().lower()
    n = re.sub(r",?\s+(incorporated|inc|corp|corporation|llc|ltd|limited|l\.?p\.?|co|company|sas|pbc|gmbh|ag|s\.?l\.?|holdings?)\.?$", "", n)
    return re.sub(r"[^a-z0-9]+", "", n)


def company_key(r):
    """Company identity: entity_link_id, else general_ledger_issuer_id.
    Returns (key, key_type) or None when neither id is present. The display name is
    NEVER an identity."""
    el = col(r, "entity_link_id")
    if el:
        return (el, "entity_link")
    gl = col(r, "general_ledger_issuer_id")
    if gl:
        return (gl, "gl_issuer")
    return None


def clean_irr(v):
    """Sanitize deal IRR: 0 -> None (held-at-cost), <=-1 -> -1 (write-off),
    >5 -> None (tiny-basis artifact)."""
    if v is None or v == 0.0:
        return None
    if v <= -0.999:
        return -1.0
    if v > 5:
        return None
    return v


def parse_d(s):
    try:
        return datetime.date(*[int(p) for p in s[:10].split("-")])
    except (ValueError, TypeError):
        return None


# ---------- XIRR (Actual/365, bisection) ----------
def _xnpv(rate, flows):
    d0 = flows[0][0]
    return sum(cf / (1.0 + rate) ** ((d - d0).days / 365.0) for d, cf in flows)


def xirr(flows):
    flows = sorted([(d, a) for d, a in flows if d], key=lambda x: x[0])
    if not (any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)):
        return None
    lo, hi = -0.9999, 10.0
    flo, fhi = _xnpv(lo, flows), _xnpv(hi, flows)
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        fm = _xnpv(mid, flows)
        if abs(fm) < 1e-6:
            return mid
        if flo * fm < 0:
            hi = mid
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


def region_bucket(country):
    c = (country or "").lower()
    if c in ("united states", "usa", "us", "canada"):
        return "North America"
    if "israel" in c:
        return "Israel"
    if any(k in c for k in ("cayman", "virgin islands")) or c in ("barbados", "bahamas", "panama", "bermuda"):
        return "Caribbean / Offshore"
    if c in ("united arab emirates", "uae", "saudi arabia", "qatar", "kuwait", "bahrain"):
        return "Middle East"
    if c in ("australia", "new zealand", "hong kong", "japan", "singapore", "china", "south korea", "india", "taiwan"):
        return "APAC"
    if c in ("switzerland", "malta", "luxembourg", "portugal", "cyprus", "germany", "united kingdom", "uk",
             "jersey", "guernsey", "gibraltar", "france", "spain", "italy", "netherlands", "ireland",
             "sweden", "norway", "denmark", "finland", "belgium", "austria", "åland islands"):
        return "Europe"
    if c in ("unknown", ""):
        return "Unknown"
    return "Other"


def _cohort_covered(r):
    """A cohort row has a published peer cohort iff any load-bearing percentile /
    peer-count column is non-null. The newest quarter in
    TEMPORAL_FUND_COHORT_BENCHMARKS is frequently not-yet-benchmarked (every band
    null), so this distinguishes a real cohort from an empty placeholder row."""
    for c in ("fund_count", "tvpi_50", "dpi_50", "moic_50", "net_irr_50th"):
        if numn(col(r, c)) is not None:
            return True
    return False


# The company-level fields the app lets a user edit; everything else on a company
# is the immutable Carta layer. MUST match EDIT_FIELDS in app/src/model/slices.js —
# the JS delta serializer and this reconcile share the list, so a field in one but
# not the other is silently dropped on the side that lacks it.
SCENARIO_EDIT_FIELDS = ("valuationB", "markMultiple", "futureDilution",
                        "includeInNav", "exited", "exitTimingQ", "waterfallMode",
                        "archived", "notes")
# Assumption maps keyed by fund id — pruned to the surviving funds on refresh.
FUND_KEYED_ASSUMPTIONS = ("carryRates", "preferredReturns", "catchupRates",
                          "catchupLimits", "feeLoads", "followOnRatios",
                          "recyclingRatios", "avgChecks", "exitHorizon",
                          "rtfTarget", "rtfConfig", "glidepath")


def _slice_overlay(old_slice):
    """The user's scenario knobs keyed by company id. Reads a version-3 `edits`
    map directly, or derives one from a version-2 slice's full `companies` array.
    Reading `edits` unconditionally would silently wipe every edit on a v2 file."""
    edits = old_slice.get("edits")
    if isinstance(edits, dict):
        return {cid: e for cid, e in edits.items() if isinstance(e, dict) and cid}
    # `or` (not a .get default) also coalesces an explicit JSON null.
    overlay = {}
    for c in (old_slice.get("companies") or []):
        if isinstance(c, dict) and c.get("id"):
            overlay[c["id"]] = {f: c[f] for f in SCENARIO_EDIT_FIELDS if f in c}
    return overlay


def _overlay_company_name(old_slice, cid):
    """A dropped company's name, available only from a v2 slice's `companies`
    array; a v3 `edits` map stores no name, so the caller falls back to the id."""
    for c in (old_slice.get("companies") or []):
        if isinstance(c, dict) and c.get("id") == cid:
            return c.get("name")
    return None


def reconcile_slice(old_slice, companies, live_fund_ids):
    """Rebuild one preserved scenario against the fresh baseline `companies` as a
    version-3 `edits` delta: keep only the edit fields that differ from the fresh
    baseline company. Accepts a v2 (`companies`) or v3 (`edits`) input.
    Returns (reconciled_slice, dropped_names)."""
    fresh_by_id = {c["id"]: c for c in companies}
    overlay = _slice_overlay(old_slice)
    edits_out = {}
    for cid, fields in overlay.items():
        fresh = fresh_by_id.get(cid)
        if fresh is None:
            continue  # company no longer in Carta — logged as dropped below
        delta = {f: fields[f] for f in SCENARIO_EDIT_FIELDS
                 if f in fields and fields[f] != fresh.get(f)}
        if delta:
            edits_out[cid] = delta
    dropped = [_overlay_company_name(old_slice, cid) or cid
               for cid in overlay if cid not in fresh_by_id]
    assumptions = copy.deepcopy(old_slice.get("assumptions") or {})
    for key in FUND_KEYED_ASSUMPTIONS:
        m = assumptions.get(key)
        if isinstance(m, dict):
            assumptions[key] = {k: v for k, v in m.items() if k in live_fund_ids}
    # "shared" carries the shared-scenario link (uuid, author, snapshot basis, dirty flag);
    # dropping it here would unlink every shared scenario on each data refresh.
    reconciled = {k: old_slice[k] for k in ("id", "name", "createdAt", "color", "shared")
                  if k in old_slice}
    reconciled["locked"] = False
    reconciled["assumptions"] = assumptions
    reconciled["edits"] = edits_out
    return reconciled, dropped


# Company logos are optional and out-of-band from the DWH ndjson stems: the skill
# fetches them via the Carta MCP portco-logo tools (fa__list__portco_logos /
# fa__get__portco_logo_zip — see SKILL.md Step 2b) and drops the image bytes at
# <rawdir>/logos/<corporation_uuid>.<ext>, one file per company that has a logo.
# Embedding as a data: URI (rather than a logoUrl the browser fetches later) keeps
# the "browser only reads JSON the skill wrote" invariant serve.py documents, and
# avoids depending on a presigned S3 URL still being valid on a later relaunch.

# The only extensions fetch_logos.py's magic-byte sniff can ever write -- an
# explicit map rather than mimetypes.guess_type() (whose registered types can vary
# by OS/Python build) so both files agree on "is this a real image". fetch_logos.py
# imports this dict directly and validates every sniffed extension against it, so a
# format added to one file without the other fails at fetch time (loud, logged,
# skipped) instead of build_datadir.py silently dropping the file later.
EXT_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif",
    ".bmp": "image/bmp", ".webp": "image/webp", ".svg": "image/svg+xml",
}


def load_logos(rawdir):
    """corporation_uuid -> data: URI, for every file under <rawdir>/logos/.

    fetch_logos.py clears this directory before every fetch, so there should
    never be two files for the same corp_uuid -- but os.listdir()'s order is
    filesystem-dependent, so sort it anyway: if a caller ever writes here
    without going through that cleanup, a leftover duplicate stays a
    deterministic "last write wins" instead of a random one across builds."""
    logos_dir = os.path.join(rawdir, "logos")
    out = {}
    if not os.path.isdir(logos_dir):
        return out
    for fname in sorted(os.listdir(logos_dir)):
        corp_uuid, ext = os.path.splitext(fname)
        if not corp_uuid:
            continue
        mime = EXT_MIME.get(ext.lower())
        if mime is None:
            continue
        with open(os.path.join(logos_dir, fname), "rb") as fh:
            data = fh.read()
        if not data:
            continue
        out[corp_uuid] = "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))
    return out


def build(rawdir, out, meta):
    nav = meta.get("navAsOf") or ""
    nav_d = parse_d(nav)
    firm_name = meta["name"]
    firm_id = meta.get("firmId")      # optional integer Carta ID (may be null), for cache lookup
    firm_uuid = meta.get("firmUuid")
    carry_default = meta.get("carryRate", 0.20)
    # "production" or "nonprod" — which Carta MCP server this build's data came
    # from (Step 1). Threaded into snapshot.source so serve.py can tell the
    # browser's Snowplow tracker which collector to use. A pre-fix cache with
    # no cartaEnvironment defaults to "production": this is a customer-facing
    # plugin, so an unclassified build is far more likely real production
    # usage than a staff test session — staff noise is filterable downstream.
    carta_env = meta.get("cartaEnvironment") or "production"
    mark = meta.get("mark") or {"text": (firm_name[:3] or "FND").upper(), "bg": "#4F46E5", "fg": "#FFFFFF"}

    # ---- GP commitment (REAL) — GP partners' committed capital, else GP paid-in. ----
    # Sourced entirely from the DWH: the GP partners' recorded commitment
    # from the gp_partners stem (PARTNER_DATA, IS_GENERAL_PARTNER — the same figure
    # the fund's profit-allocation config exposed, summed across a fund's GP rows),
    # falling back to the GP's paid-in co-investment (nav_latest
    # .cumulative_gp_contributions) when no GP-partner commitment is recorded.
    # gpCommit is None only when neither exists (app shows "—"). NEVER a modeled estimate.
    gp_commit_dwh = {}
    for r in parse_table(find(rawdir, "gp_partners")):
        u = col(r, "fund_uuid")
        if not u:
            continue
        c = numn(col(r, "commitment"))
        if c:
            gp_commit_dwh[u] = gp_commit_dwh.get(u, 0.0) + c

    def gp_commit_of(u, gp_contrib):
        """GP co-investment $ for fund uuid u. Prefer the GP partners' recorded
        commitment (gp_partners stem); when none is recorded, fall back to the GP's
        paid-in contributions from fund NAV (cumulative_gp_contributions). None only
        when neither exists — never a modeled estimate."""
        val = gp_commit_dwh.get(u)
        if val and val > 0:
            return val
        return gp_contrib if (gp_contrib and gp_contrib > 0) else None

    # ---- cohort: vintage + fund MOIC + percentile bands ----
    # §8 fetches a recent window of quarters per fund (the newest is often not-yet-
    # benchmarked / all-null). Pick, per fund, the most recent quarter that actually
    # has a cohort; fall back to the most recent row (for vintage / own MOIC) when no
    # quarter is benchmarked. Tuple compare: covered beats uncovered, then latest
    # ISO performance_quarter_start_date wins.
    cohort_path = find(rawdir, "cohort")
    cohort_rows = parse_table(cohort_path)
    cohort_best = {}  # fund_uuid -> (covered, quarter, row)
    for r in cohort_rows:
        u = col(r, "fund_uuid")
        if not u:
            continue
        cand = (_cohort_covered(r), col(r, "performance_quarter_start_date", "quarter"), r)
        prev = cohort_best.get(u)
        if prev is None or (cand[0], cand[1]) > (prev[0], prev[1]):
            cohort_best[u] = cand
    vintage_of, fund_moic, benchmarks_raw = {}, {}, {}
    for u, (_covered, _q, r) in cohort_best.items():
        vy = col(r, "vintage_year")
        if vy.isdigit():
            vintage_of[u] = int(vy)
        fund_moic[u] = numn(col(r, "moic"))
        benchmarks_raw[u] = r

    # ---- fund-metric actuals (incl. authoritative vintage) ----
    fmetrics = {}
    for r in parse_table(find(rawdir, "fund_metrics")):
        u = col(r, "fund_uuid")
        if not u:
            continue
        vy = col(r, "vintage_year")
        vd = col(r, "vintage_date")
        vint = int(vy) if vy.isdigit() else (int(vd[:4]) if len(vd) >= 4 and vd[:4].isdigit() else None)
        fmetrics[u] = {"mgmtFees": num(col(r, "total_mgmt_fees")),
                       "opex": num(col(r, "total_opx")),
                       "dryPowder": num(col(r, "dry_powder")),
                       "vintage": vint,
                       # fund-total gross-of-carry MOIC (AGGREGATE_FUND_METRICS.total_moic); null when absent
                       "grossMoic": numn(col(r, "total_moic")),
                       "currency": (col(r, "fund_reporting_currency", "currency") or "").upper() or None}

    # ---- accrued carry (real, ALLOCATIONS GP side) ----
    accrued_of, accrued_asof = {}, None
    for r in parse_table(find(rawdir, "accrued_carry")):
        u = col(r, "fund_uuid")
        if not u:
            continue
        accrued_of[u] = num(col(r, "accrued_carry", "accrued"))
        a = col(r, "as_of")
        if a and (accrued_asof is None or a > accrued_asof):
            accrued_asof = a

    # ---- carry DISTRIBUTED (realized, from Carta books) — ALLOCATIONS GP side,
    #      'Carried interest earned' bucket (§7). Real realized carry paid to the
    #      GP; 0.0 when none distributed yet -> the app shows "—". Booked as an
    #      OUTFLOW (negative, like lp distributions), so take the magnitude — the
    #      realized carry paid to the GP is a positive amount. ----
    dist_carry_of, dist_carry_asof = {}, None
    for r in parse_table(find(rawdir, "distributed_carry")):
        u = col(r, "fund_uuid")
        if not u:
            continue
        dist_carry_of[u] = abs(num(col(r, "carry_distributed", "distributed_carry", "carry_earned")))
        a = col(r, "as_of")
        if a and (dist_carry_asof is None or a > dist_carry_asof):
            dist_carry_asof = a

    # ---- waterfall config (PROFIT_ALLOCATION_WATERFALL_CONFIG): per-fund carry,
    #      preferred return, GP catch-up. Keep the recommended (rank-1) config. ----
    waterfall_of = {}  # fund_uuid -> (rank, cfg)
    for r in parse_table(find(rawdir, "waterfall")):
        u = col(r, "fund_id", "fund_uuid")
        if not u:
            continue
        rank = numn(col(r, "recommended_config_rank"))
        prev = waterfall_of.get(u)
        if prev is not None and rank is not None and prev[0] is not None and rank >= prev[0]:
            continue
        waterfall_of[u] = (rank, {
            "carryRate": numn(col(r, "carry_rate")),
            "preferredReturn": numn(col(r, "preferred_return")) or 0,
            "catchupRate": numn(col(r, "gp_catchup_rate")) or 0,
            "catchupLimit": numn(col(r, "gp_catchup_limit")),
            "configName": col(r, "config_name") or None,
            "isAutomated": col(r, "is_automated").strip().lower() == "true",
        })
    waterfall_of = {u: v[1] for u, v in waterfall_of.items()}

    # ---- fund headline (MONTHLY_NAV latest) ----
    funds = {}
    for r in parse_table(find(rawdir, "nav_latest", "fund_metrics")):
        u = col(r, "fund_uuid")
        name = col(r, "fund_name")
        if not u or not name:
            continue
        # Keep only LP funds. The entity enumeration (queries.md §0) returns Fund
        # AND GP entities (and a stale/hand-edited fund_uuids.txt could reintroduce an
        # SPV), so every non-fund vehicle is dropped here — it must never enter the
        # firm/fund-level model. GP LLCs are the load-bearing case: a GP entity's
        # capital IS the GP's commitment to its paired fund, already captured as that
        # fund's `gpCommit` (gp_partners stem) and its GP economics. Listing the GP
        # entity as its own "fund" double-counts that capital (its committed == the
        # fund's gpCommit) and clutters LP-facing views — the LP-NAV-by-fund chart, the
        # firm rollup, the navSeries trend. SPVs (single-deal), management companies and
        # elimination entities likewise aren't funds LPs commit to. A row with no
        # entity_type_name is kept (defensive default, matching `type` below) so the
        # fund_metrics fallback path is never dropped.
        etype = (col(r, "type", "entity_type_name") or "").strip().lower()
        if any(t in etype for t in ("gp", "spv", "management", "elimination")):
            continue
        fm = fmetrics.get(u, {})
        funds[u] = {
            "uuid": u, "id": fid(name), "name": name,
            "type": col(r, "type", "entity_type_name") or "Fund",
            # vintage from AGGREGATE_FUND_METRICS (authoritative), else the cohort
            # table, else None — a real year only, never a hardcoded fallback.
            "vintage": fm.get("vintage") or vintage_of.get(u),
            "committed": num(col(r, "cumulative_commitment_amount", "committed", "fund_size")),
            "lpPaidIn": num(col(r, "cumulative_lp_contributions", "lp_paid_in")),
            "lpDistributed": abs(num(col(r, "cumulative_lp_distributions", "lp_distributed"))),
            "lpNav": num(col(r, "ending_lp_nav")),
            "gpNav": num(col(r, "ending_gp_nav")),
            "gpContrib": numn(col(r, "cumulative_gp_contributions")),  # GP paid-in — gpCommit fallback
            "lpDpi": num(col(r, "lp_dpi")),
            "lpRvpi": num(col(r, "lp_rvpi")),
            "lpTvpi": num(col(r, "lp_tvpi")),
            "moic": fund_moic.get(u),
            "accrued": accrued_of.get(u, 0.0),
            "carryDistributed": dist_carry_of.get(u, 0.0),
            "mgmtFees": fm.get("mgmtFees", 0.0),
            "opex": fm.get("opex", 0.0),
            "dryPowder": fm.get("dryPowder", 0.0),
        }
    funds = {u: f for u, f in funds.items() if f["committed"] or f["lpNav"] or f["lpPaidIn"]}
    SLUG = {u: f["id"] for u, f in funds.items()}

    # Firm display currency — the reporting currency (FUND_REPORTING_CURRENCY)
    # shared by the funds. Never hardcode USD: read it from the data. If funds
    # mix currencies, use the most common (a mixed book shouldn't sum across
    # currencies — flagged below) and leave it null when Carta reports none.
    cur_counts = collections.Counter(
        fmetrics.get(u, {}).get("currency") for u in funds if fmetrics.get(u, {}).get("currency"))
    firm_currency = cur_counts.most_common(1)[0][0] if cur_counts else None
    mixed_currency = len(cur_counts) > 1

    def display(f):
        # "<id> (Bare Name, YYYY)" — but omit the ", YYYY" entirely when vintage is
        # unknown rather than emitting a placeholder. A missing-vintage fund used to
        # render "(Bare Name, —)"; that trailing "— " placeholder is what surfaced as
        # a � in the app, so a fund name must never carry a stand-in glyph.
        bare = re.sub(r",? (L\.?P\.?|LP|LLC)$", "", f["name"])
        return "%s (%s, %s)" % (f["id"], bare, f["vintage"]) if f["vintage"] else "%s (%s)" % (f["id"], bare)

    # ---- per-fund monthly cashflows + firm NAV/TVPI trend ----
    flows_by_fund = collections.defaultdict(list)
    trend = collections.defaultdict(lambda: [0.0, 0.0, 0.0])  # date -> [nav, cumContrib, cumDist]
    trend_by_fund = collections.defaultdict(lambda: collections.defaultdict(float))  # date -> fundId -> ending_lp_nav
    for r in parse_table(find(rawdir, "cashflows")):
        u = col(r, "fund_uuid")
        if u not in funds:
            continue
        d = col(r, "month_end_date")
        contrib = num(col(r, "lp_contributions"))
        dist = num(col(r, "lp_distributions"))
        if d and (contrib or dist):
            flows_by_fund[u].append((d, round(dist - contrib, 2)))
        if d:
            t = trend[d]
            t[0] += num(col(r, "ending_lp_nav"))
            t[1] += num(col(r, "cumulative_lp_contributions"))
            t[2] += num(col(r, "cumulative_lp_distributions"))
            trend_by_fund[d][funds[u]["id"]] += num(col(r, "ending_lp_nav"))
    for u in flows_by_fund:
        flows_by_fund[u].sort(key=lambda x: x[0])
    # quarter-ends PLUS the latest (nav-as-of) month, so the trend's final point
    # is "today" and ties to nav_latest / the firm rollup — not the prior quarter.
    all_trend_dates = sorted(trend)
    as_of_month = all_trend_dates[-1] if all_trend_dates else None
    # Drop only the LEADING all-zero run — a stray early-dated entity backfills empty quarters that would stretch the x-axis; interior history stays.
    def _active(dt):
        n, cc, cd = trend[dt]
        return abs(n) > 0.5 or cc > 0.5 or abs(cd) > 0.5
    first_active = next((d for d in all_trend_dates if _active(d)), None)
    nav_series = []
    for d in all_trend_dates:
        if first_active and d < first_active:
            continue
        if d[5:7] not in ("03", "06", "09", "12") and d != as_of_month:
            continue
        n, cc, cd = trend[d]
        # byFund: per-fund ending LP NAV at this quarter — lets the Overview trend
        # render as columns stacked by fund (firm nav = sum). Kept alongside the
        # firm-level nav/tvpi so older consumers still read those.
        by_fund = {fid: round(v, 2) for fid, v in trend_by_fund[d].items() if abs(v) > 0.5}
        nav_series.append({"date": d, "nav": round(n, 2),
                           "tvpi": round((n + cd) / cc, 4) if cc > 0 else None,
                           "byFund": by_fund})

    # ---- deal IRR (latest per fund+issuer; file already deduped) ----
    irr_map = {}
    for r in parse_table(find(rawdir, "deal_irr")):
        irr_map[(col(r, "fund_uuid"), col(r, "issuer", "issuer_name"))] = numn(col(r, "irr", "deal_irr"))

    # ---- financing: latest round per company (by CORPORATION_ID -> corpUuid) ----
    # Keyed by CORPORATION_ID directly — no name/fka-dba matching. A company is
    # joined to its round via its own corpUuid (below), resolved from the
    # corporations stem (§16).
    fin_by_corp = {}
    for r in parse_table(find(rawdir, "financing")):
        cid = col(r, "corporation_id", "corp_id")
        pm = numn(col(r, "post_money_valuation"))
        if cid and pm:
            fin_by_corp[cid] = {"round": col(r, "round"), "postMoney": round(pm, 2),
                                 "date": col(r, "round_date", "closing_date", "raised_date")}

    # ---- corp bridge: entity_link_id -> CORPORATION_UUID (§16 CORPORATION_BASIC_INFO_V2) ----
    # Optional: a firm whose portcos aren't Carta cap-table customers has no rows
    # here, so a company's corpUuid stays None and it simply gets no round/
    # ownership/captable enrichment (unchanged behavior for non-Carta portcos).
    corp_by_el = {}
    for r in parse_table(find(rawdir, "corporations")):
        el = col(r, "entity_link_id")
        cu = col(r, "corporation_uuid")
        if el and cu:
            corp_by_el[el] = cu

    # ---- company logos (optional; see load_logos above) ----
    logos_by_corp = load_logos(rawdir)

    # ---- cap table + liquidation preferences (optional; §15 SUMMARY_CAP_TABLE) ----
    # Per share class: seniority, preference multiple, participation (+ cap),
    # original issue price, conversion ratio, share count, cash raised. Keyed by
    # CORPORATION_ID (joined to companies via corpUuid below). Drives the
    # per-company liquidation-preference waterfall in the app (model/liqpref.js).
    def _cash_raised(v):
        """CASH_RAISED is a {currency: amount} object; ndjson stringifies it to a
        JSON- or Python-repr string. Return (amount, currency) for the single entry
        (never sum across currencies), or (None, None) when absent/unparseable."""
        s = (v or "").strip()
        if not s or s.upper() in ("NULL", "NONE"):
            return None, None
        obj = None
        for parse in (json.loads, ast.literal_eval):
            try:
                obj = parse(s)
                break
            except (ValueError, SyntaxError):
                continue
        if not isinstance(obj, dict) or not obj:
            return None, None
        ccy = next(iter(obj))
        try:
            return float(obj[ccy]), (ccy or None)
        except (TypeError, ValueError):
            return None, (ccy or None)

    captable_by_corp = collections.OrderedDict()
    captable_ccy = {}  # corp_id -> reporting currency (from CASH_RAISED)
    for r in parse_table(find(rawdir, "captable")):
        cid = col(r, "corporation_id", "corp_id")
        cname = col(r, "security_class_name", "security_class")
        if not cid or not cname:
            continue
        cash, ccy = _cash_raised(col(r, "cash_raised"))
        if ccy and cid not in captable_ccy:
            captable_ccy[cid] = ccy.upper()
        captable_by_corp.setdefault(cid, []).append({
            "name": cname,
            "kind": col(r, "security_class_type_detailed", "security_class_type") or None,
            "seniority": numn(col(r, "seniority")),
            "multiplier": numn(col(r, "multiplier")),
            "participating": col(r, "participating_preferred").strip().lower() == "true",
            "cap": numn(col(r, "preference_cap")),
            "oip": numn(col(r, "original_issue_price")),
            "conversion": numn(col(r, "conversion_ratio")),
            "shares": numn(col(r, "outstanding_shares")),
            "fdShares": numn(col(r, "fully_diluted_quantity")),
            "cashRaised": round(cash, 2) if cash is not None else None,
        })

    # ---- company financials: latest revenue / ARR per company (Data Collection,
    #      by normalized name; §14 COMPANY_FINANCIALS). Coverage is partial. ----
    # Curated metrics surfaced on the company card + time-series chart. Matched by
    # mnemonic (preferred) or lowercased name; ORDER drives the UI metric dropdown.
    # (key, label, unit, matcher(mnemonic_upper, name_lower)). Forecast/deferred
    # variants are excluded — operating actuals only.
    METRIC_DEFS = [
        ("revenue",     "Revenue",      "Dollar", lambda mn, nm: mn == "FS_REVENUE" or nm == "revenue"),
        ("arr",         "ARR",          "Dollar", lambda mn, nm: mn in ("FS_ARR_END", "ARR") or "recurring revenue" in nm),
        ("ebitda",      "EBITDA",       "Dollar", lambda mn, nm: mn == "FS_EBITDA"),
        ("grossProfit", "Gross Profit", "Dollar", lambda mn, nm: mn == "FS_GROSS_PROFIT"),
        ("cogs",        "COGS",         "Dollar", lambda mn, nm: mn == "FS_COGS"),
        ("netIncome",   "Net Income",   "Dollar", lambda mn, nm: mn == "FS_NET_INCOME"),
        ("cash",        "Cash",         "Dollar", lambda mn, nm: mn == "FS_CASH_AND_CASH_EQUIVALENTS"),
        ("headcount",   "Headcount",    "Number", lambda mn, nm: mn == "FS_HEADCOUNT"),
    ]
    METRIC_LABEL = collections.OrderedDict((k, (lbl, unit)) for k, lbl, unit, _ in METRIC_DEFS)

    def metric_key(mn, nm):
        if "deferred" in nm or "forecast" in nm:  # skip forecast/deferred-revenue variants
            return None
        for key, _lbl, _unit, match in METRIC_DEFS:
            if match(mn, nm):
                return key
        return None

    # nm -> key -> {period_end: (value, currency)}  (dedup: one point per period)
    fin_series = collections.defaultdict(lambda: collections.defaultdict(dict))
    for r in parse_table(find(rawdir, "financials")):
        nm = norm_co(col(r, "legal_name", "company"))
        val = numn(col(r, "float_value", "value"))
        period = col(r, "period_end", "as_of_date", "period")
        if not nm or val is None or not period:
            continue
        key = metric_key(col(r, "mnemonic").strip().upper(), (col(r, "name") or "").strip().lower())
        if not key:
            continue
        fin_series[nm][key][period] = (val, col(r, "currency") or None)

    financials = {}
    for nm, metrics in fin_series.items():
        rec, series = {}, []
        for key, (label, unit) in METRIC_LABEL.items():
            pts = metrics.get(key)
            if not pts:
                continue
            ordered = sorted(pts.items())  # by period_end ascending
            cur = next((c for _p, (_v, c) in ordered if c), None)
            series.append({"key": key, "label": label, "unit": unit, "currency": cur,
                           "points": [{"d": p, "v": round(v, 2)} for p, (v, _c) in ordered]})
        if series:
            rec["series"] = series
        # backward-compatible headline values (latest period) for the card badge
        rev = metrics.get("revenue")
        if rev:
            lp = max(rev)
            rec["revenue"], rec["revenueAsOf"], rec["currency"] = round(rev[lp][0], 2), lp, rev[lp][1]
        arr = metrics.get("arr")
        if arr:
            lp = max(arr)
            rec["arr"] = round(arr[lp][0], 2)
            rec.setdefault("currency", arr[lp][1])
        if rec:
            financials[nm] = rec

    # ---- companies (aggregated by company_key across funds) ----
    # Identity is the resolved key (entity_link_id, else general_ledger_issuer_id) —
    # NEVER the display name. Two companies sharing a display name stay distinct when
    # their keys differ; one company recorded under two name variants collapses to one
    # when its key is the same. Rows with no resolvable key are dropped and counted.
    inv_rows = parse_table(find(rawdir, "investments"))
    comp_map = collections.OrderedDict()
    dropped_no_id = 0
    for r in inv_rows:
        u = col(r, "fund_uuid")
        if u not in funds:
            continue
        issuer = col(r, "issuer", "issuer_name")
        if not issuer:
            continue
        cost = num(col(r, "total_cost", "cost"))
        fmv = num(col(r, "remaining_value", "remaining"))
        proceeds = num(col(r, "total_proceeds", "proceeds"))
        if cost == 0 and fmv == 0 and proceeds == 0:
            continue
        ck = company_key(r)
        if ck is None:
            dropped_no_id += 1
            continue
        cid, key_type = ck
        entry = comp_map.setdefault(cid, {"names": collections.Counter(), "keyType": key_type, "rows": []})
        entry["names"][issuer] += 1
        entry["rows"].append({
            "u": u, "asset": col(r, "asset_name", "asset_class_type") or "Investment",
            "cost": cost, "fmv": fmv, "proceeds": proceeds,
            # count_remaining_shares: the fund's holding in this security/class — the
            # join key to the company's cap-table stack for the liquidation waterfall.
            "shares": num(col(r, "count_remaining_shares", "remaining_shares")),
            "active": col(r, "is_active_investment", "is_active").lower() == "true",
            "public": col(r, "is_public_asset", "is_public").lower() == "true",
            "date": col(r, "investment_date", "date"),
            # dates that drive the Overview "Recent activity" feed's non-investment
            # lanes: fmvDate = when this position was last remarked (valuation-update
            # events); updateDate = last touched (the exit-date proxy, since Fund
            # Admin exposes no explicit realization date).
            "fmvDate": col(r, "latest_fmv_effective_date"),
            "updateDate": col(r, "latest_update_effective_date"),
        })

    used, companies, pacing_first, fv_by_company = set(), [], {}, {}
    for cid, entry in comp_map.items():
        rows = entry["rows"]
        # canonical display name: most-frequent variant across the group, else first
        # seen (Counter.most_common() is stable on ties in insertion order).
        name = entry["names"].most_common(1)[0][0]
        s = slug(name)
        base, k = s, 2
        while s in used:
            s = "%s-%d" % (base, k)
            k += 1
        used.add(s)
        tot_cost = sum(x["cost"] for x in rows)
        tot_fmv = sum(x["fmv"] for x in rows)
        tot_proc = sum(x["proceeds"] for x in rows)
        any_active = any(x["active"] and x["fmv"] > 0 for x in rows)
        realized = (tot_fmv == 0) and (tot_proc > 0) and not any_active
        byfund = collections.defaultdict(lambda: [0.0, 0.0])
        for x in rows:
            byfund[x["u"]][0] += x["fmv"]
            byfund[x["u"]][1] += x["cost"]
        primary = max(byfund.items(), key=lambda kv: (kv[1][0], kv[1][1]))[0]
        positions = []
        for j, x in enumerate(rows):
            pos = {"id": "%s-%d" % (cid, j + 1), "fundId": SLUG[x["u"]], "sleeve": SLUG[x["u"]],
                   "security": x["asset"], "cost": round(x["cost"], 2),
                   "cartaFv": 0 if realized else round(x["fmv"], 2),
                   # realized proceeds for this position (per fund) — lets a total-return
                   # view add distributions to residual FV; 0 when nothing realized yet
                   "proceeds": round(x["proceeds"], 2),
                   # shares the fund holds in this security (COUNT_REMAINING_SHARES) —
                   # joined to the cap-table stack (by `security` name) for the
                   # per-company liquidation-preference waterfall. 0 when unreported.
                   "shares": round(x["shares"], 4) if x["shares"] else 0,
                   "markBasisB": None, "markDate": x["date"] or nav,
                   # feed dates (see comment at the inv_rows append); None when unreported
                   "fmvDate": x["fmvDate"] or None, "updateDate": x["updateDate"] or None}
            if x["public"]:
                pos["isPublic"] = True
            positions.append(pos)
        # corpUuid: the entity_link -> corporation bridge, ONLY when the
        # company's identity is itself an entity_link_id — a gl_issuer-only company
        # (no entity_link_id anywhere in Fund Admin) has no corporation to resolve
        # and gets None (loses only the "Open company page" deep link; no
        # enrichment is lost since it has no ownership/financing/cap-table either).
        corp_uuid = corp_by_el.get(cid) if entry["keyType"] == "entity_link" else None
        comp = {"id": cid, "slug": s, "name": name, "corpUuid": corp_uuid, "fundId": SLUG[primary],
                "valuationB": None, "defaultValuationB": None, "includeInNav": False,
                "archived": False, "anchors": [], "sliderRange": None, "notes": "",
                "costBasis": round(tot_cost, 2), "positions": positions}
        if realized:
            comp["realized"] = True
            comp["proceeds"] = round(tot_proc, 2)
        di = clean_irr(irr_map.get((primary, name)))
        if di is not None:
            comp["dealIrr"] = round(di, 4)
        lr = fin_by_corp.get(corp_uuid) if corp_uuid else None
        if lr:
            comp["lastRound"] = lr
        logo = logos_by_corp.get(corp_uuid) if corp_uuid else None
        if logo:
            comp["logoDataUri"] = logo
        # financials (§14 COMPANY_FINANCIALS/Data Collection) has no corporation_id —
        # it is matched by normalized legal name only, independent of the corpUuid bridge.
        fnc = financials.get(norm_co(name))
        if fnc:
            comp["financials"] = fnc
        companies.append(comp)
        fv_by_company[cid] = {"name": name, "fv": round(0 if realized else tot_fmv, 2),
                            "cost": round(tot_cost, 2),
                            "markDate": max([x["date"] for x in rows if x["date"]] or [nav]),
                            "realized": realized}
        dts = [x["date"] for x in rows if x["date"] and len(x["date"]) >= 7]
        if dts:
            pacing_first[cid] = (name, SLUG[primary], min(dts))
    companies.sort(key=lambda c: (not c.get("realized", False), fv_by_company[c["id"]]["fv"]), reverse=True)

    # ---- benchmarks (data-driven; fundMoic always, percentiles when present) ----
    benchmarks = {}
    for u, f in funds.items():
        r = benchmarks_raw.get(u)

        def band(*cols):
            return {key: numn(col(r, cname)) for key, cname in cols if numn(col(r, cname)) is not None} if r else {}
        benchmarks[f["id"]] = {
            "cohortSize": numn(col(r, "fund_count")) if r else None,
            "tvpi": band(("p5", "tvpi_5"), ("p10", "tvpi_10"), ("p25", "tvpi_25"),
                         ("p50", "tvpi_50"), ("p75", "tvpi_75"), ("p90", "tvpi_90"), ("p95", "tvpi_95")),
            "irr": band(("p50", "net_irr_50th"), ("p75", "net_irr_75th"), ("p90", "net_irr_90th")),
            "dpi": band(("p5", "dpi_5"), ("p10", "dpi_10"), ("p25", "dpi_25"),
                        ("p50", "dpi_50"), ("p75", "dpi_75"), ("p90", "dpi_90"), ("p95", "dpi_95")),
            "moic": band(("p5", "moic_5"), ("p10", "moic_10"), ("p25", "moic_25"),
                         ("p50", "moic_50"), ("p75", "moic_75"), ("p90", "moic_90"), ("p95", "moic_95")),
            "fundMoic": f["moic"], "spEquivMultiple": None,
        }

    # Coverage classification so an empty Cohort Standing rail explains *why*:
    # "ok" (some fund has bands) / "no_cohort_file" (the cohort stem file is ABSENT
    # — never fetched; under strict mode the fetch gate rejects this before build,
    # so it only appears in --no-strict fixture builds) / "no_coverage_published"
    # (the file was fetched but has no usable rows — an empty file recording an
    # attempt that came back empty or access-denied, OR rows present but Carta has
    # published no peer cohort for any fund's recent quarters). Keyed off file
    # existence, not row count, so a legitimately-empty fetch reads as "published
    # none" rather than "not fetched".
    bench_covered = sum(1 for b in benchmarks.values() if b["tvpi"] or b["dpi"] or b["moic"])
    if bench_covered > 0:
        bench_reason = "ok"
    elif cohort_path is None:
        bench_reason = "no_cohort_file"
    else:
        bench_reason = "no_coverage_published"
    benchmarks_meta = {"covered": bench_covered, "total": len(funds), "reason": bench_reason}

    # ---- snapshot per-fund ----
    snap_funds, baseLpNav, baseAccruedCarry, gpEconomics, windDownYear, cashflows = [], {}, {}, {}, {}, {}
    for f in funds.values():
        i = f["id"]
        # DISPLAYED vintage: a real year or None (UI renders "—"). Never a fallback.
        vint = f["vintage"]
        flows = [{"date": d, "amount": a} for d, a in flows_by_fund.get(f["uuid"], [])]
        irr_flows = [(parse_d(d), a) for d, a in flows_by_fund.get(f["uuid"], [])]
        if f["lpNav"] > 0 and nav_d:
            irr_flows.append((nav_d, f["lpNav"]))
        nirr = xirr(irr_flows)
        first = min((d for d, _ in irr_flows[:-1]), default=None) if len(irr_flows) > 1 else None
        if nirr is not None and (first is None or not nav_d or (nav_d - first).days < 365):
            nirr = None
        # INTERNAL year for wind-down / terminal-date math only — never surfaced as
        # the vintage: real vintage, else the earliest cash-flow year, else nav year.
        first_flow_year = min((int(d[:4]) for d, _ in flows_by_fund.get(f["uuid"], []) if len(d) >= 4 and d[:4].isdigit()), default=None)
        calc_vint = vint or first_flow_year or (int(nav[:4]) if len(nav) >= 4 and nav[:4].isdigit() else 2020)
        standing = "%.2fx net LP TVPI%s (vintage %s)." % (
            f["lpTvpi"], (" · %.1f%% net IRR" % (nirr * 100)) if nirr is not None else "", vint if vint else "—")
        snap_funds.append({
            "id": i, "name": display(f), "type": f["type"], "vintage": vint,
            "committed": round(f["committed"], 2), "lpPaidIn": round(f["lpPaidIn"], 2),
            "lpDistributed": round(f["lpDistributed"], 2), "overviewLpNav": round(f["lpNav"], 2),
            "lpDpi": round(f["lpDpi"], 4), "lpRvpi": round(f["lpRvpi"], 4), "lpTvpi": round(f["lpTvpi"], 4),
            "netLpIrr": round(nirr, 4) if nirr is not None else None,
            "cohortStanding": standing, "gpCapitalNav": round(f["gpNav"], 2),
            "waterfall": waterfall_of.get(f["uuid"]),
            "gpCommit": (lambda g: round(g, 2) if g is not None else None)(gp_commit_of(f["uuid"], f["gpContrib"])),
            "grossMoic": fmetrics.get(f["uuid"], {}).get("grossMoic"),
            "currency": fmetrics.get(f["uuid"], {}).get("currency"),
        })
        baseLpNav[i] = round(f["lpNav"], 2)
        baseAccruedCarry[i] = round(f["accrued"], 2)
        gpEconomics[i] = {"accruedCarryToday": round(f["accrued"], 2), "accruedCarryAsOf": accrued_asof,
                          "carryDistributed": round(f["carryDistributed"], 2), "carryDistributedAsOf": dist_carry_asof,
                          "gpCapitalNav": round(f["gpNav"], 2),
                          "notes": "Accrued carry is the booked carried-interest-accrued allocation to the GP; carryDistributed is the booked realized (carried-interest-earned) carry."}
        windDownYear[i] = calc_vint + 10
        cashflows[i] = {"flows": flows, "paidInTotal": round(f["lpPaidIn"], 2),
                        "terminalDate": "%d-12-31" % (calc_vint + 10)}
    snap_funds.sort(key=lambda x: x["committed"], reverse=True)

    most = []
    for c in companies:
        if c.get("realized"):
            continue
        fv, cost = fv_by_company[c["id"]]["fv"], c["costBasis"]
        if fv > 0 and cost > 0:
            most.append({"fund": c["fundId"], "company": c["name"], "cost": cost, "cartaFv": fv,
                         "markX": round(fv / cost, 2), "lastFmvDate": fv_by_company[c["id"]]["markDate"], "notes": ""})
    most.sort(key=lambda m: m["cartaFv"], reverse=True)
    most = most[:12]

    snapshot = {
        "source": {"firm": firm_name, "firmId": firm_id, "firmUuid": firm_uuid,
                   "preparedAt": nav, "navAsOf": nav, "marksAsOf": nav,
                   "marksPulledAt": nav, "provider": "carta-fund-admin",
                   "currency": firm_currency, "mixedCurrency": mixed_currency,
                   "cartaEnvironment": carta_env},
        "branding": {"firmName": firm_name, "mark": mark},
        "funds": snap_funds, "baseLpNav": baseLpNav, "baseAccruedCarry": baseAccruedCarry,
        "accruedCarryAsOf": accrued_asof, "carryDistributedAsOf": dist_carry_asof, "gpEconomics": gpEconomics,
        "fundMetrics": {f["id"]: {"mgmtFees": round(f["mgmtFees"], 2), "opex": round(f["opex"], 2),
                                  "dryPowder": round(f["dryPowder"], 2)} for f in funds.values()},
        "navSeries": nav_series, "benchmarks": benchmarks, "benchmarksMeta": benchmarks_meta,
        "reprice": {"grossCarryRate": carry_default, "marksAsOf": nav},
        "marketRefs": {"spLongRun": 0.102, "spActualHotDecade": 0.13, "nasdaqActual": 0.17, "treasury10y": 0.044},
        "cashflows": cashflows, "windDownYear": windDownYear, "mostCompelling": most,
        "readMe": ["%s — Carta Fund Admin data, as of %s." % (firm_name, nav),
                   "Net IRR is xirr of dated LP cash flows + ending NAV (estimate). Accrued carry today is the booked ALLOCATIONS figure."],
    }

    # Seed per-fund waterfall assumptions from the Carta config so the baseline
    # scenario is pre-set (the sliders start there); funds without a config fall
    # back to the flat carry_default and disabled pref/catch-up.
    carry_rates_seed, pref_seed, cu_rate_seed, cu_limit_seed = {}, {}, {}, {}
    for f in funds.values():
        wf = waterfall_of.get(f["uuid"])
        if not wf or wf.get("carryRate") is None:
            continue
        i = f["id"]
        carry_rates_seed[i] = wf["carryRate"]
        if wf.get("preferredReturn"):
            pref_seed[i] = wf["preferredReturn"]
        if wf.get("catchupRate"):
            cu_rate_seed[i] = wf["catchupRate"]
            if wf.get("catchupLimit") is not None:
                cu_limit_seed[i] = wf["catchupLimit"]

    portfolio = {
        "version": 3,
        "seededFrom": {"firm": firm_name, "navAsOf": nav, "provider": "carta-fund-admin"},
        "activeSliceId": "baseline",
        "slices": [{
            "id": "baseline", "name": "Baseline", "locked": True, "createdAt": nav,
            "assumptions": {"carryRate": carry_default, "carryRates": carry_rates_seed,
                            "preferredReturns": pref_seed, "catchupRates": cu_rate_seed,
                            "catchupLimits": cu_limit_seed, "spRate": 0.102,
                            "spSensitivityRate": 0.13, "staleDays": 90, "feeLoads": {}, "followOnRatios": {}, "recyclingRatios": {}},
            "companies": companies,
        }],
    }

    # ---- LP base (per-LP, aggregated firm-wide) ----
    lp_agg = collections.OrderedDict()
    for r in parse_table(find(rawdir, "partners")):
        name = col(r, "partner_name")
        if not name:
            continue
        a = lp_agg.setdefault(name, {"name": name, "region": region_bucket(col(r, "partner_country")),
                                     "commitment": 0.0, "contributed": 0.0, "distributed": 0.0,
                                     "nav": 0.0, "funds": set(), "partnerClasses": set(),
                                     "partnerClassesByFund": {}})
        a["commitment"] += num(col(r, "commitment"))
        a["contributed"] += num(col(r, "contributed"))
        a["distributed"] += num(col(r, "distributed"))
        a["nav"] += num(col(r, "nav"))
        fund_uuid = col(r, "fund_uuid")
        if fund_uuid:
            a["funds"].add(fund_uuid)
        pc = col(r, "partner_class_name")
        if pc:
            a["partnerClasses"].add(pc)
            fund_id = SLUG.get(fund_uuid)
            if fund_id:
                a["partnerClassesByFund"][fund_id] = pc
    lps_all = sorted(lp_agg.values(), key=lambda x: x["commitment"], reverse=True)
    total_commit = sum(x["commitment"] for x in lps_all) or 1.0
    lp_rows = []
    for x in lps_all[:200]:
        contributed = x["contributed"]
        classes = x.get("partnerClasses") or set()
        partner_class = "; ".join(sorted(classes)) if classes else None
        classes_by_fund = x.get("partnerClassesByFund") or {}
        lp_rows.append({"name": x["name"], "region": x["region"], "commitment": round(x["commitment"], 2),
                        "pct": round(x["commitment"] / total_commit, 6), "contributed": round(contributed, 2),
                        "unfunded": round(max(0.0, x["commitment"] - contributed), 2),
                        "distributed": round(x["distributed"], 2), "nav": round(x["nav"], 2),
                        "dpi": round(x["distributed"] / contributed, 4) if contributed > 0 else None,
                        "funds": len(x["funds"]), "partnerClass": partner_class,
                        "partnerClassByFund": classes_by_fund if classes_by_fund else None})
    byregion = collections.defaultdict(lambda: {"commitment": 0.0, "count": 0})
    for x in lps_all:
        b = byregion[x["region"]]
        b["commitment"] += x["commitment"]
        b["count"] += 1
    by_region = sorted([{"region": k, "commitment": round(v["commitment"], 2),
                         "pct": round(v["commitment"] / total_commit, 6), "count": v["count"]}
                        for k, v in byregion.items()], key=lambda r: r["commitment"], reverse=True)
    lp_base = {"asOf": nav, "totalCommitment": round(total_commit, 2),
               "totalContributed": round(sum(x["contributed"] for x in lps_all), 2),
               "totalDistributed": round(sum(x["distributed"] for x in lps_all), 2),
               "totalNav": round(sum(x["nav"] for x in lps_all), 2),
               "byRegion": by_region, "lps": lp_rows} if lps_all else None

    # ---- GP base (per-GP-partner carry, keyed by fund id) → gp-base.json ----
    # Primary source: the gp_carry stem (§7b) — REAL per-partner 'Carried interest
    # accrued' allocations booked INSIDE each GP entity (ALLOCATIONS,
    # ENTITY_TYPE_NAME='GP'), joined to the LP fund via the fund-level GP allocation.
    # Each partner's `carryShare` is their share of the GP entity's accrued carry;
    # the app multiplies the fund's SCENARIO GP carry by this share, so partner-level
    # carry reacts to reprices — deterministic, never a modeled/LLM guess.
    # Optionally enriched with GP commitment/contributed from the gp_partners stem
    # (PARTNER_DATA IS_GENERAL_PARTNER) when a firm exposes it. Kept PER FUND and
    # keyed by the snapshot fund id `i` — the SAME key gpEconomics uses. Absent when
    # neither stem produced rows.
    uuid_to_id = {f["uuid"]: f["id"] for f in funds.values()}

    # optional commitment enrichment (PARTNER_DATA GP side): fund id -> {name -> {...}}
    gp_commit_rows = collections.defaultdict(collections.OrderedDict)
    for r in parse_table(find(rawdir, "gp_partners")):
        fkey = uuid_to_id.get(col(r, "fund_uuid"))
        gp_name = col(r, "partner_name")
        if fkey is None or not gp_name:
            continue
        a = gp_commit_rows[fkey].setdefault(gp_name, {"commitment": 0.0, "contributed": 0.0})
        a["commitment"] += num(col(r, "commitment"))
        a["contributed"] += num(col(r, "contributed"))

    # primary: per-partner accrued carry from gp_carry, grouped by fund id
    gp_carry_rows = collections.defaultdict(collections.OrderedDict)  # fkey -> {name -> {...}}
    gp_entity_of = {}
    for r in parse_table(find(rawdir, "gp_carry")):
        fkey = uuid_to_id.get(col(r, "fund_uuid"))
        pname = col(r, "partner_name")
        if fkey is None or not pname:
            continue
        gp_entity_of.setdefault(fkey, col(r, "gp_entity_name") or None)
        a = gp_carry_rows[fkey].setdefault(pname, {"name": pname, "accruedCarry": 0.0,
                                                   "partnerType": col(r, "partner_type") or None})
        a["accruedCarry"] += num(col(r, "accrued_carry"))

    gp_base = {}
    fund_id_order = [f["id"] for f in funds.values()]
    # Key on funds that have REAL per-partner carry (gp_carry). gp_partners
    # (PARTNER_DATA GP side) is only name-match enrichment — on its own it often
    # just lists the GP entity as a 0-commit partner, which isn't partner-level carry.
    for fkey in [k for k in fund_id_order if k in gp_carry_rows]:
        carry_per = gp_carry_rows.get(fkey, {})
        commit_per = gp_commit_rows.get(fkey, {})
        total_carry = sum(x["accruedCarry"] for x in carry_per.values())
        # partners = only those with real carry allocations; gp_partners enriches by
        # name (never adds a row — else the GP entity itself leaks in as a phantom)
        names = list(carry_per.keys())
        total_commit = sum(commit_per[n]["commitment"] for n in names if n in commit_per)
        partners = []
        for n in names:
            cc = carry_per.get(n)
            cm = commit_per.get(n, {})
            accrued = cc["accruedCarry"] if cc else None
            partners.append({
                "name": n,
                "partnerType": cc["partnerType"] if cc else None,
                "accruedCarry": round(accrued, 2) if accrued is not None else None,
                # share of the GP entity's carry — the deterministic split the app applies
                "carryShare": round(accrued / total_carry, 6) if (accrued is not None and total_carry) else None,
                "commitment": round(cm["commitment"], 2) if cm.get("commitment") else None,
                "contributed": round(cm["contributed"], 2) if cm.get("contributed") else None,
            })
        # rank by accrued carry when present, else GP commitment
        partners.sort(key=lambda p: (p["accruedCarry"] if p["accruedCarry"] is not None else (p["commitment"] or 0)),
                      reverse=True)
        gp_base[fkey] = {
            "gpEntity": gp_entity_of.get(fkey),
            "totalAccruedCarry": round(total_carry, 2) if carry_per else None,
            "totalGpCommit": round(total_commit, 2) if commit_per else None,
            "partners": partners,
        }
    gp_base = gp_base or None


    # ---- company ownership (optional) → fully-diluted fraction per company ----
    # FUND_CORPORATION_OWNERSHIP exposes CORPORATION_ID + PERCENTAGE (a 0-1
    # fraction, frequently 0). PERCENTAGE is the ownership %; FULLY_DILUTED is a
    # SHARE COUNT, never a fraction — do not use it. CORPORATION_ID is joined
    # directly to the company that resolved to that corpUuid (§16) — no
    # name matching. Sum the fraction across the firm's funds per company.
    corp_to_cid = {c["corpUuid"]: c["id"] for c in companies if c.get("corpUuid")}
    own_pct = collections.defaultdict(float)
    # Per-fund split (drives the fund-level AVERAGE ownership on Overview). The
    # firm-summed `own_pct` is kept unchanged for back-compat; `own_by_fund` is
    # the same fractions broken out by fund. FUND_CORPORATION_OWNERSHIP keys by
    # fund UUID, so map it through SLUG to the app fund id (the slug used by
    # positions[].fundId and snapshot.funds[].id) — the raw UUID would not join.
    own_by_fund = collections.defaultdict(lambda: collections.defaultdict(float))
    own_asof = {}
    for r in parse_table(find(rawdir, "ownership")):
        pct = numn(col(r, "ownership_pct", "percentage", "pct"))
        if pct is None or pct <= 0:
            continue
        cid = corp_to_cid.get(col(r, "corporation_id", "corp_id"))
        if not cid:
            continue
        own_pct[cid] += pct
        fund_slug = SLUG.get(col(r, "fund_id", "fund_uuid"))
        if fund_slug:
            own_by_fund[cid][fund_slug] += pct
        a = col(r, "as_of", "as_of_date")
        if a and a > own_asof.get(cid, ""):
            own_asof[cid] = a
    ownership = {cid: {"pct": round(p, 6), "asOf": own_asof.get(cid) or nav,
                       "byFund": {fid_: round(fp, 6) for fid_, fp in own_by_fund[cid].items()}}
                 for cid, p in own_pct.items()}

    # ---- company cap table + liquidation preferences → company-captable.json ----
    # Join each built company to its Carta corporation via its own corpUuid
    # (no name matching), attach its cap-table stack, and aggregate the
    # fund's holdings by share class (positions' `security` + `shares`) so the
    # app's waterfall is fund-specific. A lightweight {available, hasPrefTerms}
    # flag also lands on the company object so the Companies grid can badge without
    # loading this side file. corp_id survives here only; app JSON keys stay by slug.
    cap_count = 0
    cap_pref = 0
    for c in companies:
        corp_id = c.get("corpUuid")
        classes = captable_by_corp.get(corp_id) if corp_id else None
        if not classes:
            continue
        holdings = collections.OrderedDict()
        for p in c["positions"]:
            hn = p.get("security") or "Equity"
            h = holdings.setdefault(hn, {"className": hn, "shares": 0.0, "cost": 0.0, "fmv": 0.0})
            h["shares"] += p.get("shares") or 0
            h["cost"] += p.get("cost") or 0
            h["fmv"] += p.get("cartaFv") or 0
        has_pref = any((cl["kind"] or "").lower() == "preferred" and cl["multiplier"] is not None
                       for cl in classes)
        # Embed the whole cap-table entry ON the company object (the immutable Carta
        # layer, like positions) so every pure model fn — reprice, fund NAV rollup,
        # concentration, the Companies waterfall — reads it without threading React
        # context, and the UI badges/renders from the same object. corp_id lives here
        # only; the company id (issuer slug) remains the app-facing key.
        c["capTable"] = {
            "available": True,
            "hasPrefTerms": has_pref,
            "corporationId": corp_id,
            "currency": captable_ccy.get(corp_id) or firm_currency,
            "asOf": nav,
            "classes": classes,
            "fundHoldings": [{"className": h["className"], "shares": round(h["shares"], 4),
                              "cost": round(h["cost"], 2), "fmv": round(h["fmv"], 2)}
                             for h in holdings.values()],
        }
        cap_count += 1
        if has_pref:
            cap_pref += 1

    # ---- pacing ----
    firsts = sorted(pacing_first.values(), key=lambda x: x[2], reverse=True)
    monthly = collections.defaultdict(collections.Counter)
    for (n, fdid, d) in firsts:
        monthly[fdid][d[:7]] += 1
    pacing = {"pulledAt": nav, "recent": [{"fund": fdid, "name": n, "date": d} for (n, fdid, d) in firsts[:12]],
              "monthly": {fdid: sorted([list(t) for t in mc.items()]) for fdid, mc in monthly.items()}}

    firms = [{"slug": meta.get("slug") or slug(firm_name), "name": firm_name,
              "mark": mark, "funds": len(snap_funds), "navAsOf": nav}]

    os.makedirs(out, exist_ok=True)

    def w(name, obj):
        with open(os.path.join(out, name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2)

    # Preserve user scenarios across a refresh, reconciled onto the fresh baseline
    # (see reconcile_slice). A company's Carta layer is never user-writable, so
    # rebuilding each scenario on the fresh baseline and overlaying just the user
    # knobs can't drop an edit or keep a stale mark.
    prev_active = None
    try:
        with open(os.path.join(out, "portfolio.json"), encoding="utf-8") as fh:
            prev = json.load(fh)
    except (FileNotFoundError, ValueError, OSError):
        prev = None
    if isinstance(prev, dict):
        prev_active = prev.get("activeSliceId")
        live_fund_ids = {f["id"] for f in funds.values()}
        for s in (prev.get("slices") or []):
            if not (isinstance(s, dict) and s.get("id") and s.get("id") != "baseline"):
                continue
            # best-effort: skip a malformed scenario, never abort the refresh
            try:
                reconciled, dropped = reconcile_slice(s, companies, live_fund_ids)
            except Exception as e:
                print("[build_datadir] skipped unmergeable scenario %r: %s"
                      % (s.get("id"), e), file=sys.stderr)
                continue
            portfolio["slices"].append(reconciled)
            if dropped:
                print("[build_datadir] scenario %r: dropped %d company(ies) no longer in "
                      "Carta: %s" % (s.get("id"), len(dropped),
                                     ", ".join(sorted(str(x) for x in dropped))),
                      file=sys.stderr)
    if prev_active and any(s.get("id") == prev_active for s in portfolio["slices"]):
        portfolio["activeSliceId"] = prev_active

    w("firms.json", firms)
    w("snapshot.json", snapshot)
    w("portfolio.json", portfolio)
    w("pacing.json", pacing)
    if lp_base:
        w("lp-base.json", lp_base)
    if gp_base:
        w("gp-base.json", gp_base)
    if ownership:
        w("company-ownership.json", ownership)

    return {"funds": len(snap_funds), "companies": len(companies),
            "droppedNoId": dropped_no_id,
            "dealIrr": sum(1 for c in companies if c.get("dealIrr") is not None),
            "lastRound": sum(1 for c in companies if c.get("lastRound")),
            "revenue": sum(1 for c in companies if c.get("financials")),
            "capTable": cap_count,
            "capTablePref": cap_pref,
            "navSeries": len(nav_series), "lps": len(lp_rows),
            "benchmarks": bench_covered, "benchmarksReason": bench_reason,
            "currency": firm_currency, "mixedCurrency": mixed_currency,
            "accruedAsOf": accrued_asof}


# ---------- fail-loud data-contract check ----------
# Each entry: (stem, requiredness, [load-bearing columns the builder reads]).
# `requiredness` is three-valued and encodes how missing data gates the build:
#   True    — rows required. The launch-gating stems (funds + companies); an
#             empty/missing file yields 0 funds/companies and trips strict mode.
#   "file"  — the fetch must be *attempted*: the <stem>.ndjson file MUST exist, but
#             may be empty. A MISSING file means the LLM never ran the query (a
#             non-deterministic skip) and hard-fails the build; a present-but-empty
#             file is legitimate ("Carta publishes none" / access-denied) and
#             degrades gracefully. This makes the deterministic builder — not the
#             LLM's memory — enforce that every DWH stem was fetched.
#   False   — genuinely optional (external deps: other-skill/on-demand).
# When a stem file exists but its rows lack a load-bearing column, the derived
# feature silently empties — so we surface it as a precise stderr warning.
STEM_CONTRACT = [
    ("nav_latest",    True,   ["fund_uuid", "fund_name", "ending_lp_nav",
                               "cumulative_lp_distributions", "lp_tvpi"]),
    ("investments",   True,   ["fund_uuid", "issuer_name", "entity_link_id",
                               "latest_fmv_effective_date", "latest_update_effective_date"]),
    ("cashflows",     "file", ["fund_uuid", "month_end_date", "lp_contributions",
                               "lp_distributions", "ending_lp_nav",
                               "cumulative_lp_contributions", "cumulative_lp_distributions"]),
    # p5/p10/p25 (below the median) are load-bearing: CohortStanding interpolates a
    # real percentile for a fund below p50 instead of falling back to a fabricated
    # one, but only if these columns actually reach the builder — locks the full
    # SQL -> raw file -> band() chain against drift for all three metrics.
    ("cohort",        "file", ["fund_uuid", "vintage_year",
                               "tvpi_5", "tvpi_10", "tvpi_25", "tvpi_50", "tvpi_75", "tvpi_90", "tvpi_95",
                               "dpi_5", "dpi_10", "dpi_25", "dpi_50", "dpi_75", "dpi_90", "dpi_95",
                               "moic_5", "moic_10", "moic_25", "moic_50", "moic_75", "moic_90", "moic_95"]),
    ("accrued_carry", "file", ["fund_uuid", "accrued_carry"]),
    ("distributed_carry", "file", ["fund_uuid", "carry_distributed"]),
    ("partners",      "file", ["partner_name"]),
    # gp_partners / gp_carry are ATTEMPT-required ("file"): they're always runnable
    # DWH queries, so a bare "rebuild" must fetch them every time — an ABSENT file is
    # a skipped fetch and hard-fails, but a present-but-empty file is legitimate (not
    # every firm exposes GP-partner rows or books GP-entity carry) and degrades
    # gracefully (the GP Economics tab hides what it lacks). This closes the "optional,
    # so silently skippable" gap: you must run them and record the result.
    ("gp_partners",   "file", ["partner_name"]),
    ("gp_carry",      "file", ["fund_uuid", "partner_name", "accrued_carry"]),
    ("deal_irr",      "file", ["fund_uuid", "issuer_name", "deal_irr"]),
    # waterfall: PROFIT_ALLOCATION_WATERFALL_CONFIG — real per-fund carry / preferred
    # return / GP catch-up. Optional — a firm with no automated waterfall legitimately
    # has none (a missing/empty file must NOT gate the build); when absent, carry falls
    # back to the flat carryRate default and pref/catch-up disable.
    ("waterfall",     False,  ["fund_id", "carry_rate"]),
    ("financing",     "file", ["corporation_id", "post_money_valuation"]),
    ("ownership",     "file", ["corporation_id", "percentage"]),
    ("fund_metrics",  "file", ["fund_uuid", "fund_reporting_currency"]),
    # captable / corporations: attempt-required ("file"), like gp_partners/gp_carry/
    # deal_irr above. A firm whose portcos aren't Carta cap-table customers legitimately
    # yields 0 rows — a present-but-empty file degrades gracefully (no cap table / no
    # "Latest round" enrichment). But an ABSENT file means Wave 2 was skipped, which is
    # indistinguishable from that legitimate case unless it hard-fails: silently missing
    # `corporations` breaks the entity_link -> corporation_uuid bridge, so `lastRound`
    # (Overview "Recent activity" cards) and captable-derived fields quietly go blank for
    # every company, even ones with real financing/cap-table data sitting in the DWH.
    ("captable",      "file", ["corporation_id", "security_class_name",
                               "security_class_type_detailed", "seniority", "multiplier",
                               "participating_preferred", "original_issue_price",
                               "conversion_ratio", "outstanding_shares", "cash_raised"]),
    ("corporations",  "file", ["entity_link_id", "corporation_uuid"]),
]

# Firm-CONTEXT stems fetched OUTSIDE the fund/corp-filtered manifest — they ride the
# set_context firm scope (no IN-list), so they aren't in stem_queries.STEMS. Still
# ATTEMPT-required so a bare "rebuild" runs them EVERY time: an absent file is a
# skipped fetch (hard-fail), a present-but-empty file is legitimate (the firm has no
# such data / access-denied). This is why §14 company financials can no longer be
# silently omitted. (stem, [load-bearing columns])
FIRM_SCOPED_REQUIRED = [
    ("financials", ["legal_name", "float_value", "period_end"]),
]

# Human-readable consequence for a few high-value missing columns (else generic).
COLUMN_CONSEQUENCE = {
    ("cashflows", "fund_uuid"): "every cashflow row dropped -> no per-fund IRR and empty NAV trend",
    ("cashflows", "ending_lp_nav"): "NAV trend renders $0",
    ("cashflows", "cumulative_lp_contributions"): "NAV-trend TVPI blank",
    ("cashflows", "lp_contributions"): "LP flows missing -> net IRR unavailable",
    ("nav_latest", "ending_lp_nav"): "Overview LP NAV shows $0",
    ("nav_latest", "cumulative_lp_distributions"): "LP distributions / DPI show $0 (do not alias cumulative_total_distributions)",
    ("nav_latest", "lp_tvpi"): "TVPI/DPI/RVPI blank on Overview",
    ("nav_latest", "fund_uuid"): "no funds parsed",
    ("fund_metrics", "fund_reporting_currency"): "currency labels render blank (never hardcode USD)",
}


def contract_report(rawdir):
    """Inspect the raw dir against STEM_CONTRACT. Returns (warnings, status,
    unfetched) where `warnings` are precise column-drift lines (always worth
    printing), `status` is a per-stem human summary used in the strict-failure
    diagnostic, and `unfetched` lists the file-required stems whose file is
    ABSENT (i.e. the query was never run — a non-deterministic skip). `unfetched`
    hard-gates the build in main(): a present-but-empty file is fine, a missing
    one is not."""
    warnings, status, unfetched = [], [], []
    for stem, required, cols in STEM_CONTRACT:
        path = find(rawdir, stem)
        if not path:
            if required in (True, "file"):
                unfetched.append(stem)
            label = {True: " (required — rows)",
                     "file": " (required — fetch not attempted)"}.get(required, " (optional)")
            status.append((stem, "MISSING file" + label))
            continue
        rows = parse_table(path)
        if not rows:
            if required == "file":
                status.append((stem, "0 rows (empty file OK — fetch attempted, none published/accessible)"))
            else:
                status.append((stem, "0 rows (empty or unparseable — did you save the MCP wrapper instead of ndjson?)"))
            continue
        keys = set()
        for r in rows[:50]:
            keys |= set(r.keys())
        missing = [c for c in cols if c not in keys]
        if missing:
            for c in missing:
                consequence = COLUMN_CONSEQUENCE.get((stem, c), "derived field empties")
                warnings.append("ERROR stem=%s missing column '%s' -> %s" % (stem, c, consequence))
            status.append((stem, "%d rows, MISSING columns: %s" % (len(rows), ", ".join(missing))))
        else:
            status.append((stem, "%d rows OK" % len(rows)))
    # firm-context stems (no IN-list, ride set_context) — same attempt-required rule
    for stem, cols in FIRM_SCOPED_REQUIRED:
        path = find(rawdir, stem)
        if not path:
            unfetched.append(stem)
            status.append((stem, "MISSING file (required — fetch not attempted)"))
            continue
        rows = parse_table(path)
        if not rows:
            status.append((stem, "0 rows (empty file OK — fetch attempted, none published/accessible)"))
            continue
        keys = set()
        for r in rows[:50]:
            keys |= set(r.keys())
        missing = [c for c in cols if c not in keys]
        status.append((stem, ("%d rows, MISSING columns: %s" % (len(rows), ", ".join(missing)))
                              if missing else "%d rows OK" % len(rows)))
    return warnings, status, unfetched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta", required=True)
    # Strict is the default: a run that yields 0 funds or 0 companies is a broken
    # launch, so fail loudly instead of writing a valid-but-empty data dir the app
    # would serve as a blank dashboard. --no-strict is the dev/fixture escape hatch.
    ap.add_argument("--strict", dest="strict", action="store_true", default=True)
    ap.add_argument("--no-strict", dest="strict", action="store_false")
    a = ap.parse_args()
    with open(a.meta, encoding="utf-8") as fh:
        meta = json.load(fh)

    # meta.json is the one input the LLM hand-authors rather than the deterministic
    # generator producing it, so it gets no STEM_CONTRACT column check. navAsOf is
    # load-bearing (snapshot.source.navAsOf drives every exit-date calc on the
    # Companies tab — an empty value makes exit-timing silently collapse to a flat
    # line, see plugins/carta-investors — do not let it slip through quietly).
    if a.strict and not (meta.get("navAsOf") or "").strip():
        print("[build_datadir] STRICT FAILURE: meta.json is missing \"navAsOf\" (or it's "
              "blank) — the app derives every exit-date calc on the Companies tab from "
              "this field. Set it to the latest nav_latest month_end_date (ISO) before "
              "building.", file=sys.stderr)
        sys.exit(2)

    warnings, status, unfetched = contract_report(a.raw)
    for w in warnings:
        print("[build_datadir] " + w, file=sys.stderr)

    # Deterministic fetch gate: every file-required DWH stem must have been
    # *attempted* (its file must exist, even if empty). A missing file means the
    # query was never run — a non-deterministic skip we refuse to launch on. This
    # is what makes cohort (and its siblings) mandatory without relying on the LLM
    # remembering to fetch them. On a genuine query error / zero rows, the skill
    # writes an EMPTY stem file to record the attempt; that passes this gate.
    if a.strict and unfetched:
        print("[build_datadir] STRICT FAILURE: %d stem file(s) never fetched: %s"
              % (len(unfetched), ", ".join(unfetched)), file=sys.stderr)
        print("[build_datadir] These are required-fetch stems — the query must be RUN "
              "before building. Run each one (see references/queries.md); if a query "
              "errors (e.g. `Error in secure object`) or returns nothing, write an EMPTY "
              "<stem>.ndjson to record the attempt. Do NOT skip the fetch.", file=sys.stderr)
        for stem, st in status:
            print("[build_datadir]   - %-16s %s" % (stem, st), file=sys.stderr)
        sys.exit(2)

    # Deterministic truncation gate. Unlike the fetch gate above this is NOT
    # strict-only: a truncated stem is silently wrong data, and a dashboard built on
    # it misreports NAV / LP IRR / cap tables with no visible symptom. Fixture builds
    # (the only sanctioned --no-strict use) have no markers, so gating unconditionally
    # costs them nothing.
    truncated = truncated_stems(a.raw)
    if truncated:
        print("[build_datadir] FAILURE: %d stem(s) are INCOMPLETE — the DWH clamps every "
              "limit to 10,000 rows and reported more pages:" % len(truncated), file=sys.stderr)
        for stem, next_offset in truncated:
            at = "offset=%s" % next_offset if next_offset is not None else "offset unknown"
            print("[build_datadir]   - %-16s resume at %s" % (stem, at), file=sys.stderr)
        print("[build_datadir] Building now would silently serve partial data. Re-run each "
              "stem's query with that offset and capture it with "
              "`save_query_result.py <result_path> <raw_dir>/<stem>.ndjson --append`, "
              "repeating until the helper stops reporting a next_offset (it clears the "
              "marker itself). Do NOT delete the marker by hand.", file=sys.stderr)
        sys.exit(2)

    summary = build(a.raw, a.out, meta)
    print("[build_datadir] " + json.dumps(summary))

    # Surface attempted-but-empty stems on a SUCCESSFUL build. A legitimately-empty
    # file and a lazily-skipped one look identical to the gate, so name them here —
    # a reviewer who sees "financials" empty on a firm that should have Data
    # Collection data can catch a skipped fetch that would otherwise pass silently.
    empties = [stem for stem, st in status if st.startswith("0 rows")]
    if empties:
        print("[build_datadir] empty (0 rows — attempted, none published): %s" % ", ".join(empties))

    if a.strict and (summary["funds"] == 0 or summary["companies"] == 0):
        print("[build_datadir] STRICT FAILURE: funds=%d companies=%d — refusing to "
              "produce an empty dashboard. Raw-stem status:"
              % (summary["funds"], summary["companies"]), file=sys.stderr)
        for stem, st in status:
            print("[build_datadir]   - %-14s %s" % (stem, st), file=sys.stderr)
        print("[build_datadir] Fix the named stem(s) and re-run. Re-run with "
              "--no-strict only for local fixture builds.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
