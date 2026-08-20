#!/usr/bin/env python3
"""Validate the active master-review workspace without reviving archived specs."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

try:
    import yaml
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("PyYAML is required: python3 -m pip install pyyaml") from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
RESEARCH_ROOT = REPO_ROOT / "research" / "korean-equity-rwa"
ARCHIVE_ROOT = REPO_ROOT / "archive" / "pre-prd-v1"
SOURCE_ROOT = RESEARCH_ROOT / "sources" / "user"
SOURCE_INDEX = RESEARCH_ROOT / "_work" / "source_index.jsonl"
MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
OLD_ROOT_LINK = re.compile(r"\]\((?:\.\./)*(?:design|specs|tmp)/")


class ValidationFailure(Exception):
    """Raised after collecting one or more validation errors."""


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def parse_structured_files(errors: list[str]) -> None:
    for path in sorted(RESEARCH_ROOT.rglob("*")):
        if not path.is_file():
            continue
        try:
            if path.suffix == ".json":
                json.loads(path.read_text(encoding="utf-8"))
            elif path.suffix == ".jsonl":
                for line_number, line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(), start=1
                ):
                    if line.strip():
                        json.loads(line)
            elif path.suffix in {".yaml", ".yml"}:
                yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:  # report every malformed active data file
            errors.append(f"structured data parse failed: {path.relative_to(REPO_ROOT)}: {exc}")


def validate_source_index(errors: list[str]) -> None:
    expected_ids = {f"U{number:03d}" for number in range(1, 15)}
    found_ids: set[str] = set()

    for line_number, line in enumerate(
        SOURCE_INDEX.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue  # parse_structured_files reports the precise parse error

        record_id = record.get("id", "")
        if not re.fullmatch(r"U\d{3}", record_id):
            continue
        found_ids.add(record_id)

        relative_path = record.get("path")
        expected_hash = record.get("sha256")
        if not isinstance(relative_path, str) or not isinstance(expected_hash, str):
            errors.append(f"source index line {line_number}: missing path or sha256")
            continue

        source_path = (REPO_ROOT / relative_path).resolve()
        try:
            source_path.relative_to(SOURCE_ROOT.resolve())
        except ValueError:
            errors.append(f"{record_id}: source escapes sources/user: {relative_path}")
            continue

        if not source_path.is_file():
            errors.append(f"{record_id}: source missing: {relative_path}")
            continue

        actual_hash = digest(source_path)
        if actual_hash != expected_hash:
            errors.append(
                f"{record_id}: checksum mismatch for {relative_path}: "
                f"expected {expected_hash}, got {actual_hash}"
            )

    missing_ids = sorted(expected_ids - found_ids)
    extra_ids = sorted(found_ids - expected_ids)
    if missing_ids:
        errors.append(f"source index missing user IDs: {', '.join(missing_ids)}")
    if extra_ids:
        errors.append(f"source index has unexpected user IDs: {', '.join(extra_ids)}")


def markdown_files() -> list[Path]:
    return [REPO_ROOT / "README.md", REPO_ROOT / "PROJECT_WORKFLOW.md"] + sorted(
        RESEARCH_ROOT.rglob("*.md")
    )


def normalize_link_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        target = target[1 : target.index(">")]
    elif " " in target:
        target = target.split(" ", 1)[0]
    return unquote(target.split("#", 1)[0].split("?", 1)[0])


def validate_markdown_links(errors: list[str]) -> None:
    for path in markdown_files():
        if not path.is_file():
            errors.append(f"required markdown file missing: {path.relative_to(REPO_ROOT)}")
            continue

        text = path.read_text(encoding="utf-8")
        if OLD_ROOT_LINK.search(text) or "validate-design" in text:
            errors.append(f"active document links to retired root design assets: {path.relative_to(REPO_ROOT)}")

        for raw_target in MARKDOWN_LINK.findall(text):
            target = normalize_link_target(raw_target)
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            linked_path = (REPO_ROOT / target.lstrip("/")) if target.startswith("/") else (path.parent / target)
            if not linked_path.exists():
                errors.append(
                    f"broken local link: {path.relative_to(REPO_ROOT)} -> {raw_target}"
                )


def validate_workspace_contract(errors: list[str]) -> None:
    required_paths = [
        RESEARCH_ROOT / "brief.md",
        RESEARCH_ROOT / "drafts" / "final_candidate.md",
        RESEARCH_ROOT / "sources",
        RESEARCH_ROOT / "review" / "human_review.md",
        RESEARCH_ROOT / "_work" / "config.yaml",
        ARCHIVE_ROOT / "README.md",
        ARCHIVE_ROOT / "design",
        ARCHIVE_ROOT / "specs",
        ARCHIVE_ROOT / "tooling" / "validate-design.sh",
        ARCHIVE_ROOT / "tooling" / "validate_design.py",
        ARCHIVE_ROOT / ".gherkin-lintrc",
    ]
    for path in required_paths:
        if not path.exists():
            errors.append(f"required path missing: {path.relative_to(REPO_ROOT)}")

    retired_active_paths = [
        REPO_ROOT / "design",
        REPO_ROOT / "specs",
        REPO_ROOT / "tmp",
        REPO_ROOT / ".gherkin-lintrc",
        REPO_ROOT / "scripts" / "validate-design.sh",
        REPO_ROOT / "scripts" / "validate_design.py",
        RESEARCH_ROOT / "drafts" / "latest.md",
    ]
    for path in retired_active_paths:
        if path.exists():
            errors.append(f"retired path is still active: {path.relative_to(REPO_ROOT)}")

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    if "final_candidate.md" not in readme or "유일한 마스터" not in readme:
        errors.append("README must identify final_candidate.md as the sole current master")

    archive_readme = (ARCHIVE_ROOT / "README.md").read_text(encoding="utf-8")
    if "비규범적" not in archive_readme or "구현 요구사항으로 사용해서는 안" not in archive_readme:
        errors.append("archive README must mark the snapshot as non-normative")

    workflow = (REPO_ROOT / "PROJECT_WORKFLOW.md").read_text(encoding="utf-8")
    for stage in range(1, 15):
        if f"| {stage}." not in workflow:
            errors.append(f"PROJECT_WORKFLOW.md is missing stage {stage}")


def main() -> int:
    errors: list[str] = []
    parse_structured_files(errors)
    validate_source_index(errors)
    validate_markdown_links(errors)
    validate_workspace_contract(errors)

    if errors:
        print("Active research validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Active research workspace, links, metadata, and 14 source checksums passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
