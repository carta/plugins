#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""
carta-portfolio-analytics-app data builder (firm-agnostic).

Transforms the raw query files a KPI fetch wrote into the two JSON files the
React app consumes:

  firms.json  = [{"slug","name"}]           (single-firm registry)
  kpi.json    = {source, branding?, metrics[], companies[], dimensions}

Inputs (ndjson, one JSON object per line — the shape save_query_result.py writes):
  <raw>/financials.ndjson   REQUIRED-ATTEMPT  COMPANY_FINANCIALS (queries.md §14):
                            legal_name, name, mnemonic, unit_type, currency,
                            float_value, string_value, period_end
                            (+ optional report_type)
  <raw>/holdings.ndjson    optional          AGGREGATE_INVESTMENTS (§3): issuer_name,
                            fund_uuid — maps a company to its fund(s) for slicing.
  <raw>/entity_identity.ndjson optional      CORPORATION_BASIC_INFO_V2 (§6): entity_link_id,
                            corporation_id, corporation_uuid, is_carta_customer,
                            corporation_name — resolves company_key() identities.
  <raw>/corporation_links.ndjson optional    CORPORATION_ENTITY_LINKS (§7): general_ledger_issuer_id,
                            corporation_id — every corporation a GL issuer is linked to.
  <raw>/funds.ndjson        optional          §0 directory: fund_uuid, fund_name
  <raw>/meta.json           REQUIRED          {"name","slug","navAsOf"?,"currency"?,
                            "mark":{"text","bg","fg"}?, "firmId"?, "firmUuid"?}

Every KPI metric a company reports is surfaced (no curated allow-list) — the
metric list is discovered from the data. Coverage is partial: only portfolio
companies that report into Carta Data Collection appear.

Usage:
  uv run build_kpi_datadir.py --raw <raw_dir> --out <out_dir> --meta <raw_dir>/meta.json
"""
import argparse
import datetime as _dt
import importlib.util as _ilu
import json
import os
import re
import sys
from pathlib import Path


def _sibling(name):
    """Load a sibling script by absolute path — never via sys.path, so importing this
    module in a shared test session can't shadow a same-named script from another skill."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = _ilu.spec_from_file_location("_pa_" + name, p)
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_datasets = _sibling("datasets")


