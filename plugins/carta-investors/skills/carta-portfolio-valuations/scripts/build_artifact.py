# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Build a filled portfolio-valuations artifact from a list:portfolio_dashboard response.

Reads the HTML template and shared CSS from the sibling templates/ directory,
inlines the CSS (the <link> tag only resolves when the preview server is running),
injects the classified data payload, and writes filled HTML to stdout.

Usage:
    uv run build_artifact.py --template dashboard < response.json
    uv run build_artifact.py --template runner   < response.json
    uv run build_artifact.py --template cowork-bulk-results --pre-classified < rows.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

TEMPLATES_DIR      = Path(__file__).resolve().parent.parent / "templates"
# Code Desktop and Cowork share one template per artifact. The surface only
# changes how the CSS is emitted (see fill_template's `cowork` flag), not which
# file is read — driven by the --template choice, not by sniffing the markup.
DASHBOARD_TEMPLATE        = TEMPLATES_DIR / "dashboard.html"
RUNNER_TEMPLATE           = TEMPLATES_DIR / "runner.html"
RUNNER_PLAN_TEMPLATE      = TEMPLATES_DIR / "runner-plan.html"
BULK_RESULTS_TEMPLATE     = TEMPLATES_DIR / "bulk-results.html"
SHARED_CSS         = TEMPLATES_DIR / "shared.css"
# SangBleu Versailles ships with the theme-with-ink skill.  Inlined as base64
# in fill_template() so the page never needs a separate HTTP round-trip for it.
SANGBLEU_WOFF2 = (
    TEMPLATES_DIR.parent.parent.parent.parent
    / "skill-dev" / "skills" / "theme-with-ink" / "assets"
    / "SangBleuVersailles-Regular-WebS.woff2"
)

# Multiples whose backing field is "unset" arrive from the API as this
# zero-with-huge-negative-exponent string. Treat it as no value.
_UNSET_DECIMAL = "0E-21"


def _parse_date(s: "str | None") -> "date | None":
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _bucket(company: dict, today: date) -> "str | None":
    lv = company.get("latestValuation")
    if not lv:
        return "noValuation"
    status = (lv.get("status") or "").upper()
    if status == "DRAFT":
        return "draft"
    if status == "FINAL":
        return "current"
    return None


def _amount_and_currency(field):
    """Split a value/currency field into (number, currency_code_or_None).

    Accepts both shapes the API uses:
      - bare number (dashboard feed) → (n, None)  [currency unknown]
      - {"amount": "...", "currencyCode": "USD"} (list:projects) → (n, "USD")
    """
    if isinstance(field, dict):
        return _to_float(field.get("amount"), 0.0) or 0.0, field.get("currencyCode") or None
    return _to_float(field, 0.0) or 0.0, None


def _request_access_url(firm_id: "str | None", base_url: "str | None") -> "str | None":
    """Build the firm's information-access page URL, or None if either input is missing.

    Requires the resolved app {BASE_URL} (see references/deep-link.md Step 1),
    not the bare API host — the caller must resolve it the same way any other
    deep link in this skill does.
    """
    if not firm_id or not base_url:
        return None
    return (
        f"{base_url.rstrip('/')}/investors/firm/{firm_id}/information-access/"
        "?has_active_holdings=true&inactive=false&ordering=captable_access&page=1&page_size=50"
    )


def _investments_url(firm_id: "str | None", base_url: "str | None") -> "str | None":
    """Build the firm's investments dashboard URL, or None if either input is missing.

    Emitted without the `date` query param: the dashboard can stay open for
    hours, so the template appends today's date at click time instead.
    """
    if not firm_id or not base_url:
        return None
    return f"{base_url.rstrip('/')}/investors/firm/{firm_id}/portfolio/investments/"


