#!/usr/bin/env python3
"""Read-only validation for the institutional design package."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import jsonschema
import yaml
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_serialization() -> None:
    for path in sorted(ROOT.rglob("*.json")):
        load_json(path)
    for path in sorted(ROOT.rglob("*.jsonl")):
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError as exc:
                raise AssertionError(f"{path.relative_to(ROOT)}:{line_no}: {exc}") from exc
    for path in sorted([*ROOT.rglob("*.yaml"), *ROOT.rglob("*.yml")]):
        yaml.safe_load(path.read_text(encoding="utf-8"))


def validate_schemas_and_fixture() -> None:
    schema_dir = ROOT / "specs" / "schemas"
    for path in sorted(schema_dir.glob("*.json")):
        jsonschema.Draft202012Validator.check_schema(load_json(path))

    domain_path = (schema_dir / "domain.schema.json").resolve()
    fixture_schema_path = (schema_dir / "demo-fixture.schema.json").resolve()
    domain = load_json(domain_path)
    fixture_schema = load_json(fixture_schema_path)
    assert isinstance(domain, dict) and isinstance(fixture_schema, dict)
    registry = Registry().with_resources(
        [
            (str(domain["$id"]), Resource.from_contents(domain)),
            (domain_path.as_uri(), Resource.from_contents(domain)),
            (str(fixture_schema["$id"]), Resource.from_contents(fixture_schema)),
            (fixture_schema_path.as_uri(), Resource.from_contents(fixture_schema)),
        ]
    )
    fixture = yaml.safe_load((ROOT / "specs/fixtures/demo-data.yaml").read_text(encoding="utf-8"))
    errors = sorted(
        jsonschema.Draft202012Validator(fixture_schema, registry=registry).iter_errors(fixture),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        rendered = "\n".join(
            f"fixture {list(error.absolute_path)}: {error.message}" for error in errors
        )
        raise AssertionError(rendered)


def validate_indexed_sources() -> None:
    path = ROOT / "research/korean-equity-rwa/_work/source_index.jsonl"
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        source_id = str(row["id"])
        if source_id in seen:
            raise AssertionError(f"duplicate source id: {source_id}")
        seen.add(source_id)
        if not source_id.startswith("U"):
            continue
        source_path = ROOT / str(row["path"])
        if not source_path.is_file():
            raise AssertionError(f"missing indexed source: {source_path}")
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if digest != row["sha256"]:
            raise AssertionError(f"checksum mismatch for {source_id}")


def validate_markdown_links() -> None:
    link_pattern = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
    for path in ROOT.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        for raw_target in link_pattern.findall(text):
            target = raw_target.strip().strip("<>")
            if target.startswith(("http://", "https://", "#")):
                continue
            relative_target = target.split("#", 1)[0]
            if not (path.parent / relative_target).resolve().exists():
                raise AssertionError(
                    f"broken local link: {path.relative_to(ROOT)} -> {target}"
                )


def validate_pii_and_neutrality() -> None:
    fixture = yaml.safe_load((ROOT / "specs/fixtures/demo-data.yaml").read_text(encoding="utf-8"))
    forbidden = {
        "name",
        "fullname",
        "passport",
        "passporthash",
        "residentnumber",
        "taxid",
        "birthdate",
        "homeaddress",
        "email",
        "phone",
    }

    def walk(value: object, pointer: str = "$") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                normalized = re.sub(r"[^a-z]", "", str(key).lower())
                if normalized in forbidden:
                    raise AssertionError(f"forbidden PII key: {pointer}.{key}")
                walk(child, f"{pointer}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{pointer}[{index}]")

    walk(fixture)
    for relative in [
        "specs/schemas/domain.schema.json",
        "specs/openapi.yaml",
        "specs/asyncapi.yaml",
    ]:
        text = (ROOT / relative).read_text(encoding="utf-8")
        if re.search(r'jurisdiction[^\n]*(?:const|enum)[^\n]*["\']HK["\']', text, re.IGNORECASE):
            raise AssertionError(f"HK hard-coded in core interface: {relative}")

    policies = fixture["policies"]
    hk_profiles = [policy for policy in policies if policy["jurisdiction"] == "HK"]
    if len(hk_profiles) != 1 or hk_profiles[0].get("replaceableWithoutCoreChange") is not True:
        raise AssertionError("HK must exist exactly once as a replaceable demo profile")


def validate_bdd_traceability() -> None:
    taxonomy = (ROOT / "specs/error-taxonomy.md").read_text(encoding="utf-8")
    defined = set(re.findall(r"`([A-Z][A-Z0-9_]{2,})`", taxonomy))
    used: set[str] = set()
    for feature in (ROOT / "specs/bdd").glob("*.feature"):
        used.update(
            re.findall(
                r'error code is "([A-Z][A-Z0-9_]{2,})"',
                feature.read_text(encoding="utf-8"),
            )
        )
    missing = sorted(used - defined)
    if missing:
        raise AssertionError(f"BDD error codes missing from taxonomy: {missing}")


def validate_candidate_gate() -> None:
    candidate = ROOT / "research/korean-equity-rwa/drafts/final_candidate.md"
    text = candidate.read_text(encoding="utf-8")
    if len(text.strip()) < 12_000:
        raise AssertionError("final candidate is shorter than the examples-level gate")
    if (ROOT / "research/korean-equity-rwa/review/needs_work.md").exists():
        raise AssertionError("review/needs_work.md exists; folder is not review-ready")


def main() -> None:
    validate_serialization()
    validate_schemas_and_fixture()
    validate_indexed_sources()
    validate_markdown_links()
    validate_pii_and_neutrality()
    validate_bdd_traceability()
    validate_candidate_gate()
    print("ok: institutional design package passed local validation")


if __name__ == "__main__":
    main()
