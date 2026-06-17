"""
Pure replace-planning logic for Stonly glossary sync.
No network, no I/O — all functions take plain Python data structures.
"""
from __future__ import annotations
from typing import Any

from stonly_render import render_step_html, normalize_html


def build_reverse_index(steps: list[dict]) -> dict[int, tuple[int, str, int]]:
    """Build a reverse index from child step IDs to their parent info.

    Args:
        steps: List of step dicts from GET /guide/export. Each has:
               id (int), nextSteps (list of {choiceLabel: str, id: int}).

    Returns:
        Dict mapping child_id -> (parent_id, choice_label, position)
        where position is the 0-based index in the parent's nextSteps array.
        The entry-point step (isFirstStep=True) will not appear as a child.
        Orphan steps (not referenced in any nextSteps) will not appear.
    """
    index: dict[int, tuple[int, str, int]] = {}
    for step in steps:
        parent_id = step["id"]
        for position, next_step in enumerate(step.get("nextSteps", [])):
            child_id = next_step["id"]
            choice_label = next_step.get("choiceLabel", "")
            index[child_id] = (parent_id, choice_label, position)
    return index


def plan_replacements(
    sheet_records_by_section: dict[str, list[dict]],
    export_steps: list[dict],
    step_map: dict,
) -> list[dict]:
    """Classify each mapped step and build replace plans for changed steps.

    Args:
        sheet_records_by_section: {"section_name": [records]} — each record has
            {field, type, section, definition} from parse_tab_records.
        export_steps: The list of step dicts from guide export.
        step_map: The loaded stonly_step_map.json dict.

    Returns:
        List of classification dicts, one per step in step_map["sections"]'s steps.
        Nav steps (listed in step_map["nav_steps"]) are excluded from output.

    Classification rules (in priority order):
        1. flagged_aside: step_map entry has has_aside: True
        2. unmapped: no matching sheet section for this step's section key
        3. flagged_rechunk: rendered HTML > 50000 chars OR section has multiple steps
        4. changed: normalized new HTML != normalized live content
        5. unchanged: everything else
    """
    # Build lookup structures
    reverse_index = build_reverse_index(export_steps)
    step_content: dict[int, dict] = {s["id"]: s for s in export_steps}
    nav_step_ids: set[int] = set(step_map.get("nav_steps", []))

    results = []

    for section_entry in step_map.get("sections", []):
        section_key = section_entry["section"]
        section_steps = section_entry["steps"]
        sheet_records = sheet_records_by_section.get(section_key)
        has_multiple_steps = len(section_steps) > 1

        for step_def in section_steps:
            step_id = step_def["id"]
            step_title = step_def.get("title", "")
            has_aside = step_def.get("has_aside", False)

            # Skip nav steps
            if step_id in nav_step_ids:
                continue

            # Priority 1: flagged_aside
            if has_aside:
                results.append({
                    "step_id": step_id,
                    "title": step_title,
                    "classification": "flagged_aside",
                })
                continue

            # Priority 2: unmapped — no sheet records for this section
            if sheet_records is None:
                results.append({
                    "step_id": step_id,
                    "title": step_title,
                    "classification": "unmapped",
                })
                continue

            # Priority 3: flagged_rechunk — multi-step section OR HTML too large
            if has_multiple_steps:
                results.append({
                    "step_id": step_id,
                    "title": step_title,
                    "classification": "flagged_rechunk",
                })
                continue

            # Single-step section: render and compare
            new_html = render_step_html(step_title, sheet_records)
            if len(new_html) > 50000:
                results.append({
                    "step_id": step_id,
                    "title": step_title,
                    "classification": "flagged_rechunk",
                })
                continue

            # Get live content from export
            live_step = step_content.get(step_id, {})
            live_content = live_step.get("content", "")

            # Priority 4: changed
            if normalize_html(live_content) != normalize_html(new_html):
                # Build replace_plan
                parent_info = reverse_index.get(step_id)
                if parent_info is not None:
                    parent_id, choice_label, position = parent_info
                else:
                    parent_id, choice_label, position = None, "", 0

                raw_next_steps = live_step.get("nextSteps", [])
                successors = [
                    {"id": ns["id"], "choiceLabel": ns.get("choiceLabel", ""), "position": idx}
                    for idx, ns in enumerate(raw_next_steps)
                ]

                results.append({
                    "step_id": step_id,
                    "title": step_title,
                    "classification": "changed",
                    "replace_plan": {
                        "parent_id": parent_id,
                        "choice_label": choice_label,
                        "position": position,
                        "successors": successors,
                        "new_html": new_html,
                        "stale_step_id": step_id,
                    },
                })
                continue

            # Priority 5: unchanged
            results.append({
                "step_id": step_id,
                "title": step_title,
                "classification": "unchanged",
            })

    return results
