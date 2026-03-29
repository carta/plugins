#!/usr/bin/env python3
"""Validate YAML frontmatter in markdown files and standalone YAML files under plugins/."""

import os
import subprocess
import sys
import tempfile

PLUGINS_DIR = "plugins"
YAMLLINT_CONFIG = ".yamllint.yml"


def extract_frontmatter(filepath: str) -> tuple[str | None, int]:
    """Extract YAML frontmatter from a markdown file.

    Returns (frontmatter_content, start_line) or (None, 0) if no frontmatter.
    """
    with open(filepath, "r") as f:
        lines = f.readlines()

    if not lines or lines[0].rstrip("\n") != "---":
        return None, 0

    end = None
    for i in range(1, len(lines)):
        if lines[i].rstrip("\n") == "---":
            end = i
            break

    if end is None:
        return None, 0

    # Return frontmatter content (between the two --- delimiters)
    return "".join(lines[1:end]), 1


def run_yamllint(content: str, original_file: str, line_offset: int) -> list[str]:
    """Run yamllint on content and return error messages with adjusted line numbers."""
    errors = []
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            ["yamllint", "-c", YAMLLINT_CONFIG, tmp_path],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            for line in result.stdout.strip().splitlines():
                # yamllint output format: "file:line:col: [level] message"
                if tmp_path in line:
                    # Replace temp path with original file path and adjust line number
                    rest = line.split(tmp_path, 1)[1]
                    if rest.startswith(":"):
                        parts = rest[1:].split(":", 2)
                        if len(parts) >= 2 and parts[0].strip().isdigit():
                            adjusted_line = int(parts[0].strip()) + line_offset
                            errors.append(
                                f"{original_file}:{adjusted_line}:{':'.join(parts[1:])}"
                            )
                            continue
                    errors.append(f"{original_file}{rest}")
    finally:
        os.unlink(tmp_path)

    return errors


def main() -> int:
    all_errors: list[str] = []

    # Find all markdown files with frontmatter
    for root, _dirs, files in os.walk(PLUGINS_DIR):
        for filename in files:
            filepath = os.path.join(root, filename)

            if filename.endswith(".md"):
                frontmatter, offset = extract_frontmatter(filepath)
                if frontmatter is not None:
                    errors = run_yamllint(frontmatter, filepath, offset)
                    all_errors.extend(errors)

            elif filename.endswith((".yml", ".yaml")):
                with open(filepath) as f:
                    content = f.read()
                errors = run_yamllint(content, filepath, 0)
                all_errors.extend(errors)

    if all_errors:
        print("YAML validation errors found:\n")
        for error in all_errors:
            print(f"  {error}")
        print(f"\n{len(all_errors)} error(s) found.")
        return 1

    print("All YAML frontmatter and YAML files are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