def build_payload(response: "dict | list", firm_id: "str | None" = None, base_url: "str | None" = None) -> dict:
    today = date.today()
    if isinstance(response, list):
        raw = []
        for page in response:
            raw.extend(page.get("companies") or [])
    else:
        raw = response.get("companies") or []

    eligible = []
    summary = {"draft": 0, "current": 0, "noValuation": 0}
    ineligible_count = 0
    no_access_count = 0
    kpi_company = 0.0
    kpi_holdings = 0.0

    for c in raw:
        has_cap = c.get("hasCorpCapTable", False)
        has_access = c.get("hasCorpCapTableAccess", True)
        is_llc = c.get("isLlc", False)

        if not has_cap and not is_llc:
            ineligible_count += 1
            continue
        if has_cap and not has_access:
            no_access_count += 1
            continue

        lv = c.get("latestValuation")
        bkt = _bucket(c, today)
        if bkt is None:
            continue

        summary[bkt] = summary.get(bkt, 0) + 1

        cv_amount, _ = _amount_and_currency((lv or {}).get("companyValue") or 0)
        hv_amount, _ = _amount_and_currency((lv or {}).get("holdingsValue") or 0)

        if bkt == "current":
            kpi_company += cv_amount
            kpi_holdings += hv_amount

        # Event fields are carried only when they actually hold data — a null
        # event is omitted so it costs no output tokens. This applies to every
        # bucket: a company with no valuation can still have, e.g., a recent
        # share transfer the dashboard wants to surface.
        events = {}
        if c.get("newFinancingRound"):
            events["newFinancingRound"] = c["newFinancingRound"]
        if c.get("newTenderOffer"):
            events["newTenderOffer"] = c["newTenderOffer"]
        if c.get("newShareTransfer"):
            events["newShareTransfer"] = c["newShareTransfer"]

        # Per-bucket field stripping keeps the payload Claude must emit small
        # (it flows through output tokens once per write). Only carry the fields
        # each bucket actually renders:
        #   - noValuation: the condensed table shows just the name, so carry
        #     name + id (plus any non-null events) and drop everything else.
        #   - draft: company/holdings values aren't final, so omit them — the
        #     template renders a missing value as "—".
        # Companies that fall out before this point (no cap table / no access)
        # never reach `eligible`; they're surfaced via ineligibleCount /
        # noAccessCount, so no per-company fields are needed for them at all.
        if bkt == "noValuation":
            entry = {
                "name": c.get("name", ""),
                "bucket": bkt,
                "corporationId": c.get("corporationId") or c.get("llcIssuerId"),
            }
        else:
            entry = {
                "name": c.get("name", ""),
                "bucket": bkt,
                "latestValuationDate": (lv or {}).get("date", "") or "",
                "status": ((lv or {}).get("status") or "").capitalize(),
                "approach": (lv or {}).get("approaches") or None,
            }
            if bkt != "draft":
                entry["companyValue"] = cv_amount
                entry["holdingsValue"] = hv_amount
        entry.update(events)
        eligible.append(entry)

    return {
        "eligible": eligible,
        "summary": summary,
        "ineligibleCount": ineligible_count,
        "noAccessCount": no_access_count,
        "requestAccessUrl": _request_access_url(firm_id, base_url),
        "investmentsUrl": _investments_url(firm_id, base_url),
        # Not the sum of the three states: a valuation that is neither DRAFT
        # nor FINAL belongs to none of them, but still counts in the total.
        "companyCount": len(raw),
        "kpis": {
            "companyValue": kpi_company,
            "holdingsValue": kpi_holdings,
        },
    }


def _to_float(value, default=None):
    """Coerce an API numeric (str/Decimal-string/number) to float.

    Returns ``default`` for None, "", the unset sentinel, or unparseable input.
    """
    if value is None or value == "" or value == _UNSET_DECIMAL:
        return default
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    # The API encodes "unset" as 0E-21 which floats to ~0.0; guard that too.
    if f == 0.0 and str(value).strip() in ("0E-21", "0.0", "0"):
        return default if str(value).strip() == "0E-21" else f
    return f


