"""
Render Stonly HTML for cap-table glossary steps.
Two public functions: render_step_html and normalize_html.
"""
from __future__ import annotations
import html
import re


def render_step_html(title: str, records: list[dict]) -> str:
    """Produce Stonly-compatible HTML for a glossary step.

    Args:
        title: The step heading text (will be HTML-escaped).
        records: List of dicts with keys: field, type, section, definition.
                 Typically produced by glossary_common.parse_tab_records().

    Returns:
        A single HTML string with no leading/trailing newlines.
    """
    escaped_title = html.escape(title)

    header_row = (
        "<tr>"
        '<td colspan="1" rowspan="1" colwidth="202" width="202px"'
        ' data-background-color="rgba(255, 255, 255, 0.15)"'
        ' style="background-color:rgba(255, 255, 255, 0.15)">'
        "<p><b>Field name</b></p>"
        "</td>"
        '<td colspan="1" rowspan="1">'
        "<p><b>Definition</b></p>"
        "</td>"
        "</tr>"
    )

    data_rows = []
    for record in records:
        field = html.escape(record["field"])
        definition = html.escape(record["definition"])
        row = (
            "<tr>"
            '<td colspan="1" rowspan="1" colwidth="202" width="202px"'
            ' data-background-color="rgb(244, 248, 250)"'
            ' style="background-color:rgb(244, 248, 250)">'
            f"<h5>{field}</h5>"
            "</td>"
            '<td colspan="1" rowspan="1">'
            f"<p>{definition}</p>"
            "</td>"
            "</tr>"
        )
        data_rows.append(row)

    rows_html = header_row + "".join(data_rows)

    return (
        f"<h3>{escaped_title}</h3>"
        '<div class="table-container">'
        '<div class="table-wrapper">'
        '<table style="min-width:250px">'
        "<tbody>"
        f"{rows_html}"
        "</tbody>"
        "</table>"
        "</div>"
        "</div>"
    )


def normalize_html(s: str) -> str:
    """Collapse insignificant whitespace for HTML comparison.

    Two passes:
    1. Strip whitespace between tags (between ``>`` and ``<``).
    2. Collapse remaining whitespace sequences to a single space.
    Then strip leading/trailing whitespace from the result.

    This allows comparing a compact renderer output against a
    pretty-printed/indented HTML string (e.g. fetched back from Stonly).

    Args:
        s: HTML string to normalize.

    Returns:
        Normalized string with collapsed whitespace.
    """
    # Remove whitespace between closing > and opening <
    s = re.sub(r">\s+<", "><", s)
    # Collapse remaining whitespace runs
    s = re.sub(r"\s+", " ", s)
    return s.strip()


