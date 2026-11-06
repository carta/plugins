"""The summary table: how report_processor.py names its columns, and how build_template_definition.py
saves them as a custom report's summary.

Shared by both, so a saved custom report heads each column as the screen did. Stdlib only and
Python 3.9-safe: the template script imports it under the system interpreter.
"""

# The aggregation type in a report_processor.py config.
SUMMARY_TABLE = "summary_table"
# The header a share gets without a `name`.
PERCENT_HEADERS = {"total": "% of total", "group": "% of group"}
COUNT_HEADER = "Count"


def default_header(value):
    """Carta's header for a value saved without one: its column for a sum, "Count" for a count."""
    return value["column"] if value["fn"] == "sum" else COUNT_HEADER


def summary_value_header(value):
    """The header of a summary value's column: its `name`, a share's percent header, or the default."""
    if value.get("name"):
        return value["name"]
    if "percent_of" in value:
        return PERCENT_HEADERS[value["percent_of"]]
    return default_header(value)