def fill_template(template_path: Path, payload: dict, cowork: bool = False) -> str:
    """Inline the shared CSS + data payload into a template.

    `cowork` selects how the stylesheet is emitted; the same template file is
    used either way:
      - cowork=True  → minify the sheet and skip font inlining. The Cowork
        iframe re-emits the whole artifact through output tokens (so smaller is
        faster) and has no local server to serve a separate font file.
      - cowork=False → inline the font as a base64 data URI so the Desktop
        preview server never needs a second HTTP round-trip for it.

    Templates that ship without a `<link rel="stylesheet" href="/shared.css"/>`
    tag (e.g. the runner widget, which is styled entirely by the host design
    system) simply receive the data injection — the CSS replacement is a no-op.
    """
    import base64
    html = template_path.read_text(encoding="utf-8")
    css  = SHARED_CSS.read_text(encoding="utf-8")

    try:
        font_b64 = base64.b64encode(SANGBLEU_WOFF2.read_bytes()).decode("ascii")
        css = css.replace(
            'url("/sangbleu.woff2") format("woff2")',
            f'url("data:font/woff2;base64,{font_b64}") format("woff2")',
        )
    except FileNotFoundError:
        pass  # font unavailable — browser falls back to Georgia

    if cowork:
        # Minify CSS
        css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
        css = re.sub(r'\s+', ' ', css).strip()
        css = re.sub(r' ?([{};:,>+~]) ?', r'\1', css)

        # Minify inline <script> blocks in the template
        def _minify_js(m: "re.Match[str]") -> str:
            tag, body, close = m.group(1), m.group(2), m.group(3)
            # Remove single-line comments (not URLs — guard with a negative
            # lookbehind for ':' so http:// is preserved)
            body = re.sub(r'(?<!:)//[^\n]*', '', body)
            # Remove multi-line comments
            body = re.sub(r'/\*.*?\*/', '', body, flags=re.DOTALL)
            # Collapse whitespace runs to a single space
            body = re.sub(r'[ \t]*\n[ \t]*', '\n', body)
            body = re.sub(r'\n{2,}', '\n', body).strip()
            return tag + body + close

        html = re.sub(
            r'(<script[^>]*>)(.*?)(</script>)',
            _minify_js,
            html,
            flags=re.DOTALL,
        )

    html = html.replace(
        '<link rel="stylesheet" href="/shared.css"/>',
        "<style>\n" + css + "\n</style>",
    )
    html = html.replace('"__INJECTED_DATA__"', json.dumps(payload, separators=(",", ":")))
    return html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--template",
                       choices=["dashboard", "runner", "runner-plan", "bulk-results",
                                "cowork-dashboard", "cowork-runner", "cowork-runner-plan",
                                "cowork-bulk-results"],
                       help="Output filled HTML for a Cowork artifact or show_widget")
    group.add_argument("--output-payload", action="store_true",
                       help="Output the classified JSON payload only (for Desktop preview)")
    parser.add_argument("--pre-classified", action="store_true",
                        help="Treat stdin as an already-classified payload (skip build_payload). "
                             "Use when piping dashboard-data.json rather than the raw API response.")
    parser.add_argument("--firm-id", default=None,
                        help="Firm org_pk (ownerId). Combined with --base-url to build the "
                             "dashboard's \"Request access\" link. Ignored with --pre-classified.")
    parser.add_argument("--base-url", default=None,
                        help="Resolved app {BASE_URL} per references/deep-link.md Step 1 "
                             "(e.g. https://app.test.carta.rocks) — NOT the bare API host. "
                             "Ignored with --pre-classified.")
    args = parser.parse_args()

    raw = sys.stdin.read()
    try:
        response = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.exit(f"Invalid JSON on stdin: {exc}")

    if args.pre_classified:
        payload = response
    else:
        payload = build_payload(response, firm_id=args.firm_id, base_url=args.base_url)

    if args.output_payload:
        print(json.dumps(payload, indent=2))
        return

    template, cowork = {
        "dashboard":          (DASHBOARD_TEMPLATE, False),
        "cowork-dashboard":   (DASHBOARD_TEMPLATE, True),
        "runner":             (RUNNER_TEMPLATE, False),
        "cowork-runner":      (RUNNER_TEMPLATE, True),
        "runner-plan":        (RUNNER_PLAN_TEMPLATE, False),
        "cowork-runner-plan": (RUNNER_PLAN_TEMPLATE, True),
        "bulk-results":        (BULK_RESULTS_TEMPLATE, False),
        "cowork-bulk-results": (BULK_RESULTS_TEMPLATE, True),
    }[args.template]
    print(fill_template(template, payload, cowork=cowork), end="")


if __name__ == "__main__":
    main()