def _dataset_freshness(raw):
    """Per-dataset {present, fetchedAt} from the raw stem files' mtimes. present = a
    non-empty stem file exists; fetchedAt = ISO-8601 UTC of the newest such file, else
    None. A partial refresh rewrites only its stems, so those datasets read as newer."""
    raw = Path(raw)
    out = []
    for ds in _datasets.DATASETS:
        newest = None
        present = False
        for stem in ds["stems"]:
            try:
                st = (raw / ("%s.ndjson" % stem)).stat()
            except OSError:
                continue
            if st.st_size > 0:
                present = True
                if newest is None or st.st_mtime > newest:
                    newest = st.st_mtime
        fetched = (_dt.datetime.fromtimestamp(newest, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                   if newest is not None else None)
        out.append({"key": ds["key"], "label": ds["label"], "blurb": ds["blurb"],
                    "stems": ds["stems"], "present": present, "fetchedAt": fetched})
    return out


# ---------- raw readers ----------
def read_ndjson(path):
    """Yield dict rows from an ndjson file. Missing file -> nothing. Tolerates a
    single JSON array too (some capture paths emit one)."""
    if not path or not path.exists():
        return
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return
    if text[0] == "[":  # a JSON array rather than ndjson
        try:
            for r in json.loads(text):
                if isinstance(r, dict):
                    yield r
        except ValueError:
            pass
        return
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if isinstance(r, dict):
            yield r


_col_cache_row = None
_col_cache_lower = None


def col(row, *names):
    """First non-empty value among case-insensitive column aliases -> str.

    Every ingestion loop below calls this many times per row (one call per
    field, often with several alias names), which used to rebuild
    ``{k.lower(): v for k, v in row.items()}`` from scratch on every single
    call. Memoize that lowercased view for whichever row was seen last —
    identity check (``is``), not equality, and never a stale hit even if a
    prior row's id gets reused after GC, since we hold a live reference to the
    actual object, not just its id. Callers always finish all their col()
    calls for one row before moving to the next (no interleaving across two
    live rows), so this collapses N rebuilds per row into 1.
    """
    global _col_cache_row, _col_cache_lower
    if row is not _col_cache_row:
        _col_cache_lower = {k.lower(): v for k, v in row.items()}
        _col_cache_row = row
    for n in names:
        v = _col_cache_lower.get(n.lower())
        if v is not None and v != "":
            return v
    return ""


def parse_tags(raw):
    """AGGREGATE_INVESTMENTS.TAGS_JSON -> {category: [values]}.

    Categories are firm-defined, so none are hardcoded. A malformed blob yields no
    tags rather than failing the build.
    """
    if not raw:
        return {}
    try:
        tj = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return {}
    if not isinstance(tj, dict):
        return {}
    out = {}
    for cat, vals in tj.items():
        cat = str(cat).strip()
        if not cat:
            continue
        if not isinstance(vals, list):
            vals = [vals]
        clean = []
        for v in vals:
            if v is None:
                continue
            s = str(v).strip()
            if s:
                clean.append(s)
        if clean:
            out.setdefault(cat, []).extend(clean)
    return out


def _first_tag(co_tags, cat):
    """The alphabetically-first value of one tag category, or None."""
    vals = co_tags.get(cat)
    return sorted(vals)[0] if vals else None


def numn(v):
    """Parse a number, tolerating $ , and () negatives. None if not a number."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("$", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        f = float(s)
    except ValueError:
        return None
    return -f if neg else f


# ---------- qualitative KPIs (COMPANY_FINANCIALS.STRING_VALUE) ----------
# A flag, a date or free prose reported as a KPI. UNIT_TYPE is the discriminator.
_TRUE_WORDS = {"yes", "true", "y", "t", "1"}
_FALSE_WORDS = {"no", "false", "n", "f", "0"}
# "Sep 01, 2026" is what Data Collection emits; the rest come from hand imports.
_DATE_FORMATS = ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y", "%d %b %Y", "%d %B %Y")
_EPOCH = _dt.date(1970, 1, 1)
_DAYS_PER_MONTH = 30.4375  # mean Gregorian month
MONTHS_TO_SUFFIX = "__MONTHS_TO"


def _parse_date(s):
    for fmt in _DATE_FORMATS:
        try:
            return _dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_qual(unit_type, raw):
    """Read a STRING_VALUE -> (value, display, kind, date).

    kind is "boolean" (value 1/0), "date" (value = days since epoch) or "text"
    (value None). A Boolean or Date that will not parse falls back to text, so a
    bad value still reaches the user instead of vanishing.
    """
    s = "" if raw is None else str(raw).strip()
    if not s:
        return (None, None, None, None)
    unit = (unit_type or "").strip().lower()
    low = s.lower()

    if unit == "boolean" or (not unit and low in _TRUE_WORDS | _FALSE_WORDS):
        if low in _TRUE_WORDS:
            return (1.0, s, "boolean", None)
        if low in _FALSE_WORDS:
            return (0.0, s, "boolean", None)
        return (None, s, "text", None)

    if unit == "date":
        d = _parse_date(s)
        if d is not None:
            return (float((d - _EPOCH).days), s, "date", d)
        return (None, s, "text", None)

    return (None, s, "text", None)


def months_between(period_end, target):
    """Signed months from a reporting period to a target date, 1 decimal place.

    Positive is ahead of the company, negative is already passed. This is what
    lets a covenant test "Predicted Cash Out Date".
    """
    start = _parse_date(str(period_end)[:10])
    if start is None or target is None:
        return None
    return round((target - start).days / _DAYS_PER_MONTH, 1)


_slug_re = re.compile(r"[^a-z0-9]+")


def slugify(s):
    return _slug_re.sub("-", (s or "").lower()).strip("-") or "x"


def norm_co(name):
    """Normalize a company name for cross-stem joins (financials legal_name vs
    investments issuer_name): lowercase, drop legal suffixes / punctuation."""
    s = (name or "").lower()
    s = re.sub(r"\(fka[^)]*\)", " ", s)          # "(fka Old Name)"
    s = re.sub(r"[.,]", " ", s)
    s = re.sub(r"\b(inc|llc|ltd|corp|co|lp|plc|holdings|company|the)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------- company identity ----------
# Mirrors carta-fund-modeling's company_key(): the display name is never an identity.
# A company is keyed by its Fund Admin entity link; a row that carries only a GL issuer
# id resolves to that link through the holdings stems (which carry both ids), and one
# with only a corporation UUID through the entity_identity directory. Rows neither can
# place keep a typed fallback key so their id namespaces never collide with each other
# or with entity-link ids.
ENTITY_KIND_CUSTOMER = "carta-customer"
ENTITY_KIND_PAPER = "paper"
ENTITY_KIND_GL = "gl-issuer"

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_NULL_STRINGS = ("", "none", "null")


def _s(v):
    """A cell as a stripped string, '' for every spelling of null."""
    s = "" if v is None else str(v).strip()
    return "" if s.lower() in _NULL_STRINGS else s


def _int_or_none(v):
    s = _s(v)
    try:
        return int(float(s)) if s else None
    except ValueError:
        return None


def load_identity(raw):
    """Identity directory for company_key(): entity-link records by link and by corporation
    UUID, `canonical` folding links that share a corporation onto the first, the GL issuer
    -> entity link bridge from the holdings stems, and the corporations each GL issuer is
    linked to (corporation_links.ndjson) so KPI rows keyed only by corporation resolve."""
    raw = Path(raw)
    ident = {"by_entity_link": {}, "by_gl_issuer": {}, "by_corp_uuid": {}, "canonical": {}}
    gl_fanout = 0
    for r in read_ndjson(raw / "entity_identity.ndjson"):
        el = _s(col(r, "entity_link_id"))
        if not el:
            continue
        rec = {
            "entityLinkId": el,
            "corporationId": _int_or_none(col(r, "corporation_id")),
            "corporationUuid": _s(col(r, "corporation_uuid")) or None,
            "isCartaCustomer": _s(col(r, "is_carta_customer")).lower() in ("true", "1"),
            "name": _s(col(r, "corporation_name")) or None,
        }
        ident["by_entity_link"][el] = rec
        if rec["corporationUuid"]:
            existing = ident["by_corp_uuid"].get(rec["corporationUuid"])
            if existing is None:
                ident["by_corp_uuid"][rec["corporationUuid"]] = rec
            elif existing["entityLinkId"] != el:
                ident["canonical"][el] = existing["entityLinkId"]
    canon = ident["canonical"]
    for stem in ("holdings.ndjson", "holdings_history.ndjson"):
        for r in read_ndjson(raw / stem):
            el, gl = _s(col(r, "entity_link_id")), _s(col(r, "general_ledger_issuer_id"))
            if el and gl:
                el = canon.get(el, el)
                existing = ident["by_gl_issuer"].get(gl)
                if existing is None:
                    ident["by_gl_issuer"][gl] = el
                elif existing != el:
                    gl_fanout += 1
    for r in read_ndjson(raw / "corporation_links.ndjson"):
        gl, cu = _s(col(r, "general_ledger_issuer_id")), _s(col(r, "corporation_id"))
        el = ident["by_gl_issuer"].get(gl) if gl else None
        if el and cu and cu not in ident["by_corp_uuid"]:
            ident["by_corp_uuid"][cu] = ident["by_entity_link"].get(el) or {
                "entityLinkId": el, "corporationId": None, "corporationUuid": None,
                "isCartaCustomer": False, "name": None}
    if canon:
        print("NOTE: %d entity link(s) share a corporation with another link and were merged onto it."
              % len(canon), file=sys.stderr)
    if gl_fanout:
        print("NOTE: identity fan-out — %d GL issuer id(s) map to more than one entity link; "
              "first seen wins." % gl_fanout, file=sys.stderr)
    return ident


def company_key(row, ident, name=None):
    """(id, keyType) for one stem row, or None when it carries nothing usable.
    Order: the row's own entity link (folded onto its canonical link); a GL issuer id
    the holdings stems pair with an entity link, or a corporation UUID the directory or
    the corporation links map to one; then typed fallbacks gl: / llc: / corp: / name:."""
    el = _s(col(row, "entity_link_id"))
    if el:
        return ((ident.get("canonical") or {}).get(el, el), "entity_link")
    gl = _s(col(row, "general_ledger_issuer_id"))
    el = ident["by_gl_issuer"].get(gl) if gl else None
    if el:
        return (el, "entity_link")
    # financials / capstack / fdshares carry the corporation UUID under corporation_id
    cu = _s(col(row, "corporation_uuid")) or _s(col(row, "corporation_id"))
    if not _UUID_RE.match(cu):
        cu = ""
    rec = ident["by_corp_uuid"].get(cu) if cu else None
    if rec:
        return (rec["entityLinkId"], "entity_link")
    if gl:
        return ("gl:" + gl, "gl_issuer")
    llc = _s(col(row, "llc_entity_id"))
    if llc:
        return ("llc:" + llc, "llc")
    if cu:
        return ("corp:" + cu, "corporation")
    nm = norm_co(name if name is not None else col(row, "legal_name", "issuer_name", "corp_name", "name"))
    return ("name:" + nm, "name") if nm else None


def entity_kind(rec):
    if not rec:
        return None
    if rec.get("corporationId") is not None:
        return ENTITY_KIND_CUSTOMER if rec.get("isCartaCustomer") else ENTITY_KIND_PAPER
    return ENTITY_KIND_GL


def metric_key(mnemonic, name):
    """Stable key for a metric: its mnemonic when present, else a slug of the
    reported name. Keeps EVERY metric a company reports (no allow-list)."""
    mn = (mnemonic or "").strip().upper()
    if mn:
        return mn
    return "M_" + slugify(name).replace("-", "_").upper()


def metric_label(name, key):
    """Human label: the reported name if any, else a de-prefixed mnemonic."""
    if name and name.strip():
        return name.strip()
    lbl = re.sub(r"^(FS|M)_", "", key).replace("_", " ").title()
    return lbl or key


# Metrics that live on a FLOW statement but are really point-in-time BALANCES,
# so they must never be summed across months (period-end cash is the classic
# case: it's a closing balance reported inside the cash-flow statement).
_BALANCE_IN_FLOW = re.compile(
    r"(PERIOD_END_CASH|ENDING_CASH|CASH_AT_END|BEGINNING_CASH|CASH_AT_BEGIN)", re.I)
_BALANCE_NAME = re.compile(r"\b(period[- ]end|ending|beginning|closing|opening)\b.*\bcash\b"
                           r"|\bcash\b.*\b(at (the )?(end|beginning)|balance)\b", re.I)

# REPORT_TYPE values that represent activity OVER a period (flows) rather than a
# balance AT a point in time. Only these are summed when rolling months → quarter.
FLOW_REPORT_TYPES = {"profit and loss", "cash flow", "income statement",
                     "profit & loss", "p&l", "cashflow"}


def agg_mode(mnemonic, name, report_type):
    """How to roll this metric up from months to a quarter.

    "sum"  — activity over the period (P&L + cash-flow flows): add the months.
    "last" — a balance/level at a point in time (balance sheet, headcount,
             runway, period-end cash): take the last value in the quarter.

    Unclassified KPI rows default to "last": summing a level (headcount, runway)
    would invent a number that never existed, so point-in-time is the safe default.
    """
    rt = (report_type or "").strip().lower()
    if rt not in FLOW_REPORT_TYPES:
        return "last"
    # on a flow statement, but a closing/opening balance → still point-in-time
    if _BALANCE_IN_FLOW.search((mnemonic or "")) or _BALANCE_NAME.search((name or "")):
        return "last"
    return "sum"


def norm_freq(f):
    """Normalize a source FREQUENCY code to one letter: Q, M, A(nnual), S(emi).
    Unknown or blank returns None."""
    f = (f or "").strip().upper()
    if f.startswith("Q"):
        return "Q"
    if f.startswith("M"):
        return "M"
    if f.startswith("A") or f.startswith("Y"):
        return "A"
    if f.startswith("S"):
        return "S"
    return f or None


def series_point(period, val, cur, disp, qtr):
    # `q` is the quarterly figure for the quarter ending on `d`; it rides with the
    # monthly `v` so the app shows the quarter without re-summing the months.
    pt = {"d": period, "v": val, "cur": cur}
    if disp is not None:
        pt["s"] = disp
    if qtr is not None:
        pt["q"] = qtr
    return pt


# ---------- build ----------
def refuse_incomplete_stems(raw):
    """A stem left mid-page carries a .truncated or .integrity_error marker; building on
    it would silently drop rows, so stop and name the stem to re-fetch."""
    raw = Path(raw)
    bad = sorted(p.name for suffix in ("*.ndjson.truncated", "*.ndjson.integrity_error") for p in raw.glob(suffix))
    if bad:
        raise SystemExit("ERROR: incomplete stem(s) in %s: %s — re-fetch them before building."
                         % (raw, ", ".join(bad)))


def build(raw, out, meta, as_of_max=None):
    refuse_incomplete_stems(raw)
    raw, out = Path(raw), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    # Drop submissions stamped in the future; they must not win "latest submission".
    # Injectable for deterministic tests; defaults to today.
    as_of_max = as_of_max or _dt.date.today().isoformat()

    firm_name = meta.get("name") or "Firm"
    slug = meta.get("slug") or slugify(firm_name)

    # fund_uuid -> fund display name (for the fund slice dimension)
    fund_name_of = {}
    for r in read_ndjson(raw / "funds.ndjson"):
        u = col(r, "fund_uuid")
        nm = col(r, "fund_name", "name")
        if u and nm:
            fund_name_of[u] = nm

    # Company identity (see company_key above). key_type remembers how each company id
    # was reached so the emit step knows whether an identity record exists for it.
    ident = load_identity(raw)
    key_type = {}          # company id -> keyType, first seen wins
    issuer_cid = {}        # norm_co(holdings issuer_name) -> company id, for TEMPORAL_DEAL_IRR

    def ckey(row, name=None):
        """Company id for a stem row, or None when it carries nothing usable."""
        ck = company_key(row, ident, name)
        if ck is None:
            return None
        cid, ktype = ck
        key_type.setdefault(cid, ktype)
        return cid

    # company id -> set of fund names, from the holdings stem's issuer_name +
    # fund_uuid pair. Without it the Dashboard's fund filter hides itself (WARN below).
    comp_funds = {}
    for r in read_ndjson(raw / "holdings.ndjson"):
        issuer = col(r, "issuer_name", "issuer")
        u = col(r, "fund_uuid")
        if not issuer:
            continue
        fn = fund_name_of.get(u) or (u if u else None)
        cid = ckey(r, issuer)
        if fn and cid:
            comp_funds.setdefault(cid, set()).add(fn)

    # ---- financials: discover metrics + build per-company time series ----
    # metrics_meta[key] = {"key","label","unit"}  (first spelling wins for label)
    metrics_meta = {}
    metric_order = []
    # series[company id][key][period] = (value, currency, display, freq)  (one pt / period)
    # display is set only for a qualitative KPI; value is None for free text.
    series = {}
    # Raw financial rows staged for cadence-aware collapse (see collapse loop below):
    # fin_acc[company id][key][period_end][freq] = [(as_of_str, value, currency, display), ...]
    fin_acc = {}
    display_name = {}          # company id -> a real display name (first seen)
    fin_currency = None
    last_responded = {}  # company id -> max as_of_date ("YYYY-MM-DD"), bounded by as_of_max

    def add_months_to(nm_norm, key, period, target):
        """Numeric companion for a date KPI, so rules and charts can read it."""
        ck = key + MONTHS_TO_SUFFIX
        if ck not in metrics_meta:
            metrics_meta[ck] = {"key": ck, "label": "Months to " + metrics_meta[key]["label"],
                                "unit": "Number", "reportType": metrics_meta[key].get("reportType"),
                                "agg": "last", "derivedFrom": key}
            metric_order.append(ck)
        gap = months_between(period, target)
        if gap is not None:
            series.setdefault(nm_norm, {}).setdefault(ck, {})[str(period)] = (gap, None, None, None)

    for r in read_ndjson(raw / "financials.ndjson"):
        legal = col(r, "legal_name", "company", "name_legal")
        nm_norm = ckey(r, legal)
        period = col(r, "period_end", "as_of_date", "period")
        if not nm_norm or not period:
            continue
        unit = col(r, "unit_type", "unit") or "Number"
        val = numn(col(r, "float_value", "value"))
        disp = kind = qdate = None
        # A qualitative KPI reports into string_value instead. A row carrying both
        # keeps the float — the numeric reading is the richer one.
        if val is None:
            val, disp, kind, qdate = parse_qual(unit, col(r, "string_value", "text_value"))
        if val is None and disp is None:
            continue
        mnemonic = col(r, "mnemonic")
        reported = col(r, "name", "metric_name")
        key = metric_key(mnemonic, reported)
        if key not in metrics_meta:
            rtype = col(r, "report_type") or None
            # Never sum a flag, a date or prose, whatever statement it arrived on.
            metrics_meta[key] = {"key": key, "label": metric_label(reported, key), "unit": unit,
                                 "reportType": rtype,
                                 "agg": "last" if kind else agg_mode(mnemonic, reported, rtype)}
            if kind:
                metrics_meta[key]["kind"] = kind
            metric_order.append(key)
        elif kind and "kind" not in metrics_meta[key]:
            # First row for this metric was numeric; a later one reveals its type.
            metrics_meta[key]["kind"] = kind
            metrics_meta[key]["agg"] = "last"
        cur = col(r, "currency") or None
        if cur and fin_currency is None and metrics_meta[key]["unit"] == "Dollar":
            fin_currency = cur
        display_name.setdefault(nm_norm, legal)
        v4 = round(val, 4) if val is not None else None
        freq = norm_freq(col(r, "frequency"))
        asof = str(col(r, "as_of_date") or "")
        asof_day = asof[:10]
        if asof_day and asof_day <= as_of_max:
            prev = last_responded.get(nm_norm)
            if prev is None or asof_day > prev:
                last_responded[nm_norm] = asof_day
        (fin_acc.setdefault(nm_norm, {}).setdefault(key, {})
                .setdefault(str(period), {}).setdefault(freq, [])
                .append((asof, v4, cur, disp)))
        if qdate is not None:
            add_months_to(nm_norm, key, period, qdate)

    # One point per (company, metric, period-end). `v` keeps the finest cadence so
    # every month survives; `q` carries the quarterly figure for the roll-up.
    for nm, by_key in fin_acc.items():
        for key, by_period in by_key.items():
            for pe, by_freq in by_period.items():
                best = {}
                for fr, rows in by_freq.items():
                    live = [x for x in rows if x[0][:10] <= as_of_max] or rows
                    best[fr] = max(live, key=lambda x: x[0])
                qval = best["Q"][1] if "Q" in best else None
                fr = "M" if "M" in best else ("Q" if "Q" in best else next(iter(best)))
                _asof, v4, cur, disp = best[fr]
                series.setdefault(nm, {}).setdefault(key, {})[pe] = (v4, cur, disp, qval)

    # ---- forecasts (instance_type='Estimate'): keep EVERY vintage ----
    # A forecast is rewritten over time, so each (company, metric, target period)
    # can have several rows stamped with different as_of_date (the vintage). We
    # keep them all to (a) take the LATEST-logged estimate per period and (b) show
    # how a forecast changed across vintages.
    # fc_raw[company id][key][period_end] = { as_of(str) : (value, currency) }
    fc_raw = {}
    fc_asof_dates = set()
    for r in read_ndjson(raw / "forecasts.ndjson"):
        legal = col(r, "legal_name", "company")
        nm_norm = ckey(r, legal)
        # Numeric only, unlike the actuals loop: vintage curves, forecast error and
        # the accuracy backtest are all arithmetic a flag or a date cannot support.
        val = numn(col(r, "float_value", "value"))
        period = str(col(r, "period_end", "period"))
        asof = str(col(r, "as_of_date", "as_of"))[:10]  # date-only vintage stamp
        if not nm_norm or val is None or not period or not asof:
            continue
        key = metric_key(col(r, "mnemonic"), col(r, "name", "metric_name"))
        if key not in metrics_meta:  # forecast-only metrics still register
            unit = col(r, "unit_type", "unit") or "Number"
            rtype = col(r, "report_type") or None
            metrics_meta[key] = {"key": key, "label": metric_label(col(r, "name"), key), "unit": unit,
                                 "reportType": rtype, "agg": agg_mode(col(r, "mnemonic"), col(r, "name"), rtype)}
            metric_order.append(key)
        cur = col(r, "currency") or None
        display_name.setdefault(nm_norm, legal)
        fc_asof_dates.add(asof)
        fc_raw.setdefault(nm_norm, {}).setdefault(key, {}).setdefault(period, {})[asof] = (round(val, 4), cur)

    def build_forecast(by_key):
        """-> (latest_per_period, vintages) for one company's forecast metrics.
        latest[key]   = [{d, v, asOf}]  — newest vintage's value per target period.
        vintages[key] = [{asOf, points:[{d,v}]}] — each vintage's full curve, asc."""
        latest, vintages = {}, {}
        for key, by_period in by_key.items():
            lp = []
            per_asof = {}  # asOf -> [(period, value)]
            for period, by_asof in by_period.items():
                newest = max(by_asof)                       # latest logged vintage
                v = by_asof[newest][0]
                lp.append((period, v, newest))
                for asof, (av, _c) in by_asof.items():
                    per_asof.setdefault(asof, []).append((period, av))
            lp.sort()
            latest[key] = [{"d": p, "v": v, "asOf": a} for p, v, a in lp]
            vint = []
            for asof in sorted(per_asof):
                pts = sorted(per_asof[asof])
                vint.append({"asOf": asof, "points": [{"d": p, "v": v} for p, v in pts]})
            vintages[key] = vint
        return latest, vintages

    # ---- valuation inputs: latest PPS (fund holdings) + fully-diluted shares (cap table) ----
    # Implied company valuation = latest price-per-share × fully-diluted share count.
    # PPS: AGGREGATE_INVESTMENTS.remaining_value_per_share on the fund's most recently
    # marked EQUITY position (warrants/options excluded — their "per share" is not a
    # company PPS). FD shares: SUMMARY_CAP_TABLE total when present (matches the Cap
    # table card), falling back to FUND_CORPORATION_OWNERSHIP.fully_diluted.
    pps_by = {}   # company id -> {pps, asOf, security, rv}
    ret_by = {}   # company id -> {cost, fmv, proceeds, unrealized, firstDate}
    tags_by = {}  # company id -> {category -> set(values)}
    soi_by = {}   # company id -> [per-asset Schedule-of-Investments lines]
    closed_soi = {}  # company id -> count of fully-closed positions omitted
    cost_by_fund = {}  # (company id, fund_uuid) -> cost basis, to rank co-investing funds
    for r in read_ndjson(raw / "holdings.ndjson"):
        issuer = col(r, "issuer_name", "issuer")
        nm = ckey(r, issuer)
        if not nm:
            continue
        key = norm_co(issuer)
        if key and nm:
            issuer_cid.setdefault(key, nm)
        display_name.setdefault(nm, col(r, "issuer_name", "issuer"))
        # Tags come off EVERY holding row, before the closed-position skip below —
        # a company whose only positions have converted still carries its tags. The
        # same company held by several funds can be tagged differently in each, so
        # union rather than first-wins.
        for _cat, _vals in parse_tags(col(r, "tags_json")).items():
            tags_by.setdefault(nm, {}).setdefault(_cat, set()).update(_vals)
        # Keep the per-ASSET line as well as the company-level rollup below. These
        # rows ARE the schedule of investments — one per fund per security held —
        # and the Cap table tab shows them verbatim. Aggregating them away (which is
        # all this loop used to do) threw away the only holdings detail we have.
        _sh = numn(col(r, "count_remaining_shares", "shares"))
        _cost = numn(col(r, "total_cost"))
        _val = numn(col(r, "remaining_value"))
        _proc = numn(col(r, "total_proceeds"))
        if not (_sh or _cost or _val or _proc):
            # Zero shares, cost, value AND proceeds — a closed position, almost
            # always a SAFE or note that has already converted into the preferred
            # line sitting next to it. Carta's Holdings tab lists these, so the row
            # COUNT is tracked and disclosed; the row itself carries no number worth
            # showing and would just be a line of dashes.
            closed_soi[nm] = closed_soi.get(nm, 0) + 1
            continue
        if True:
            soi_by.setdefault(nm, []).append({
                "fund": fund_name_of.get(col(r, "fund_uuid")) or None,
                "asset": col(r, "asset_name") or None,
                "assetClass": col(r, "asset_class_type") or None,
                "shares": _sh,
                "cost": _cost,
                "value": _val,
                "pps": numn(col(r, "remaining_value_per_share", "value_per_share")),
                "unrealized": numn(col(r, "total_unrealized_gain_loss")),
                "proceeds": numn(col(r, "total_proceeds")),
                "investmentDate": (str(col(r, "investment_date"))[:10] or None),
                "fmvDate": (str(col(r, "latest_fmv_effective_date", "fmv_date"))[:10] or None),
                "isWarrant": str(col(r, "is_option_or_warrant_asset")).lower() in ("true", "1"),
            })
        # returns accumulation across ALL positions the fund holds in this company
        # Fields start as None (no data). Only a real reported number moves them off
        # None — so a company with NO cost/value/etc. data stays null, not a fake $0.
        agg = ret_by.setdefault(nm, {"cost": None, "fmv": None, "proceeds": None, "unrealized": None, "firstDate": None})
        for _fld, _src in (("cost", "total_cost"), ("fmv", "remaining_value"), ("proceeds", "total_proceeds"), ("unrealized", "total_unrealized_gain_loss")):
            _v = numn(col(r, _src))
            if _v is not None:
                agg[_fld] = (agg[_fld] or 0.0) + _v
        idt = str(col(r, "investment_date"))[:10]
        if idt and idt != "None" and (agg["firstDate"] is None or idt < agg["firstDate"]):
            agg["firstDate"] = idt
        # Per-fund cost, kept alongside the firm-level sum: when several funds hold
        # one company they each report their own deal IRR, and cost is how the
        # dominant position is identified below.
        _fu = col(r, "fund_uuid")
        _fc = numn(col(r, "total_cost"))
        if _fu and _fc is not None:
            cost_by_fund[(nm, _fu)] = cost_by_fund.get((nm, _fu), 0.0) + _fc
        # PPS selection — most-recently-marked EQUITY position (warrants/options excluded)
        pps = numn(col(r, "remaining_value_per_share", "value_per_share"))
        sh = numn(col(r, "count_remaining_shares", "shares"))
        warr = str(col(r, "is_option_or_warrant_asset")).lower() in ("true", "1")
        if pps is None or pps <= 0 or not sh or warr:
            continue
        dt = str(col(r, "latest_fmv_effective_date", "fmv_date"))[:10]
        rv = numn(col(r, "remaining_value")) or 0.0
        cur = pps_by.get(nm)
        if cur is None or dt > cur["asOf"] or (dt == cur["asOf"] and rv > cur["rv"]):
            pps_by[nm] = {"pps": round(pps, 6), "asOf": dt, "security": col(r, "asset_name") or None, "rv": rv}

    # ---- SOI performance history: value-per-share / FMV / cost over time ----
    # long-comment-ok: the SCD interval semantics are the whole point of this block.
    # AGGREGATE_INVESTMENTS_HISTORY (queries.md §5) powers the Company 360 "SOI
    # performance" chart. It is an event-driven SCD: each row is one position lot
    # valid over [effective_date, next_effective_date) (null next = still current),
    # and a given effective_date carries ONLY the lots that changed that day — not
    # the whole portfolio. So the total on date D is the sum over every lot whose
    # interval covers D (an as-of carry-forward), NOT the sum of rows stamped D.
    soi_hist_rows = {}   # company id -> [{eff, nxt, warr, cost, val, pps}]
    for r in read_ndjson(raw / "holdings_history.ndjson"):
        nm = ckey(r, col(r, "issuer_name", "issuer"))
        if not nm:
            continue
        eff = str(col(r, "effective_date", "as_of_date", "snapshot_date",
                      "performance_quarter_end_date", "period_end"))[:10]
        if not eff or eff == "None" or not _parse_date(eff):
            continue
        display_name.setdefault(nm, col(r, "issuer_name", "issuer"))
        nxt = str(col(r, "next_effective_date"))[:10]
        if not nxt or nxt == "None" or not _parse_date(nxt):
            nxt = None   # open interval — this lot is current
        soi_hist_rows.setdefault(nm, []).append({
            "eff": eff, "nxt": nxt,
            "warr": str(col(r, "is_option_or_warrant_asset")).lower() in ("true", "1"),
            "cost": numn(col(r, "total_cost")),
            "val": numn(col(r, "remaining_value")),
            "pps": numn(col(r, "remaining_value_per_share", "value_per_share")),
            # Cumulative proceeds on the lot as of the snapshot. Powers the chart's
            # total-value line (held FMV + returned cash), so an exit reads as a gain.
            "proceeds": numn(col(r, "total_proceeds")),
        })
    # Reconstruct as-of totals at every change date. ISO dates compare as strings.
    soi_hist_by = {}   # company id -> [{d, pps, fmv, cost}]
    for nm, rows in soi_hist_rows.items():
        pts = []
        for d in sorted({r["eff"] for r in rows}):
            fmv = cost = proceeds = None
            best_rv, pps = -1.0, None   # PPS = largest live EQUITY lot; not summable
            for r in rows:
                if r["eff"] <= d and (r["nxt"] is None or r["nxt"] > d):
                    if r["val"] is not None:
                        fmv = (fmv or 0.0) + r["val"]
                    if r["cost"] is not None:
                        cost = (cost or 0.0) + r["cost"]
                    if r["proceeds"] is not None:
                        proceeds = (proceeds or 0.0) + r["proceeds"]
                    if not r["warr"] and r["pps"] is not None and r["pps"] > 0:
                        rv = r["val"] if r["val"] is not None else 0.0
                        if rv > best_rv:
                            best_rv, pps = rv, round(r["pps"], 6)
            pts.append({"d": d, "pps": pps,
                        "fmv": None if fmv is None else round(fmv, 2),
                        "cost": None if cost is None else round(cost, 2),
                        "proceeds": None if proceeds is None else round(proceeds, 2)})
        if pts:
            soi_hist_by[nm] = pts

    # fdshares now arrives one row per (company, FUND). fd_by holds the per-company
    # roll-up (firm-wide summed ownership + last round); fd_rows keeps the per-fund
    # breakdown that feeds the "ownership by fund" disclosure.
    fd_by = {}    # company id -> {fdShares, asOf, round, postMoney, roundDate, ownPct, ownQty}
    fd_rows = {}  # company id -> [{fundId, pct, asOf}, ...]  (one per fund with a real stake)
    for r in read_ndjson(raw / "fdshares.ndjson"):
        nm = ckey(r, col(r, "name", "investment_name", "company"))
        fd = numn(col(r, "fd_shares", "fully_diluted"))
        if not nm or not fd or fd <= 0:
            continue
        display_name.setdefault(nm, col(r, "name", "investment_name"))
        # A single fund's ownership % — a 0-1 FRACTION, straight from Carta's
        # PERCENTAGE column. Zero means the cap table has no position linked to that
        # fund, not a real 0% stake, so it stays null. Older extracts predate these
        # columns; missing -> null, not 0.
        own = numn(col(r, "own_pct", "ownership_percentage", "percentage"))
        if own is not None and own <= 0:
            own = None
        # >100% for ONE fund is impossible — a stale snapshot whose FD denominator
        # disagrees with its share count. Drop it, don't feed the sum or breakdown.
        if own is not None and own > 1.0:
            own = None
        qty = numn(col(r, "own_qty", "ownership_quantity"))
        if qty is not None and qty <= 0:
            qty = None
        as_of = str(col(r, "as_of", "as_of_date"))[:10]
        rec = fd_by.get(nm)
        if rec is None:
            rec = {"fdShares": fd, "asOf": as_of,
                   "round": col(r, "round") or None,
                   "postMoney": numn(col(r, "post_money", "post_money_valuation")),
                   "roundDate": (str(col(r, "round_date"))[:10] or None),
                   "ownPct": None, "ownQty": None}
            fd_by[nm] = rec
        # FD shares / as-of come from the freshest fund snapshot for the company.
        if as_of and (not rec["asOf"] or as_of > rec["asOf"]):
            rec["asOf"], rec["fdShares"] = as_of, fd
        # Firm-wide figures are the sum across the funds that hold this company.
        if own is not None:
            rec["ownPct"] = (rec["ownPct"] or 0.0) + own
            fd_rows.setdefault(nm, []).append(
                {"fundId": col(r, "fund_id") or "", "pct": own, "asOf": as_of or None})
        if qty is not None:
            rec["ownQty"] = (rec["ownQty"] or 0.0) + qty
    # The summed figure assumes every fund's row shares the same FD denominator;
    # when a stale snapshot disagrees the sum can exceed 100%, which is not an
    # ownership figure. Blank the roll-up (the per-fund rows stay trustworthy).
    for rec in fd_by.values():
        if rec["ownPct"] is not None and rec["ownPct"] > 1.0:
            rec["ownPct"] = None

    # ---- cap table: one row per security class, already deduped to the latest
    # row per (corporation, security class) by the query. See references/queries.md
    # §4 for why that partition matters (as_of_date is a per-ROW stamp; partitioning
    # by corporation alone drops most of the cap table).
    # Keyed by (company, CORPORATION_ID). `nm` is ckey(): a UUID resolved through the
    # directory to its entity link, else corp:<uuid> or name:; a rare collision is handled below.
    cap_raw = {}  # (company id, corporation_id) -> {asOf, classes: [...]}
    for r in read_ndjson(raw / "capstack.ndjson"):
        # corp_name is the AUTHORITATIVE corporation name; the cap table's own
        # legal_name goes stale after a rename ("Initech Technologies Inc" for a
        # company now called Umbrella Nano), which silently attaches the real cap table
        # to the wrong company. See references/queries.md §4.
        nm = ckey(r, col(r, "corp_name", "legal_name", "name"))
        if not nm:
            continue
        display_name.setdefault(nm, col(r, "corp_name", "legal_name", "name"))
        cls_name = col(r, "security_class_name")
        if not cls_name:
            continue
        as_of = str(col(r, "as_of_date"))[:10] or None
        ent = cap_raw.setdefault((nm, col(r, "corporation_id")), {"asOf": as_of, "classes": []})
        if as_of and (ent["asOf"] is None or as_of > ent["asOf"]):
            ent["asOf"] = as_of
        _b = str(col(r, "participating_preferred")).lower()
        ent["classes"].append({
            "id": col(r, "security_class_id") or cls_name,
            "name": cls_name,
            "type": col(r, "security_class_type") or None,
            "kind": col(r, "security_class_type_detailed") or None,
            "asConverted": col(r, "as_converted_shareclass_name") or None,
            "outstanding": numn(col(r, "outstanding_shares")),
            "fd": numn(col(r, "fully_diluted_quantity")),
            "authorized": numn(col(r, "authorized_shares")),
            "fdPct": numn(col(r, "fully_diluted_ownership")),
            "planSize": numn(col(r, "plan_size")),
            "available": numn(col(r, "shares_available_under_plan")),
            "wtdExercise": numn(col(r, "weighted_average_exercise_price")),
            "oip": numn(col(r, "original_issue_price")),
            "conversionRatio": numn(col(r, "conversion_ratio")),
            "conversionPrice": numn(col(r, "conversion_price")),
            "seniority": numn(col(r, "seniority")),
            "multiplier": numn(col(r, "multiplier")),
            # tri-state on purpose: None = not recorded, which is NOT the same as
            # "non-participating" and must not render as a confident "No".
            "participating": True if _b in ("true", "1") else (False if _b in ("false", "0") else None),
            "preferenceCap": numn(col(r, "preference_cap")),
            "dividendCoupon": numn(col(r, "dividend_coupon")),
            "dividendType": col(r, "dividend_type") or None,
            "dividendAccrual": col(r, "dividend_accrual") or None,
            "compounding": str(col(r, "is_compounding")).lower() in ("true", "1"),
            "cashRaised": numn(col(r, "cash_raised_usd", "cash_raised")),
            "principal": numn(col(r, "principal_usd", "principal")),
            "interest": numn(col(r, "interest_usd", "interest")),
            "firstIssue": (str(col(r, "earliest_issue_date"))[:10] or None),
        })

    # deal IRR per company (latest), sanitized like fund-modeling.
    # TEMPORAL_DEAL_IRR reports one IRR per (issuer, FUND, quarter). Co-invested
    # companies therefore carry several, and they diverge widely. IRR is not
    # additive and this table has no cashflows, so pooling them is not possible.
    # Take the largest cost basis and record the spread for the UI to disclose.
    irr_by_fund = {}   # company id -> {fund_uuid: irr}
    for r in read_ndjson(raw / "deal_irr.ndjson"):
        issuer = col(r, "issuer_name", "issuer")
        # TEMPORAL_DEAL_IRR has no identity columns; its issuer_name is the same Fund
        # Admin string the holdings row carries, so look the company up through that.
        nm = issuer_cid.get(norm_co(issuer)) or ckey(r, issuer)
        v = numn(col(r, "deal_irr"))
        if not nm or v is None:
            continue
        if v == 0.0:
            v = None
        elif v <= -0.999:
            v = -1.0
        elif v > 5:
            v = None
        if v is not None:
            irr_by_fund.setdefault(nm, {})[col(r, "fund_uuid") or ""] = v

    irr_by, irr_scope = {}, {}
    for nm, by_fund in irr_by_fund.items():
        fu, v = max(by_fund.items(), key=lambda kv: (cost_by_fund.get((nm, kv[0]), 0.0), kv[0]))
        irr_by[nm] = v
        if len(by_fund) > 1:
            vals = sorted(by_fund.values())
            irr_scope[nm] = {"funds": len(by_fund), "fund": fund_name_of.get(fu),
                             "min": vals[0], "max": vals[-1]}

    # fdshares is keyed by corporation_id and can carry a fund stake that the
    # position-level holdings stem has no row for. Union it in.
    for nm, rows in fd_rows.items():
        for row in rows:
            fn = fund_name_of.get(row.get("fundId")) or row.get("fundId")
            if fn:
                comp_funds.setdefault(nm, set()).add(fn)
    # Checked here, after both sources have folded in, so a company whose only
    # fund linkage is an fdshares-only stake doesn't trip a false WARN.
    if fund_name_of and not comp_funds:
        print("WARN: %d fund(s) in the directory but no company maps to any of them — "
              "the fund filter will be missing. Check that holdings.ndjson or "
              "fdshares.ndjson carries issuer_name/fund_uuid or fund_id."
              % len(fund_name_of), file=sys.stderr)

    # One cap table per company: most complete wins (most classes, then most recent).
    # Two rows reach one company only via a shared identity/name key or a real-table-plus-stub pair; either way the fuller table wins.
    _cap_groups = {}
    for (nm, _cid), ent in cap_raw.items():
        _cap_groups.setdefault(nm, []).append((_cid, ent))
    cap_by = {}
    _dupes = []
    for nm, lst in _cap_groups.items():
        if len(lst) > 1:
            _dupes.append(display_name.get(nm, nm))
        _cid, ent = max(lst, key=lambda t: (len(t[1]["classes"]), t[1]["asOf"] or ""))
        cap_by[nm] = ent
    if _dupes:
        print("NOTE: %d company/companies carry more than one Carta cap table; kept the most "
              "complete one each: %s" % (len(set(_dupes)), ", ".join(sorted(set(_dupes)))), file=sys.stderr)

    def _captable_fd(nm):
        # Company-total FD from the cap table (Σ fully_diluted_quantity) — the card's own
        # source. The ownership stem's FD is per-fund, so a lagging fund goes stale.
        ent = cap_by.get(nm)
        if not ent:
            return None
        tot, seen = 0.0, False
        for c in ent["classes"]:
            v = c.get("fd")
            if v is not None:
                tot += v
                seen = True
        if not seen or tot <= 0:
            return None
        return tot, ent.get("asOf")

    val_norms = {n for n in pps_by if n in fd_by}
    ret_norms = {n for n, a in ret_by.items() if a["cost"] is not None and a["cost"] > 0}

    # assemble companies (union of firms with actuals, forecasts, and/or a valuation)
    def canonical_name(n):
        # The name a company is emitted under. Sort and emit by the same name,
        # or the list order and the names shown disagree.
        rec = ident["by_entity_link"].get(n) if key_type.get(n) == "entity_link" else None
        return (rec["name"] if rec and rec["name"] else None) or display_name.get(n, n)

    companies = []
    all_periods = set()
    for nm_norm in sorted(set(series) | set(fc_raw) | val_norms | ret_norms, key=lambda n: canonical_name(n).lower()):
        rec = ident["by_entity_link"].get(nm_norm) if key_type.get(nm_norm) == "entity_link" else None
        name = canonical_name(nm_norm)
        rec_series = {}
        for key, pts in series.get(nm_norm, {}).items():
            ordered = sorted(pts.items())  # by period ascending
            all_periods.update(p for p, _ in ordered)
            rec_series[key] = [series_point(p, v, c, s, f) for p, (v, c, s, f) in ordered]
        entry = {
            "id": nm_norm,
            "keyType": key_type.get(nm_norm),
            "name": name,
            "entityKind": entity_kind(rec),
            "cartaCorporationId": rec["corporationId"] if rec else None,
            "cartaCorporationUuid": rec["corporationUuid"] if rec else None,
            "cartaEntityLinkId": nm_norm if key_type.get(nm_norm) == "entity_link" else None,
            "funds": sorted(comp_funds.get(nm_norm, [])),
            "series": rec_series,
        }
        entry["lastResponded"] = last_responded.get(nm_norm)
        # Carta investment tags, every category the firm uses. Flat and sorted so the
        # app can group them without re-deriving an order.
        co_tags = tags_by.get(nm_norm) or {}
        if co_tags:
            entry["tags"] = [{"cat": c, "value": v}
                             for c in sorted(co_tags) for v in sorted(co_tags[c])]
        if nm_norm in fc_raw:
            latest, vintages = build_forecast(fc_raw[nm_norm])
            entry["forecast"] = latest
            entry["forecastVintages"] = vintages
        if nm_norm in val_norms:
            p, f = pps_by[nm_norm], fd_by[nm_norm]
            cap_fd = _captable_fd(nm_norm)
            fd_shares, fd_as_of, fd_source = (
                (cap_fd[0], cap_fd[1], "capTable") if cap_fd
                else (f["fdShares"], f["asOf"], "ownership"))
            entry["valuation"] = {
                "pps": p["pps"], "ppsAsOf": p["asOf"], "ppsSecurity": p["security"],
                "fdShares": fd_shares, "fdAsOf": fd_as_of, "fdSource": fd_source,
                "impliedValuation": round(p["pps"] * fd_shares, 2),
            }
        # investment returns (gross): cost basis, current value, MOIC, sector, entry date
        a = ret_by.get(nm_norm)
        if a and a["cost"] is not None and a["cost"] > 0:
            # current value = fmv + proceeds; null only when BOTH are absent
            cur = None if (a["fmv"] is None and a["proceeds"] is None) else (a["fmv"] or 0.0) + (a["proceeds"] or 0.0)
            moic = None if cur is None else cur / a["cost"]
            entry["returns"] = {
                "cost": round(a["cost"], 2),
                "fmv": None if a["fmv"] is None else round(a["fmv"], 2),
                "proceeds": None if a["proceeds"] is None else round(a["proceeds"], 2),
                "unrealized": None if a["unrealized"] is None else round(a["unrealized"], 2),
                "moic": None if moic is None else round(moic, 3),
                "firstDate": a["firstDate"],
                # Kept for the Company 360 header and any cache built before tags
                # existed. Derived from the tag blob, not parsed a second time.
                "sector": _first_tag(co_tags, "Industry"),
                "country": _first_tag(co_tags, "Country"),
            }
        # last financing round (from cap-table / financing history)
        f = fd_by.get(nm_norm)
        if f and (f.get("round") or f.get("postMoney")):
            entry["lastRound"] = {"round": f.get("round"), "postMoney": f.get("postMoney"), "date": f.get("roundDate")}
        # fully-diluted ownership — the one position metric a non-fund-admin firm can
        # still have, since it needs only the cap table, not holdings or marks.
        if f and f.get("ownPct") is not None:
            entry["ownership"] = {"pct": round(f["ownPct"], 6), "asOf": f.get("asOf"),
                                  "quantity": f.get("ownQty"), "fdShares": f.get("fdShares")}
            # Per-fund breakdown for the ownership dropdown, largest stake first.
            rows = fd_rows.get(nm_norm)
            if rows:
                entry["ownership"]["byFund"] = sorted(
                    ({"fund": fund_name_of.get(x["fundId"]) or (x["fundId"] or "Unknown fund"),
                      "pct": round(x["pct"], 6), "asOf": x["asOf"]} for x in rows),
                    key=lambda d: d["pct"], reverse=True)
        if nm_norm in irr_by:
            entry["dealIrr"] = irr_by[nm_norm]
            if nm_norm in irr_scope:
                entry["dealIrrScope"] = irr_scope[nm_norm]
        # cap table + schedule-of-investments detail (Cap table tab)
        if nm_norm in cap_by and cap_by[nm_norm]["classes"]:
            entry["capTable"] = cap_by[nm_norm]
        if nm_norm in soi_by:
            entry["soi"] = soi_by[nm_norm]
        if closed_soi.get(nm_norm):
            entry["soiClosed"] = closed_soi[nm_norm]
        # SOI performance history (value-per-share / FMV / cost over time). Needs
        # at least two points to draw a line, so a single-snapshot company is skipped.
        if len(soi_hist_by.get(nm_norm, [])) >= 2:
            entry["soiHistory"] = soi_hist_by[nm_norm]
        companies.append(entry)

    _unplaced = sum(1 for c in companies if c["entityKind"] is None)
    if _unplaced:
        print("NOTE: %d of %d companies have no entity_identity row (typed fallback id, or an "
              "entity link the directory lacks); their entityKind is null."
              % (_unplaced, len(companies)), file=sys.stderr)

    metrics = [metrics_meta[k] for k in metric_order]
    fund_dim = sorted({f for c in companies for f in c["funds"]})
    _tag_vals = {}
    for c in companies:
        for t in c.get("tags") or []:
            _tag_vals.setdefault(t["cat"], set()).add(t["value"])
    tag_dim = [{"cat": c, "values": sorted(_tag_vals[c])} for c in sorted(_tag_vals)]

    currency = meta.get("currency") or fin_currency or "USD"
    # "As of" must be the latest period that has actually HAPPENED. Some companies
    # file forward-looking plan figures under instance_type='Actual' (one real firm
    # had 126 such rows, running to 2030), and taking a naive max() made the app
    # announce "Data as of 03-31-2030". Those rows are kept — they're genuine
    # submissions — but they can't define the data date.
    _today = _dt.date.today().isoformat()
    _past = [p for p in all_periods if p <= _today]
    as_of = meta.get("navAsOf") or (max(_past) if _past else (max(all_periods) if all_periods else None))

    kpi = {
        "source": {
            "firm": firm_name,
            "slug": slug,
            "asOf": as_of,
            "currency": currency,
            "firmId": meta.get("firmId"),
            "firmUuid": meta.get("firmUuid"),
            # "production" or "nonprod" — which Carta MCP env this build's data came
            # from. Served to the browser so the tracker picks the right Snowplow
            # collector. No value defaults to "production": a customer-facing plugin's
            # unclassified build is far more likely real prod than a staff test.
            "cartaEnvironment": meta.get("cartaEnvironment") or "production",
            "provider": "carta-fund-admin",
            # History window actually fetched. None = everything Carta held.
            # Recorded so the app can say so, and so views that depend on knowing a
            # company's FIRST-EVER report (Review's "started reporting") can hold
            # their tongue rather than mistake the window edge for a new reporter.
            "since": meta.get("since"),
            # When this build ran, and per-dataset freshness from the raw stem mtimes —
            # the freshness panel reads both. See scripts/datasets.py.
            "builtAt": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "datasets": _dataset_freshness(raw),
        },
        "metrics": metrics,
        "companies": companies,
        "hasQualitative": any(m.get("kind") for m in metrics),
        "hasForecast": bool(fc_raw),
        "hasValuation": bool(val_norms),
        "hasReturns": any(c.get("returns") for c in companies),
        "hasOwnership": any(c.get("ownership") for c in companies),
        "hasTags": any(c.get("tags") for c in companies),
        "hasCapTable": any(c.get("capTable") for c in companies),
        "hasSoi": any(c.get("soi") for c in companies),
        "hasSoiHistory": any(c.get("soiHistory") for c in companies),
        "forecastAsOfDates": sorted(fc_asof_dates),
        "dimensions": {
            "funds": fund_dim,
            # Tag menu: only categories/values companies actually carry, so the
            # filter never offers a choice that matches nothing.
            "tags": tag_dim,
            # Period GRID for the pivot/coverage views: only periods that have
            # happened. Some companies file forward-looking plan figures under
            # instance_type='Actual' (one real firm had rows out to 2030); left in,
            # those became the leading columns of the actuals pivot and pushed the
            # real recent quarters off screen. The underlying points stay in each
            # company's series — this only bounds the shared period axis.
            "periods": sorted(p for p in all_periods if not as_of or p <= as_of),
        },
    }
    mark = meta.get("mark")
    if mark:
        kpi["branding"] = {"firmName": firm_name, "mark": mark}

    (out / "kpi.json").write_text(json.dumps(kpi, indent=2), encoding="utf-8")
    (out / "firms.json").write_text(json.dumps([{"slug": slug, "name": firm_name}], indent=2), encoding="utf-8")

    summary = {
        "firm": firm_name,
        "slug": slug,
        "metrics": len(metrics),
        "qualitativeMetrics": sum(1 for m in metrics if m.get("kind")),
        "qualitativeCompanies": sum(
            1 for c in companies
            if any(metrics_meta.get(k, {}).get("kind") for k in (c.get("series") or {}))),
        "companies": len(companies),
        "companiesWithData": sum(1 for c in companies if c["series"]),
        "funds": len(fund_dim),
        "periods": len(all_periods),
        "asOf": as_of,
        "forecastCompanies": sum(1 for c in companies if c.get("forecast")),
        "forecastVintages": len(fc_asof_dates),
        "valuationCompanies": sum(1 for c in companies if c.get("valuation")),
        "returnsCompanies": sum(1 for c in companies if c.get("returns")),
        "taggedCompanies": sum(1 for c in companies if c.get("tags")),
        "tagCategories": [t["cat"] for t in tag_dim],
        "ownershipCompanies": sum(1 for c in companies if c.get("ownership")),
        "capTableCompanies": sum(1 for c in companies if c.get("capTable")),
        "capTableClasses": sum(len(c["capTable"]["classes"]) for c in companies if c.get("capTable")),
        "soiCompanies": sum(1 for c in companies if c.get("soi")),
        "soiHistoryCompanies": sum(1 for c in companies if c.get("soiHistory")),
    }
    print(json.dumps(summary))
    if not companies:
        # Not a hard failure — a firm may simply have no Data Collection coverage.
        print("WARN: no companies reported KPIs (COMPANY_FINANCIALS empty for this "
              "firm). The dashboard will render an empty state.", file=sys.stderr)
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--since", default=None,
                    help="History window start (YYYY-MM-DD) that the fetch used. "
                         "Recorded in kpi.json; omit when the full history was pulled.")
    ap.add_argument("--as-of-max", default=None,
                    help="Latest submission date (YYYY-MM-DD) to trust; rows stamped "
                         "as-of later are dropped. Defaults to today.")
    args = ap.parse_args()
    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    if args.since:
        meta["since"] = args.since
    build(args.raw, args.out, meta, as_of_max=args.as_of_max)


if __name__ == "__main__":
    main()
