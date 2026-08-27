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
    expected_ids = {f"U{number:03d}" for number in range(1, 17)}
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
    return [
        REPO_ROOT / "README.md",
        REPO_ROOT / "PROJECT_WORKFLOW.md",
        REPO_ROOT / "PROJECT_DECISIONS.md",
    ] + sorted(RESEARCH_ROOT.rglob("*.md"))


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
        REPO_ROOT / "PROJECT_DECISIONS.md",
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
    stage_numbers = [
        int(match.group(1))
        for match in re.finditer(r"^\|\s+(\d+)\.\s+", workflow, flags=re.MULTILINE)
    ]
    expected_stage_numbers = list(range(1, 12))
    if stage_numbers != expected_stage_numbers:
        errors.append(
            "PROJECT_WORKFLOW.md stages must be exactly 1 through 11 in order: "
            f"found {stage_numbers}"
        )

    workflow_terms = [
        "기술 선택을 기록하는 위치",
        "토큰 표준",
        "발행할 블록체인",
        "외부 정보 전달",
    ]
    missing_workflow_terms = [term for term in workflow_terms if term not in workflow]
    if missing_workflow_terms:
        errors.append(
            "PROJECT_WORKFLOW.md is missing the approved technical-decision boundary: "
            + ", ".join(missing_workflow_terms)
        )

    decisions = (REPO_ROOT / "PROJECT_DECISIONS.md").read_text(encoding="utf-8")
    decision_terms = [
        "지원 종목 범위",
        "KOSPI 200",
        "대표 시연 종목",
        "토큰 표준과 배포 방식",
        "발행 블록체인",
        "외부 정보 전달",
    ]
    missing_decision_terms = [term for term in decision_terms if term not in decisions]
    if missing_decision_terms:
        errors.append(
            "PROJECT_DECISIONS.md is missing approved scope or pending technical decisions: "
            + ", ".join(missing_decision_terms)
        )
    if "| 첫 지원 종목 |" in decisions:
        errors.append(
            "PROJECT_DECISIONS.md still marks the overall PoC instrument universe as undecided"
        )


def validate_master_regulatory_contract(errors: list[str]) -> None:
    master_path = RESEARCH_ROOT / "drafts" / "final_candidate.md"
    master = master_path.read_text(encoding="utf-8")

    expected_sections = [
        "1. 의사결정 요약",
        "2. 외국인의 한국주식 접근경로와 PoC 선택",
        "3. 한국주식의 법적 장부와 현행 토큰화의 한계",
        "4. Dinari 사례와 한국형 변환",
        "5. 1단계 수탁 권리형 PoC 생애주기",
        "6. 기관별 역할, 계좌와 기준 장부",
        "7. PoC 업무화면",
        "8. 통제, 위험과 검증 기준",
        "9. 사업화 과제와 2단계 전망",
        "10. 결론",
    ]
    found_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", master, flags=re.MULTILINE)
    ]
    if found_sections != expected_sections:
        errors.append(
            "final_candidate.md numbered sections do not match the approved structure: "
            f"found {found_sections}"
        )

    required_terms = [
        "전자등록계좌부",
        "계좌 간 대체",
        "주주명부",
        "계약상 권리",
        "발행인관리계좌부",
        "고객관리계좌부",
        "자기계좌부",
        "고객계좌부",
        "체결 직후",
        "국내 결제 대기",
        "결제차이 위험",
        "USD 또는 USDC",
        "USDC",
        "고객 현금계좌",
        "적격 전환사업자",
        "지정 마켓메이커",
        "발행인계좌관리기관",
        "연계장부",
        "최종투자자 직접 기록",
        "기존 상장주식",
        "T+2 매도대금 결제",
        "환매 대기열",
        "기준 생애주기",
        "KOSPI 200",
        "대표 6종목",
        "PoC 목표 승인일",
        "토큰 표준",
        "발행할 블록체인",
        "토큰 플랫폼",
        "인가 해외 증권사 파트너",
        "고객 권리 기준장부",
        "불통일 행사",
    ]
    missing_terms = [term for term in required_terms if term not in master]
    if missing_terms:
        errors.append(
            "final_candidate.md is missing required Korean securities-ledger concepts: "
            + ", ".join(missing_terms)
        )

    internal_source_ids = sorted(set(re.findall(r"(?<![A-Za-z0-9])S\d{3}(?!\d)", master)))
    if internal_source_ids:
        errors.append(
            "final_candidate.md exposes internal source IDs: "
            + ", ".join(internal_source_ids)
        )

    removed_screen_terms = [
        "### 7.6 기관용 2단계 전환 비교 화면",
        "기관용 읽기 전용 화면",
    ]
    present_removed_terms = [term for term in removed_screen_terms if term in master]
    if present_removed_terms:
        errors.append(
            "final_candidate.md retains the removed stage-two PoC screen: "
            + ", ".join(present_removed_terms)
        )

    stale_issuance_patterns = [
        r"T\+2 결제[·와 ]*수탁 뒤에만 권리를 발행",
        r"결제[·와 ]*수탁 완료를 발행 기준",
        r"결제[·와 ]*수탁 반영 후 발행",
    ]
    for pattern in stale_issuance_patterns:
        if re.search(pattern, master):
            errors.append(
                "final_candidate.md retains the superseded post-settlement issuance rule: "
                + pattern
            )


def main() -> int:
    errors: list[str] = []
    parse_structured_files(errors)
    validate_source_index(errors)
    validate_markdown_links(errors)
    validate_workspace_contract(errors)
    validate_master_regulatory_contract(errors)

    if errors:
        print("Active research validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Active research workspace, links, metadata, master contract, and 16 source checksums passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
