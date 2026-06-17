"""
Pure replace-planning logic for Stonly glossary sync.
No network, no I/O — all functions take plain Python data structures.
"""
from __future__ import annotations
import json
from typing import Any

from stonly_render import render_step_html, normalize_html


class StaleMapError(Exception):
    """Raised when the step map is out of sync with the live guide export."""
    pass


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
        For single-step sections:
        1. flagged_aside: step_map entry has has_aside: True
        2. unmapped: no matching sheet section for this step's section key
        3. flagged_rechunk: rendered HTML > 50000 chars OR orphan step
        4. changed: normalized new HTML != normalized live content
        5. unchanged: everything else

        For multi-step sections, all steps are consolidated into one result:
        - flagged_aside: any step has has_aside: True
        - unmapped: no matching sheet section
        - flagged_rechunk: chain validation fails, or rendered HTML > 50000 chars,
          or no parent info for chain head
        - changed: one result keyed on chain head with stale_step_ids list
    """
    # Build lookup structures
    reverse_index = build_reverse_index(export_steps)
    step_content: dict[int, dict] = {s["id"]: s for s in export_steps}
    nav_step_ids: set[int] = set(step_map.get("nav_steps", []))

    results = []

    for section_entry in step_map.get("sections", []):
        section_key = section_entry["section"]
        section_steps = section_entry.get("steps", [])
        sheet_records = sheet_records_by_section.get(section_key)
        has_multiple_steps = len(section_steps) > 1

        # Empty-steps path: steps:[] with no content yet
        if not section_steps:
            section_title = section_entry.get("title") or section_key.split("|", 1)[-1]
            if "parent_id" in section_entry and sheet_records is not None:
                # New-section: we have enough info to create a step
                results.append({
                    "step_id": None,
                    "title": section_title,
                    "classification": "new_section",
                    "create_plan": {
                        "parent_id": section_entry["parent_id"],
                        "choice_label": section_entry.get("choice_label", ""),
                        "position": section_entry.get("position", 0),
                        "successor_id": section_entry.get("successor_id"),
                        "new_html": render_step_html(section_title, sheet_records),
                        "section_key": section_key,
                    },
                })
            else:
                # Unmapped: no parent_id or no sheet records
                results.append({
                    "step_id": None,
                    "title": section_title,
                    "classification": "unmapped",
                })
            continue

        if has_multiple_steps:
            # Consolidate all section records into a single step.
            # Position the new step at chain[0]'s nav slot; wire to chain[-1]'s successor.
            if sheet_records is None:
                for step_def in section_steps:
                    if step_def.get("has_aside"):
                        results.append({"step_id": step_def["id"], "title": step_def.get("title", ""), "classification": "flagged_aside"})
                    else:
                        results.append({"step_id": step_def["id"], "title": step_def.get("title", ""), "classification": "unmapped"})
                continue

            # Try to validate the chain order against the live export
            try:
                chain = find_and_validate_chain(section_entry, step_content)
            except StaleMapError:
                for step_def in section_steps:
                    results.append({"step_id": step_def["id"], "title": step_def.get("title", ""), "classification": "flagged_rechunk"})
                continue

            chain_head = chain[0]
            chain_tail = chain[-1]
            chain_head_id = chain_head["id"]
            chain_head_title = section_steps[0].get("title", "")

            # Check for aside on any step in the section
            if any(s.get("has_aside") for s in section_steps):
                for step_def in section_steps:
                    results.append({"step_id": step_def["id"], "title": step_def.get("title", ""), "classification": "flagged_aside"})
                continue

            # Render all section records into a single step
            new_html = render_step_html(chain_head_title, sheet_records)
            if len(new_html) > 50000:
                for step_def in section_steps:
                    results.append({"step_id": step_def["id"], "title": step_def.get("title", ""), "classification": "flagged_rechunk"})
                continue

            # Get parent from chain head
            parent_info = reverse_index.get(chain_head_id)
            if parent_info is None:
                for step_def in section_steps:
                    results.append({"step_id": step_def["id"], "title": step_def.get("title", ""), "classification": "flagged_rechunk"})
                continue

            parent_id, choice_label, position = parent_info
            # Successor is the first next-step of the chain tail (what the chain currently points to after the last chunk)
            raw_next_steps = chain_tail.get("nextSteps", [])
            successors = [
                {"id": ns["id"], "choiceLabel": ns.get("choiceLabel", ""), "position": idx}
                for idx, ns in enumerate(raw_next_steps)
            ]

            stale_step_ids = [s["id"] for s in chain]

            results.append({
                "step_id": chain_head_id,
                "title": chain_head_title,
                "classification": "changed",
                "replace_plan": {
                    "parent_id": parent_id,
                    "choice_label": choice_label,
                    "position": position,
                    "successors": successors,
                    "new_html": new_html,
                    "stale_step_ids": stale_step_ids,
                },
            })
            continue

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
                # Build replace_plan — requires a known parent from the reverse index.
                # A step with no parent (entry/root step, or orphan) cannot be auto-inserted;
                # flag it for manual review rather than sending parentStepId: null to the API.
                parent_info = reverse_index.get(step_id)
                if parent_info is None:
                    results.append({
                        "step_id": step_id,
                        "title": step_title,
                        "classification": "flagged_rechunk",
                    })
                    continue

                parent_id, choice_label, position = parent_info

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



def find_and_validate_chain(
    section_entry: dict,
    export_index: dict[int, dict],
) -> list[dict]:
    """Walk the declared step chain and verify it matches the live guide export.

    Args:
        section_entry: One entry from step_map["sections"]. Must have
            ``steps: [{id, title, has_aside}]`` in declared order.
        export_index: ``{step_id: step_dict}`` built from the guide export.
            Each step dict has ``id``, ``content``, and
            ``nextSteps: [{id, choiceLabel}]``.

    Returns:
        Ordered list of full step dicts from ``export_index``, in the same
        order as ``section_entry["steps"]``.

    Raises:
        StaleMapError: If any declared step ID is missing from the export, or
            if consecutive declared steps are not linked in the live export.
    """
    declared_steps = section_entry["steps"]
    section_name = section_entry.get("section", "<unknown>")

    if not declared_steps:
        raise StaleMapError(f"Section '{section_name}' has no steps in the map")

    # Verify all step IDs exist in export first
    for step_def in declared_steps:
        step_id = step_def["id"]
        if step_id not in export_index:
            raise StaleMapError(
                f"Step {step_id} in map not found in live export"
            )

    # Verify consecutive pairs are linked
    for i in range(len(declared_steps) - 1):
        current_id = declared_steps[i]["id"]
        next_id = declared_steps[i + 1]["id"]
        current_step = export_index[current_id]
        next_step_ids = {ns["id"] for ns in current_step.get("nextSteps", [])}
        if next_id not in next_step_ids:
            raise StaleMapError(
                f"Chain order mismatch for section '{section_name}': "
                f"step {current_id} does not link to {next_id} in live export"
            )

    return [export_index[step_def["id"]] for step_def in declared_steps]


def writeback_step_map(path: "Path", section_key: str, new_id: int, title: str) -> None:
    """Persist a newly-created step ID back into the step map JSON file.

    Raises ValueError if section_key is not found.
    """
    data = json.loads(path.read_text())
    for section in data["sections"]:
        if section["section"] == section_key:
            section["steps"] = [{"id": new_id, "title": title, "has_aside": False}]
            path.write_text(json.dumps(data, indent=2))
            return
    raise ValueError(f"section_key {section_key!r} not found in step map")

