#!/usr/bin/env python3
"""Validate the active master-review workspace without reviving archived specs."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import unquote

try:
    import yaml
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("PyYAML is required: python3 -m pip install pyyaml") from exc

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("jsonschema is required: python3 -m pip install jsonschema") from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = REPO_ROOT / "docs"
RESEARCH_ROOT = REPO_ROOT / "research" / "korean-equity-rwa"
ARCHIVE_ROOT = REPO_ROOT / "archive" / "pre-prd-v1"
SOURCE_ROOT = RESEARCH_ROOT / "sources" / "user"
SOURCE_INDEX = RESEARCH_ROOT / "_work" / "source_index.jsonl"
WORKFLOW = DOCS_ROOT / "00-project" / "WORKFLOW.md"
DECISIONS = DOCS_ROOT / "00-project" / "DECISIONS.md"
MASTER = DOCS_ROOT / "01-master" / "MASTER.md"
POC_GOALS = DOCS_ROOT / "02-poc-definition" / "POC_GOALS.md"
POC_TEST_DATA = DOCS_ROOT / "02-poc-definition" / "POC_TEST_DATA.md"
PRD = DOCS_ROOT / "03-product-requirements" / "PRD.md"
INSTITUTION_WORKFLOWS = DOCS_ROOT / "04-institution-design" / "INSTITUTION_WORKFLOWS.md"
REFERENCE_DATA = DOCS_ROOT / "04-institution-design" / "REFERENCE_DATA.md"
SCREEN_FLOWS = DOCS_ROOT / "05-screens-states-recovery" / "SCREEN_FLOWS.md"
STATE_MODEL = DOCS_ROOT / "05-screens-states-recovery" / "STATE_MODEL.md"
ERROR_AND_RECOVERY = DOCS_ROOT / "05-screens-states-recovery" / "ERROR_AND_RECOVERY.md"
ARCHITECTURE = DOCS_ROOT / "06-architecture-security" / "ARCHITECTURE.md"
TECHNOLOGY_DECISIONS = DOCS_ROOT / "06-architecture-security" / "TECHNOLOGY_DECISIONS.md"
SECURITY_AND_PRIVACY = DOCS_ROOT / "06-architecture-security" / "SECURITY_AND_PRIVACY.md"
STAGE_SEVEN_ROOT = DOCS_ROOT / "07-data-api-events"
DATA_MODEL = STAGE_SEVEN_ROOT / "DATA_MODEL.md"
API_CONTRACTS = STAGE_SEVEN_ROOT / "API_CONTRACTS.md"
EVENT_CONTRACTS = STAGE_SEVEN_ROOT / "EVENT_CONTRACTS.md"
STAGE_SEVEN_SPECS = STAGE_SEVEN_ROOT / "specs"
COMMON_SCHEMA = STAGE_SEVEN_SPECS / "schemas" / "common.schema.json"
DOMAIN_SCHEMA = STAGE_SEVEN_SPECS / "schemas" / "domain.schema.json"
SIGNATURES_SCHEMA = STAGE_SEVEN_SPECS / "schemas" / "signatures.schema.json"
EVENTS_SCHEMA = STAGE_SEVEN_SPECS / "schemas" / "events.schema.json"
STATE_CATALOG_SCHEMA = STAGE_SEVEN_SPECS / "schemas" / "state-catalog.schema.json"
STATE_CATALOG = STAGE_SEVEN_SPECS / "state-catalog.json"
TRACEABILITY = STAGE_SEVEN_SPECS / "traceability.json"
PLATFORM_OPENAPI = STAGE_SEVEN_SPECS / "openapi.platform.yaml"
ADAPTER_OPENAPI = STAGE_SEVEN_SPECS / "openapi.adapters.yaml"
ASYNCAPI = STAGE_SEVEN_SPECS / "asyncapi.yaml"
LIFECYCLE_EXAMPLES = STAGE_SEVEN_SPECS / "examples" / "lifecycle-events.jsonl"
FAILURE_EXAMPLES = STAGE_SEVEN_SPECS / "examples" / "failure-cases.json"
SIGNED_INTENT_EXAMPLES = STAGE_SEVEN_SPECS / "examples" / "signed-intents.json"
STAGE_EIGHT_ROOT = DOCS_ROOT / "08-smart-contract-design"
CONTRACT_ARCHITECTURE = STAGE_EIGHT_ROOT / "CONTRACT_ARCHITECTURE.md"
CONTRACT_INTERFACES = STAGE_EIGHT_ROOT / "CONTRACT_INTERFACES.md"
ROLES_AND_GOVERNANCE = STAGE_EIGHT_ROOT / "ROLES_AND_GOVERNANCE.md"
INVARIANTS = STAGE_EIGHT_ROOT / "INVARIANTS.md"
CONTRACT_MANIFEST = STAGE_EIGHT_ROOT / "specs" / "contract-manifest.json"
CONTRACT_ABI = STAGE_EIGHT_ROOT / "specs" / "contract-abi.json"
GOVERNANCE_ABI = STAGE_EIGHT_ROOT / "specs" / "governance-abi.json"
GOVERNANCE_ABI_SCHEMA = STAGE_EIGHT_ROOT / "specs" / "governance-abi.schema.json"
STAGE_NINE_ROOT = DOCS_ROOT / "09-test-design"
TEST_STRATEGY = STAGE_NINE_ROOT / "TEST_STRATEGY.md"
TEST_SCENARIOS = STAGE_NINE_ROOT / "TEST_SCENARIOS.md"
FIXTURES_AND_EVIDENCE = STAGE_NINE_ROOT / "FIXTURES_AND_EVIDENCE.md"
DEMO_CHECKLIST = STAGE_NINE_ROOT / "DEMO_CHECKLIST.md"
TEST_CATALOG = STAGE_NINE_ROOT / "specs" / "test-catalog.json"
TEST_CATALOG_SCHEMA = STAGE_NINE_ROOT / "specs" / "test-catalog.schema.json"
TEST_FIXTURES = STAGE_NINE_ROOT / "specs" / "test-fixtures.json"
TEST_TRACEABILITY = STAGE_NINE_ROOT / "specs" / "traceability.json"
TEST_TRACEABILITY_SCHEMA = STAGE_NINE_ROOT / "specs" / "traceability.schema.json"
KOSPI_SNAPSHOT = RESEARCH_ROOT / "sources" / "web" / "kospi200-2026-08-28.json"
MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
OLD_ROOT_LINK = re.compile(r"\]\((?:\.\./)*(?:design|tmp)/")


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
        WORKFLOW,
        DECISIONS,
        MASTER,
        POC_GOALS,
        POC_TEST_DATA,
        PRD,
        INSTITUTION_WORKFLOWS,
        REFERENCE_DATA,
        SCREEN_FLOWS,
        STATE_MODEL,
        ERROR_AND_RECOVERY,
        ARCHITECTURE,
        TECHNOLOGY_DECISIONS,
        SECURITY_AND_PRIVACY,
        DATA_MODEL,
        API_CONTRACTS,
        EVENT_CONTRACTS,
        CONTRACT_ARCHITECTURE,
        CONTRACT_INTERFACES,
        ROLES_AND_GOVERNANCE,
        INVARIANTS,
        TEST_STRATEGY,
        TEST_SCENARIOS,
        FIXTURES_AND_EVIDENCE,
        DEMO_CHECKLIST,
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
        MASTER,
        POC_GOALS,
        POC_TEST_DATA,
        PRD,
        INSTITUTION_WORKFLOWS,
        REFERENCE_DATA,
        SCREEN_FLOWS,
        STATE_MODEL,
        ERROR_AND_RECOVERY,
        ARCHITECTURE,
        TECHNOLOGY_DECISIONS,
        SECURITY_AND_PRIVACY,
        DATA_MODEL,
        API_CONTRACTS,
        EVENT_CONTRACTS,
        COMMON_SCHEMA,
        DOMAIN_SCHEMA,
        SIGNATURES_SCHEMA,
        EVENTS_SCHEMA,
        STATE_CATALOG_SCHEMA,
        STATE_CATALOG,
        TRACEABILITY,
        PLATFORM_OPENAPI,
        ADAPTER_OPENAPI,
        ASYNCAPI,
        LIFECYCLE_EXAMPLES,
        FAILURE_EXAMPLES,
        SIGNED_INTENT_EXAMPLES,
        CONTRACT_ARCHITECTURE,
        CONTRACT_INTERFACES,
        ROLES_AND_GOVERNANCE,
        INVARIANTS,
        CONTRACT_MANIFEST,
        CONTRACT_ABI,
        GOVERNANCE_ABI,
        GOVERNANCE_ABI_SCHEMA,
        TEST_STRATEGY,
        TEST_SCENARIOS,
        FIXTURES_AND_EVIDENCE,
        DEMO_CHECKLIST,
        TEST_CATALOG,
        TEST_CATALOG_SCHEMA,
        TEST_FIXTURES,
        TEST_TRACEABILITY,
        TEST_TRACEABILITY_SCHEMA,
        KOSPI_SNAPSHOT,
        RESEARCH_ROOT / "sources",
        RESEARCH_ROOT / "review" / "human_review.md",
        RESEARCH_ROOT / "_work" / "config.yaml",
        WORKFLOW,
        DECISIONS,
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
        RESEARCH_ROOT / "drafts" / "final_candidate.md",
        REPO_ROOT / "PROJECT_WORKFLOW.md",
        REPO_ROOT / "PROJECT_DECISIONS.md",
        REPO_ROOT / "POC_GOALS.md",
        REPO_ROOT / "POC_TEST_DATA.md",
        REPO_ROOT / "PRD.md",
        REPO_ROOT / "INSTITUTION_WORKFLOWS.md",
        REPO_ROOT / "REFERENCE_DATA.md",
        REPO_ROOT / "SCREEN_FLOWS.md",
        REPO_ROOT / "STATE_MODEL.md",
        REPO_ROOT / "ERROR_AND_RECOVERY.md",
        REPO_ROOT / "ARCHITECTURE.md",
        REPO_ROOT / "TECHNOLOGY_DECISIONS.md",
        REPO_ROOT / "SECURITY_AND_PRIVACY.md",
        REPO_ROOT / "DATA_MODEL.md",
        REPO_ROOT / "API_CONTRACTS.md",
        REPO_ROOT / "EVENT_CONTRACTS.md",
        REPO_ROOT / "CONTRACT_ARCHITECTURE.md",
        REPO_ROOT / "CONTRACT_INTERFACES.md",
        REPO_ROOT / "ROLES_AND_GOVERNANCE.md",
        REPO_ROOT / "INVARIANTS.md",
        REPO_ROOT / "TEST_STRATEGY.md",
        REPO_ROOT / "TEST_SCENARIOS.md",
        REPO_ROOT / "FIXTURES_AND_EVIDENCE.md",
        REPO_ROOT / "DEMO_CHECKLIST.md",
    ]
    for path in retired_active_paths:
        if path.exists():
            errors.append(f"retired path is still active: {path.relative_to(REPO_ROOT)}")

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    if (
        "docs/01-master/MASTER.md" not in readme
        or "정합성 보완까지 승인된" not in readme
        or "마스터" not in readme
    ):
        errors.append("README must identify the master and the approved alignment")
    if (
        "docs/03-product-requirements/PRD.md" not in readme
        or "10단계 PoC 구현 중" not in readme
    ):
        errors.append("README must identify PRD.md and the stage-nine review status")
    if (
        "docs/04-institution-design/INSTITUTION_WORKFLOWS.md" not in readme
        or "docs/04-institution-design/REFERENCE_DATA.md" not in readme
    ):
        errors.append("README must identify both stage-four documents as approved")
    if (
        "docs/05-screens-states-recovery/SCREEN_FLOWS.md" not in readme
        or "docs/05-screens-states-recovery/STATE_MODEL.md" not in readme
        or "docs/05-screens-states-recovery/ERROR_AND_RECOVERY.md" not in readme
    ):
        errors.append("README must identify all three stage-five documents as approved")
    if (
        "docs/06-architecture-security/ARCHITECTURE.md" not in readme
        or "docs/06-architecture-security/TECHNOLOGY_DECISIONS.md" not in readme
        or "docs/06-architecture-security/SECURITY_AND_PRIVACY.md" not in readme
        or "7단계 설계의 입력" not in readme
    ):
        errors.append("README must identify all three stage-six documents as approved inputs")
    if (
        "docs/07-data-api-events/DATA_MODEL.md" not in readme
        or "docs/07-data-api-events/API_CONTRACTS.md" not in readme
        or "docs/07-data-api-events/EVENT_CONTRACTS.md" not in readme
        or "7단계 세 문서와 기계 명세" not in readme
        or "8단계" not in readme
    ):
        errors.append("README must identify approved stage-seven documents and stage-eight readiness")
    if (
        "docs/08-smart-contract-design/CONTRACT_ARCHITECTURE.md" not in readme
        or "docs/08-smart-contract-design/CONTRACT_INTERFACES.md" not in readme
        or "docs/08-smart-contract-design/ROLES_AND_GOVERNANCE.md" not in readme
        or "docs/08-smart-contract-design/INVARIANTS.md" not in readme
        or "9단계" not in readme
    ):
        errors.append("README must identify all approved stage-eight artifacts and stage nine")
    if (
        "docs/09-test-design/TEST_STRATEGY.md" not in readme
        or "docs/09-test-design/TEST_SCENARIOS.md" not in readme
        or "docs/09-test-design/FIXTURES_AND_EVIDENCE.md" not in readme
        or "docs/09-test-design/DEMO_CHECKLIST.md" not in readme
        or "10단계 PoC 구현 중" not in readme
        or "docs/10-poc-implementation/IMPLEMENTATION_GUIDE.md" not in readme
    ):
        errors.append("README must identify stage-nine review artifacts and block stage ten")
    if "실제 PoC 코드 구현: **10단계**" not in readme:
        errors.append("README must distinguish stage-six design from stage-ten implementation")

    root_markdown = {path.name for path in REPO_ROOT.glob("*.md")}
    if root_markdown != {"README.md"}:
        errors.append(
            "repository root must contain only README.md as a markdown entrypoint: "
            + ", ".join(sorted(root_markdown))
        )

    canonical_documents = {
        "WORKFLOW.md": WORKFLOW,
        "DECISIONS.md": DECISIONS,
        "MASTER.md": MASTER,
        "POC_GOALS.md": POC_GOALS,
        "POC_TEST_DATA.md": POC_TEST_DATA,
        "PRD.md": PRD,
        "INSTITUTION_WORKFLOWS.md": INSTITUTION_WORKFLOWS,
        "REFERENCE_DATA.md": REFERENCE_DATA,
        "SCREEN_FLOWS.md": SCREEN_FLOWS,
        "STATE_MODEL.md": STATE_MODEL,
        "ERROR_AND_RECOVERY.md": ERROR_AND_RECOVERY,
        "ARCHITECTURE.md": ARCHITECTURE,
        "TECHNOLOGY_DECISIONS.md": TECHNOLOGY_DECISIONS,
        "SECURITY_AND_PRIVACY.md": SECURITY_AND_PRIVACY,
        "DATA_MODEL.md": DATA_MODEL,
        "API_CONTRACTS.md": API_CONTRACTS,
        "EVENT_CONTRACTS.md": EVENT_CONTRACTS,
        "CONTRACT_ARCHITECTURE.md": CONTRACT_ARCHITECTURE,
        "CONTRACT_INTERFACES.md": CONTRACT_INTERFACES,
        "ROLES_AND_GOVERNANCE.md": ROLES_AND_GOVERNANCE,
        "INVARIANTS.md": INVARIANTS,
        "TEST_STRATEGY.md": TEST_STRATEGY,
        "TEST_SCENARIOS.md": TEST_SCENARIOS,
        "FIXTURES_AND_EVIDENCE.md": FIXTURES_AND_EVIDENCE,
        "DEMO_CHECKLIST.md": DEMO_CHECKLIST,
    }
    for filename, expected_path in canonical_documents.items():
        matches = [
            path
            for path in REPO_ROOT.rglob(filename)
            if ".git" not in path.parts and ARCHIVE_ROOT not in path.parents
        ]
        if matches != [expected_path]:
            errors.append(
                f"{filename} must have one canonical copy at "
                f"{expected_path.relative_to(REPO_ROOT)}: found "
                + ", ".join(str(path.relative_to(REPO_ROOT)) for path in matches)
            )

    archive_readme = (ARCHIVE_ROOT / "README.md").read_text(encoding="utf-8")
    if "비규범적" not in archive_readme or "구현 요구사항으로 사용해서는 안" not in archive_readme:
        errors.append("archive README must mark the snapshot as non-normative")

    workflow = WORKFLOW.read_text(encoding="utf-8")
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

    decisions = DECISIONS.read_text(encoding="utf-8")
    decision_terms = [
        "지원 종목 범위",
        "KOSPI 200",
        "대표 시연 종목",
        "권리업무 PoC 범위",
        "고객확인 PoC 깊이",
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

    aligned_documents = [
        REPO_ROOT / "README.md",
        WORKFLOW,
        DECISIONS,
        POC_GOALS,
        RESEARCH_ROOT / "brief.md",
        RESEARCH_ROOT / "review" / "human_review.md",
        RESEARCH_ROOT / "_work" / "report_template.md",
    ]
    required_24_7_terms = ["24/7", "지정 마켓메이커", "결제 완료 재고", "지정가"]
    superseded_phrases = [
        "24시간 거래는 PoC에서 제외",
        "24시간 거래는 이번 PoC에 포함하지 않는다",
        "비토큰 업무플랫폼 권고",
        "제한된 RFQ만 지원",
        "요청 접수와 헤지 대기만",
        "요청, 잠금 또는 헤지 대기만",
        "요청 접수, 권리 잠금 또는 헤지 대기만",
    ]
    for path in aligned_documents:
        text = path.read_text(encoding="utf-8")
        missing = [term for term in required_24_7_terms if term not in text]
        if missing:
            errors.append(
                f"{path.relative_to(REPO_ROOT)} is not aligned to the 24/7 PoC contract: "
                + ", ".join(missing)
            )
        stale = [phrase for phrase in superseded_phrases if phrase in text]
        if stale:
            errors.append(
                f"{path.relative_to(REPO_ROOT)} retains superseded PoC language: "
                + ", ".join(stale)
            )


def validate_poc_goals_contract(errors: list[str]) -> None:
    if not POC_GOALS.is_file() or not POC_TEST_DATA.is_file() or not KOSPI_SNAPSHOT.is_file():
        return  # validate_workspace_contract reports missing required files

    poc_goals = POC_GOALS.read_text(encoding="utf-8")
    test_data = POC_TEST_DATA.read_text(encoding="utf-8")
    snapshot = json.loads(KOSPI_SNAPSHOT.read_text(encoding="utf-8"))
    constituents = snapshot.get("constituents", [])

    if snapshot.get("as_of") != "2026-08-28":
        errors.append("KOSPI 200 snapshot must use the approved 2026-08-28 date")
    if snapshot.get("row_count") != 201 or len(constituents) != 201:
        errors.append("KOSPI 200 snapshot must contain the approved 201 rows")

    codes = [item.get("code") for item in constituents]
    if len(set(codes)) != len(codes):
        errors.append("KOSPI 200 snapshot contains duplicate security codes")

    expected_securities = {
        "005930": ("삼성전자", 257000),
        "000660": ("SK하이닉스", 1653000),
        "017670": ("SK텔레콤", 98600),
        "005380": ("현대차", 399500),
        "035420": ("NAVER", 220500),
        "006800": ("미래에셋증권", 36150),
        "000880": ("한화", 134900),
        "0220W0": ("한화머시너리앤서비스홀딩스", 7440),
    }
    indexed = {
        item.get("code"): (item.get("name"), item.get("close_krw"))
        for item in constituents
    }
    for code, expected in expected_securities.items():
        if indexed.get(code) != expected:
            errors.append(
                f"KOSPI 200 snapshot mismatch for {code}: "
                f"expected {expected}, found {indexed.get(code)}"
            )

    required_goal_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "POC_TEST_DATA.md",
        "1차 발행",
        "24/7 토큰 2차거래",
        "MM 헤지와 재고조정",
        "1차 발행용 기초주식 매수",
        "1차 환매용 기초주식 매도",
        "1차 환매",
        "투자자",
        "토큰 플랫폼",
        "인가 해외 증권사",
        "국내 주문집행 증권사",
        "수탁은행·상임대리인",
        "KSD",
        "지정 마켓메이커",
        "모의 자금·환전 사업자",
        "종목, KRW 지정가격과 거래일이 같은",
        "비례해 배분",
        "주문 접수시각",
        "T+2 결제차이 위험",
        "국내 결제 대기",
        "결제완료·거래 가능",
        "환매대금 지급청구",
        "토큰 플랫폼이 소각",
        "고객 USD 현금계좌",
        "USDC 재전환",
        "수량과 처리 원칙",
        "전체 발행토큰수량",
        "같은 요청번호",
        "시스템 재시작",
        "한 번만 최종 반영",
        "권리기입 완료",
        "1주 = 고객 수탁권리 1단위 = 토큰 1단위",
        "다음 달 10일",
        "USDC 전환",
    ]
    missing_goal_terms = [term for term in required_goal_terms if term not in poc_goals]
    if missing_goal_terms:
        errors.append(
            "POC_GOALS.md is missing the revised end-to-end market contract: "
            + ", ".join(missing_goal_terms)
        )

    required_test_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "201개",
        "삼성전자",
        "SK하이닉스",
        "SK텔레콤",
        "현대차",
        "NAVER",
        "미래에셋증권",
        "1,380.3원",
        "0.9950~1.0050",
        "0.50%",
        "1.50%",
        "1차시장 재고 보충 결제대기분",
        "순포지션",
        "MM이 투자자로부터 매수한 결제완료 수량",
        "합성 위험조정 신호",
        "합성 위험 입력",
        "±20단위",
        "2%",
        "1.5%",
        "30초",
        "60초",
        "실제 기준값",
        "합성 시험값",
        "비례배분",
        "A 4단위, B 2단위",
        "시스템을 재시작",
    ]
    missing_test_terms = [term for term in required_test_terms if term not in test_data]
    if missing_test_terms:
        errors.append(
            "POC_TEST_DATA.md is missing the reproducible test fixtures: "
            + ", ".join(missing_test_terms)
        )

    fx = Decimal("1380.3")
    expected_usd_prices = {
        "삼성전자": "$186.19",
        "SK하이닉스": "$1,197.57",
        "SK텔레콤": "$71.43",
        "현대차": "$289.43",
        "NAVER": "$159.75",
        "미래에셋증권": "$26.19",
    }
    for code, (name, close_krw) in list(expected_securities.items())[:6]:
        if name not in expected_usd_prices:
            continue
        calculated = (Decimal(close_krw) / fx).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        formatted = f"${calculated:,.2f}"
        if formatted != expected_usd_prices[name] or formatted not in test_data:
            errors.append(
                f"POC_TEST_DATA.md USD reference price mismatch for {name}: {formatted}"
            )

    stale_fixed_count_phrases = [
        "KOSPI 200 구성종목 200개",
        "공식 구성종목 200개",
        "200종목 모두",
    ]
    active_documents = [
        REPO_ROOT / "README.md",
        DECISIONS,
        RESEARCH_ROOT / "brief.md",
        MASTER,
        RESEARCH_ROOT / "review" / "human_review.md",
    ]
    for path in active_documents:
        text = path.read_text(encoding="utf-8")
        stale = [phrase for phrase in stale_fixed_count_phrases if phrase in text]
        if stale:
            errors.append(
                f"{path.relative_to(REPO_ROOT)} hard-codes a stale KOSPI 200 count: "
                + ", ".join(stale)
            )


def validate_prd_contract(errors: list[str]) -> None:
    if not PRD.is_file():
        return  # validate_workspace_contract reports the missing required file

    prd = PRD.read_text(encoding="utf-8")

    if "·" in prd:
        errors.append("PRD.md: use commas or natural conjunctions instead of middle-dot list separators")

    required_sections = [
        "1. 이 문서가 정하는 것",
        "2. 제품 목표와 성공 기준",
        "3. 사용자와 책임",
        "4. 구현 범위",
        "5. 핵심 사용자 흐름",
        "6. 제품 요구사항",
        "7. 기관 간 업무 인계",
        "8. 품질 요구사항",
        "9. 인수 시나리오와 추적",
        "10. 후속 결정과 담당",
        "11. 정합성 보완 승인 기준",
    ]
    found_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", prd, flags=re.MULTILINE)
    ]
    if found_sections != required_sections:
        errors.append(
            "PRD.md numbered sections do not match the stage-three structure: "
            f"found {found_sections}"
        )

    required_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "마스터 설계",
        "PoC 목표와 성공 기준",
        "PoC 시험 데이터와 통제값",
        "합성 고객확인",
        "1차 발행",
        "T+2 전환",
        "24/7 2차거래",
        "시장조성자 헤지",
        "1차 환매",
        "투자자",
        "토큰 플랫폼 운영자",
        "인가 해외 증권사",
        "국내 주문집행 증권사",
        "수탁은행과 상임대리인",
        "지정 시장조성자",
        "현금배당",
        "의결권",
        "월별 보고",
        "수량 불변식",
        "중복 방지",
        "장애 복구",
        "상태 이름 전체 목록",
        "데이터 형식",
        "토큰 표준",
        "발행할 블록체인",
        "스마트컨트랙트 동작",
        "6단계에 착수할 수 있다",
    ]
    missing_terms = [term for term in required_terms if term not in prd]
    if missing_terms:
        errors.append(
            "PRD.md is missing required product boundaries or lifecycle terms: "
            + ", ".join(missing_terms)
        )

    custody_review_terms = [
        "체결 후 미발행",
        "국내 결제완료 응답과 수탁수량 반영 응답",
        "위험한도 회복",
        "권리기입 완료",
        "T+2 위험 승인",
        "환매대금 지급청구",
        "환매 소각 대기",
        "배당락 기준",
        "원자적 처리",
    ]
    missing_custody_terms = [term for term in custody_review_terms if term not in prd]
    if missing_custody_terms:
        errors.append(
            "PRD.md is missing approved custody review refinements: "
            + ", ".join(missing_custody_terms)
        )

    requirement_families = {
        "고객확인": 4,
        "상품목록": 3,
        "1차발행": 5,
        "국내결제": 4,
        "24시간거래": 6,
        "시장조성": 5,
        "환매": 5,
        "권리관리": 4,
        "안전통제": 5,
        "감사기록": 3,
        "투자자보호": 2,
        "민원처리": 1,
        "배당전환": 1,
        "수량단위": 1,
    }
    expected_ids = {
        f"{family}-{number:02d}"
        for family, count in requirement_families.items()
        for number in range(1, count + 1)
    }
    defined_ids = re.findall(
        r"^\|\s*((?:고객확인|투자자보호|민원처리|상품목록|1차발행|국내결제|24시간거래|시장조성|환매|권리관리|배당전환|수량단위|안전통제|감사기록)-\d{2})\s*\|",
        prd,
        flags=re.MULTILINE,
    )
    duplicate_ids = sorted({item for item in defined_ids if defined_ids.count(item) > 1})
    if duplicate_ids:
        errors.append("PRD.md has duplicate requirement definitions: " + ", ".join(duplicate_ids))
    missing_ids = sorted(expected_ids - set(defined_ids))
    unexpected_ids = sorted(set(defined_ids) - expected_ids)
    if missing_ids:
        errors.append("PRD.md is missing requirement definitions: " + ", ".join(missing_ids))
    if unexpected_ids:
        errors.append("PRD.md has unexpected requirement definitions: " + ", ".join(unexpected_ids))

    all_id_mentions = re.findall(
        r"(?:고객확인|투자자보호|민원처리|상품목록|1차발행|국내결제|24시간거래|시장조성|환매|권리관리|배당전환|수량단위|안전통제|감사기록)-\d{2}",
        prd,
    )
    repeated_mentions = sorted(
        {item for item in all_id_mentions if all_id_mentions.count(item) != 1}
    )
    if repeated_mentions:
        errors.append(
            "PRD.md requirement identifiers must appear only in their number cells: "
            + ", ".join(repeated_mentions)
        )

    if "REQ-" in prd or re.search(r"(?<![A-Za-z])[A-Z]{3}-\d{2}(?!\d)", prd):
        errors.append("PRD.md must use readable Korean requirement identifiers, not opaque English codes")

    imported_draft_details = [
        "OnchainID",
        "MockRightsLedger",
        "RFQCoordinator",
        "INV-C",
        "DEC-CUST",
    ]
    found_imported_details = [term for term in imported_draft_details if term in prd]
    if found_imported_details:
        errors.append(
            "PRD.md imports implementation details from the unapproved custody draft: "
            + ", ".join(found_imported_details)
        )

    forbidden_technology_choices = [
        "ERC-20",
        "ERC-3643",
        "ERC-4626",
        "LayerZero",
        "OFT Burn&Mint",
        "Avalanche",
        "Solana",
        "OpenAPI",
        "AsyncAPI",
    ]
    selected_technologies = [term for term in forbidden_technology_choices if term in prd]
    if selected_technologies:
        errors.append(
            "PRD.md selects technologies reserved for later stages: "
            + ", ".join(selected_technologies)
        )

    approval_items = re.findall(r"^- \[x\] ", prd, flags=re.MULTILINE)
    if len(approval_items) < 5:
        errors.append(f"PRD.md must record the alignment approval checklist: found {len(approval_items)}")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") not in {
        "ready_for_stage_four",
        "awaiting_stage_four_approval",
        "ready_for_stage_five",
        "awaiting_stage_five_approval",
        "ready_for_stage_six",
        "awaiting_stage_six_approval",
        "ready_for_stage_seven",
        "awaiting_stage_seven_approval",
        "ready_for_stage_eight",
        "awaiting_stage_eight_approval",
        "ready_for_stage_nine",
        "awaiting_stage_nine_approval",
        "ready_for_stage_ten",
        "stage_ten_in_progress",
        "stages_one_to_five_alignment_review",
    }:
        errors.append("active project state must be at or beyond stage-four review after PRD approval")


def validate_stage_four_contract(errors: list[str]) -> None:
    if not INSTITUTION_WORKFLOWS.is_file() or not REFERENCE_DATA.is_file():
        return  # validate_workspace_contract reports missing required files

    workflows = INSTITUTION_WORKFLOWS.read_text(encoding="utf-8")
    reference = REFERENCE_DATA.read_text(encoding="utf-8")

    for path, text in [
        (INSTITUTION_WORKFLOWS, workflows),
        (REFERENCE_DATA, reference),
    ]:
        if "·" in text:
            errors.append(
                f"{path.name}: use commas or natural conjunctions instead of middle-dot list separators"
            )
        opaque_terms = [term for term in ["RACI", "REQ-", "INV-", "DEC-"] if term in text]
        if opaque_terms:
            errors.append(
                f"{path.name} uses opaque workflow identifiers: " + ", ".join(opaque_terms)
            )

        forbidden_technology_choices = [
            "ERC-20",
            "ERC-3643",
            "ERC-4626",
            "LayerZero",
            "OFT Burn&Mint",
            "Avalanche",
            "Solana",
            "OpenAPI",
            "AsyncAPI",
        ]
        selected_technologies = [
            term for term in forbidden_technology_choices if term in text
        ]
        if selected_technologies:
            errors.append(
                f"{path.name} selects technologies reserved for later stages: "
                + ", ".join(selected_technologies)
            )

    workflow_sections = [
        "1. 이 문서가 정하는 것",
        "2. 업무 설계 원칙",
        "3. 참여 주체와 책임 경계",
        "4. 기준 기록의 관리 주체",
        "5. 기관별 업무 흐름",
        "6. 정상적인 수량 차이와 실제 오류",
        "7. 인계 증거와 정정 원칙",
        "8. PRD 기능 연결 확인",
        "9. 정합성 보완 승인 기준",
    ]
    found_workflow_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", workflows, flags=re.MULTILINE)
    ]
    if found_workflow_sections != workflow_sections:
        errors.append(
            "INSTITUTION_WORKFLOWS.md numbered sections do not match stage four: "
            f"found {found_workflow_sections}"
        )

    required_workflow_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "투자자",
        "토큰 플랫폼",
        "인가 해외 증권사",
        "국내 주문집행 증권사",
        "수탁은행과 상임대리인",
        "KSD 모의 응답 주체",
        "자금과 환전 사업자",
        "지정 시장조성자",
        "준법과 감사 담당",
        "법적 또는 업무상 기준 기록",
        "기관이 확인한 사본",
        "플랫폼이 계산한 결과",
        "토큰 장부는 고객 권리를 보여주고 이전을 통제하는 실행 기록",
        "발행인관리계좌부와 고객관리계좌부",
        "KSD의 자기계좌부와 국내 계좌관리기관의 고객계좌부",
        "인가 해외 증권사 명의로 기록",
        "합성 고객확인과 전용 지갑 연결",
        "상품 등록과 거래 가능 판단",
        "1차 주문 취합, 체결, 권리기입과 토큰 발행",
        "T+2 결제와 수탁수량 확인",
        "지정 시장조성자 기반 24/7 2차거래",
        "시장조성자 헤지와 다음 세션 재고조정",
        "1차 환매, 권리종료, 소각과 USD 지급",
        "현금배당, 의결권과 비현금 기업행동",
        "월별 최종투자자 보고",
        "두 축 수량 대사, 장애 격리와 재개",
        "결제완료 응답만 있고 수탁수량 반영 응답이 없거나 그 반대",
        "환매대금 지급청구",
        "신규 발행과 24/7 거래를 중지",
        "원복",
        "격리",
        "보정",
        "사람 승인",
        "같은 체결, 위험 승인, 권리기입 승인",
        "6단계 설계 입력으로 사용",
    ]
    missing_workflow_terms = [
        term for term in required_workflow_terms if term not in workflows
    ]
    if missing_workflow_terms:
        errors.append(
            "INSTITUTION_WORKFLOWS.md is missing approved responsibilities or workflows: "
            + ", ".join(missing_workflow_terms)
        )

    handoff_header = (
        "| 요청 주체 | 실행 주체 | 승인 주체 | 기준 기록 | 전달 결과 | 실패 시 책임자 |"
    )
    if workflows.count(handoff_header) != 10:
        errors.append(
            "INSTITUTION_WORKFLOWS.md must use the plain-Korean handoff table for all ten workflows: "
            f"found {workflows.count(handoff_header)}"
        )

    workflow_approval_items = re.findall(r"^- \[x\] ", workflows, flags=re.MULTILINE)
    if len(workflow_approval_items) < 5:
        errors.append(
            "INSTITUTION_WORKFLOWS.md must record the alignment approval checklist: "
            f"found {len(workflow_approval_items)}"
        )

    reference_sections = [
        "1. 이 문서가 정하는 것",
        "2. 세 종류의 정보를 분리한다",
        "3. 공식 원본과 관리 책임",
        "4. 종목 기준정보 항목",
        "5. 상품 활성화는 여러 판단을 모두 통과해야 한다",
        "6. 독립적으로 관리할 상태 판단축",
        "7. ISIN 관리 원칙",
        "8. 변경, 적용기간과 정정",
        "9. 현재 보존 스냅샷",
        "10. 자동 검증과 사람 확인",
        "11. 정합성 보완 승인 기준",
    ]
    found_reference_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", reference, flags=re.MULTILINE)
    ]
    if found_reference_sections != reference_sections:
        errors.append(
            "REFERENCE_DATA.md numbered sections do not match stage four: "
            f"found {found_reference_sections}"
        )

    required_reference_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "2026년 8월 28일 KRX KOSPI 200 스냅샷",
        "서로 다른 종목코드 201개",
        "KRX 종목코드",
        "ISIN",
        "국문명",
        "기준일",
        "시장",
        "거래통화",
        "최소 거래단위",
        "KOSPI 200 편입 여부",
        "적용 시작일과 종료일",
        "상장상태",
        "거래정지 상태",
        "기업행동 상태",
        "외국인 한도 적용 여부",
        "수탁 지원 여부",
        "판매 가능 여부",
        "1차 발행 가능 여부",
        "24/7 거래 가능 여부",
        "환매 가능 여부",
        "원본기관",
        "원본 기준시각",
        "수신시각",
        "버전",
        "정정 근거",
        "KRX 지수 포털",
        "한국예탁결제원",
        "KOSPI 200 편입은 PoC 대상 후보를 고르는 첫 조건일 뿐",
        "공식값이 없거나 두 공식값이 다르면",
        "12자리",
        "마지막 1자리는 숫자 검증자리",
        "추측하지 않는다",
        "실제 상품 활성화 데이터로 사용하지 않는다",
        "기존 기록을 덮어쓰지 않는다",
        "마지막 종가, 거래대금, USD/KRW, USDC/USD",
        "1주 = 고객 수탁권리 1단위 = 토큰 1단위",
        "6단계 설계 입력으로 사용",
    ]
    missing_reference_terms = [
        term for term in required_reference_terms if term not in reference
    ]
    if missing_reference_terms:
        errors.append(
            "REFERENCE_DATA.md is missing approved identifiers or controls: "
            + ", ".join(missing_reference_terms)
        )

    expected_representatives = {
        "005930": "삼성전자",
        "000660": "SK하이닉스",
        "017670": "SK텔레콤",
        "005380": "현대차",
        "035420": "NAVER",
        "006800": "미래에셋증권",
    }
    for code, name in expected_representatives.items():
        if code not in reference or name not in reference:
            errors.append(
                f"REFERENCE_DATA.md is missing representative security {code} {name}"
            )

    reference_approval_items = re.findall(r"^- \[x\] ", reference, flags=re.MULTILINE)
    if len(reference_approval_items) < 2:
        errors.append(
            "REFERENCE_DATA.md must record the alignment approval checklist: "
            f"found {len(reference_approval_items)}"
        )

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") not in {
        "ready_for_stage_five",
        "awaiting_stage_five_approval",
        "ready_for_stage_six",
        "awaiting_stage_six_approval",
        "ready_for_stage_seven",
        "awaiting_stage_seven_approval",
        "ready_for_stage_eight",
        "awaiting_stage_eight_approval",
        "ready_for_stage_nine",
        "awaiting_stage_nine_approval",
        "ready_for_stage_ten",
        "stage_ten_in_progress",
        "stages_one_to_five_alignment_review",
    }:
        errors.append("active project state must be at or beyond stage-five preparation after stage-four approval")


def validate_stage_five_contract(errors: list[str]) -> None:
    stage_five_paths = [SCREEN_FLOWS, STATE_MODEL, ERROR_AND_RECOVERY]
    if not all(path.is_file() for path in stage_five_paths):
        return  # validate_workspace_contract reports missing required files

    screens = SCREEN_FLOWS.read_text(encoding="utf-8")
    states = STATE_MODEL.read_text(encoding="utf-8")
    recovery = ERROR_AND_RECOVERY.read_text(encoding="utf-8")

    forbidden_technology_choices = [
        "ERC-20",
        "ERC-3643",
        "ERC-4626",
        "LayerZero",
        "OFT Burn&Mint",
        "Avalanche",
        "Solana",
        "OpenAPI",
        "AsyncAPI",
    ]
    superseded_terms = [
        "고객 간 RFQ",
        "결제 후 발행",
        "결제완료 뒤 토큰 발행",
        "T+2 결제 뒤 토큰 발행",
    ]
    for path, text in [
        (SCREEN_FLOWS, screens),
        (STATE_MODEL, states),
        (ERROR_AND_RECOVERY, recovery),
    ]:
        if "·" in text:
            errors.append(
                f"{path.name}: use commas or natural conjunctions instead of middle-dot list separators"
            )
        opaque_terms = [term for term in ["RACI", "REQ-", "INV-", "DEC-"] if term in text]
        if opaque_terms:
            errors.append(
                f"{path.name} uses opaque workflow identifiers: " + ", ".join(opaque_terms)
            )
        selected_technologies = [
            term for term in forbidden_technology_choices if term in text
        ]
        if selected_technologies:
            errors.append(
                f"{path.name} selects technologies reserved for later stages: "
                + ", ".join(selected_technologies)
            )
        stale = [term for term in superseded_terms if term in text]
        if stale:
            errors.append(
                f"{path.name} revives superseded market or issuance behavior: "
                + ", ".join(stale)
            )

    expected_screen_sections = [
        "1. 이 문서가 정하는 것",
        "2. 모든 화면의 공통 원칙",
        "3. 전체 화면 이동 흐름",
        "4. 투자자 앱 화면",
        "5. 통합 기관 콘솔 공통 틀",
        "6. 통합 기관 콘솔의 역할별 업무공간",
        "7. 화면 사이의 공통 생애주기",
        "8. 인수 시나리오와 화면 연결",
        "9. 정합성 보완 승인 기준",
    ]
    found_screen_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", screens, flags=re.MULTILINE)
    ]
    if found_screen_sections != expected_screen_sections:
        errors.append(
            "SCREEN_FLOWS.md numbered sections do not match stage five: "
            f"found {found_screen_sections}"
        )

    required_screen_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "투자자 앱",
        "통합 기관 콘솔",
        "역할 전환은 시연 편의를 위한 화면 전환",
        "실제 담당자의 실행권한이나 승인권한을 바꾸지 않는다",
        "고객확인, 투자자 보호와 전용 지갑",
        "KOSPI 200 상품목록",
        "종목 상세와 주문 경로 선택",
        "1차 발행 주문과 자금 확인",
        "1차 발행 진행내역",
        "보유권리와 수량 구분",
        "24/7 지정가 주문",
        "24/7 거래 진행내역",
        "환매 요청과 진행내역",
        "배당, 의결권과 기업행동",
        "토큰 플랫폼 운영 업무공간",
        "인가 해외 증권사 업무공간",
        "국내 주문집행 업무공간",
        "수탁은행과 상임대리인 업무공간",
        "지정 시장조성자 업무공간",
        "준법과 감사 업무공간",
        "상품 등록과 기능판정",
        "모의 기관연계",
        "기준 기록",
        "가능한 행동",
        "금지된 행동",
        "차단 사유",
        "감사 증거",
        "KSD와 자금 및 환전기관의 결과는 별도 사용자 화면을 만들지 않고",
        "모든 상태는 하나 이상의 화면에서 확인할 수 있어야 한다",
        "6단계 시스템 구조, 기술 선택과 보안 설계를 시작할 수 있다",
    ]
    missing_screen_terms = [term for term in required_screen_terms if term not in screens]
    if missing_screen_terms:
        errors.append(
            "SCREEN_FLOWS.md is missing required screens or responsibility boundaries: "
            + ", ".join(missing_screen_terms)
        )

    investor_screen_headings = re.findall(
        r"^### 4\.(?:[1-9]|10) .+$", screens, flags=re.MULTILINE
    )
    if len(investor_screen_headings) != 10:
        errors.append(
            "SCREEN_FLOWS.md must define ten investor screens: "
            f"found {len(investor_screen_headings)}"
        )
    institution_workspace_headings = re.findall(
        r"^### 6\.[1-7] .+$", screens, flags=re.MULTILINE
    )
    if len(institution_workspace_headings) != 7:
        errors.append(
            "SCREEN_FLOWS.md must define the overview and six role workspaces: "
            f"found {len(institution_workspace_headings)}"
        )
    screen_approval_items = re.findall(r"^- \[x\] ", screens, flags=re.MULTILINE)
    if len(screen_approval_items) < 5:
        errors.append(
            "SCREEN_FLOWS.md must record the alignment approval checklist: "
            f"found {len(screen_approval_items)}"
        )

    expected_state_sections = [
        "1. 이 문서가 정하는 것",
        "2. 공통 전환 원칙",
        "3. 고객 적격성과 계좌 및 지갑",
        "4. 상품의 기능별 가능 상태",
        "5. 1차 주문, 권리기입, 발행과 T+2",
        "6. 24/7 호가, 자금과 2차거래",
        "7. 시장조성자 재고, 순포지션과 헤지",
        "8. 1차 환매, 권리종료, 소각과 USD 지급",
        "9. 배당, 의결권, 기업행동과 월별 보고",
        "10. 두 축 대사, 중지, 격리와 재개",
        "11. 절대 허용하지 않는 전환과 수량 규칙",
        "12. 상태와 화면 연결",
        "13. 정합성 보완 승인 기준",
    ]
    found_state_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", states, flags=re.MULTILINE)
    ]
    if found_state_sections != expected_state_sections:
        errors.append(
            "STATE_MODEL.md numbered sections do not match stage five: "
            f"found {found_state_sections}"
        )

    required_state_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "하나의 상태값으로 고객, 주문, 권리, 토큰, 자금, 결제와 수탁을 모두 표현하지 않는다",
        "고객 적격성",
        "계좌와 전용 지갑",
        "상품의 기능별 가능 상태",
        "고객 원주문과 국내 체결",
        "권리기입과 토큰 발행",
        "국내 결제와 수탁 확인",
        "지정 시장조성자 호가",
        "24/7 거래",
        "자금경로",
        "시장조성자 재고, 순포지션과 헤지",
        "1차 환매, 권리종료, 소각과 USD 지급",
        "현금배당",
        "의결권",
        "비현금 기업행동",
        "월별 최종투자자 보고",
        "두 축 대사, 중지, 격리와 재개",
        "체결 후 미발행",
        "국내 결제 대기",
        "결제만 확인",
        "수탁만 확인",
        "거래 가능",
        "환매 소각 대기",
        "24/7 USDC 이전의 기술 방식은 이 단계에서 정하지 않는다",
        "위험한도 위반을 줄이는 요청",
        "절대 허용하지 않는 전환과 수량 규칙",
        "상태와 화면 연결",
        "6단계 시스템 구조, 기술 선택과 보안 설계를 시작할 수 있다",
    ]
    missing_state_terms = [term for term in required_state_terms if term not in states]
    if missing_state_terms:
        errors.append(
            "STATE_MODEL.md is missing required state axes or invariants: "
            + ", ".join(missing_state_terms)
        )

    state_table_headers = states.count(
        "| 상태 | 진입 조건 | 다음 상태 | 실행과 승인 | 기준 기록 | 화면 | 허용과 금지 |"
    )
    if state_table_headers < 8:
        errors.append(
            "STATE_MODEL.md must map the major state axes to owners, records and screens: "
            f"found {state_table_headers} full state tables"
        )
    state_rows_with_screen = re.findall(
        r"^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$",
        states,
        flags=re.MULTILINE,
    )
    if len(state_rows_with_screen) < 60:
        errors.append(
            "STATE_MODEL.md must map every detailed state row to a visible screen: "
            f"found {len(state_rows_with_screen)} rows"
        )
    state_approval_items = re.findall(r"^- \[x\] ", states, flags=re.MULTILINE)
    if len(state_approval_items) < 5:
        errors.append(
            "STATE_MODEL.md must record the alignment approval checklist: "
            f"found {len(state_approval_items)}"
        )

    expected_recovery_sections = [
        "1. 이 문서가 정하는 것",
        "2. 오류 처리의 공통 원칙",
        "3. 영향범위와 중지 수준",
        "4. 자동 처리와 사람 검토의 경계",
        "5. 고객, 계좌와 상품 오류",
        "6. 가격, 호가와 시장조성자 오류",
        "7. 1차 발행과 T+2 오류",
        "8. 24/7 거래와 자금 오류",
        "9. 환매와 권리업무 오류",
        "10. 비현금 기업행동과 기준정보 정정",
        "11. 두 축 대사 불일치와 복구 순서",
        "12. 재개 승인 규칙",
        "13. 인수 시나리오와 오류 규칙 연결",
        "14. 정합성 보완 승인 기준",
    ]
    found_recovery_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", recovery, flags=re.MULTILINE)
    ]
    if found_recovery_sections != expected_recovery_sections:
        errors.append(
            "ERROR_AND_RECOVERY.md numbered sections do not match stage five: "
            f"found {found_recovery_sections}"
        )

    required_recovery_terms = [
        "1~5단계 정합성 보완 승인 완료",
        "가능한 가장 좁은 범위만 차단",
        "고객 요청 하나",
        "고객 하나",
        "자금경로 하나",
        "종목 하나",
        "시장조성자 방향 하나",
        "업무 종류",
        "전체 시스템",
        "자동으로 처리할 수 있는 경우",
        "사람 검토가 필요한 경우",
        "기준 기록이 하나라도 확정된 뒤",
        "고객확인 만료",
        "USDC 경로만 중지",
        "호가 만료",
        "위험을 늘리는 방향의 새 호가",
        "권리기입 승인 누락",
        "T+2 위험 승인 누락",
        "결제응답만 확인",
        "수탁응답만 확인",
        "같은 주문 재전송",
        "시스템 재시작",
        "환매와 권리업무 오류",
        "비현금 기업행동과 기준정보 정정",
        "두 축 대사 불일치와 복구 순서",
        "독립된 준법 또는 감사 담당",
        "6단계 시스템 구조, 기술 선택과 보안 설계를 시작할 수 있다",
    ]
    missing_recovery_terms = [
        term for term in required_recovery_terms if term not in recovery
    ]
    if missing_recovery_terms:
        errors.append(
            "ERROR_AND_RECOVERY.md is missing required scope or recovery rules: "
            + ", ".join(missing_recovery_terms)
        )

    full_error_header = (
        "| 상황 | 영향범위 | 고객 안내 | 자동조치 | 사람 책임자 | 필요한 증거 | 재개조건 |"
    )
    if recovery.count(full_error_header) != 5:
        errors.append(
            "ERROR_AND_RECOVERY.md must define complete handling for five error groups: "
            f"found {recovery.count(full_error_header)}"
        )
    full_error_rows = re.findall(
        r"^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$",
        recovery,
        flags=re.MULTILINE,
    )
    if len(full_error_rows) < 40:
        errors.append(
            "ERROR_AND_RECOVERY.md must give scope, action, owner, evidence and resume conditions for each error: "
            f"found {len(full_error_rows)} complete rows"
        )
    recovery_approval_items = re.findall(r"^- \[x\] ", recovery, flags=re.MULTILINE)
    if len(recovery_approval_items) < 5:
        errors.append(
            "ERROR_AND_RECOVERY.md must record the alignment approval checklist: "
            f"found {len(recovery_approval_items)}"
        )

    lifecycle_terms = [
        "고객확인",
        "지갑",
        "상품",
        "1차 발행",
        "T+2",
        "24/7",
        "시장조성자",
        "환매",
        "USD",
        "USDC",
        "배당",
        "의결권",
        "월별 보고",
        "두 축 대사",
        "중복",
        "재개",
        "감사",
    ]
    for term in lifecycle_terms:
        missing_from = [
            path.name
            for path, text in [
                (SCREEN_FLOWS, screens),
                (STATE_MODEL, states),
                (ERROR_AND_RECOVERY, recovery),
            ]
            if term not in text
        ]
        if missing_from:
            errors.append(
                f"stage-five traceability term {term} is missing from: "
                + ", ".join(missing_from)
            )

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") not in {
        "ready_for_stage_six",
        "awaiting_stage_six_approval",
        "ready_for_stage_seven",
        "awaiting_stage_seven_approval",
        "ready_for_stage_eight",
        "awaiting_stage_eight_approval",
        "ready_for_stage_nine",
        "awaiting_stage_nine_approval",
        "ready_for_stage_ten",
        "stage_ten_in_progress",
    }:
        errors.append("active project state must be at or beyond stage-six preparation")


def validate_stage_six_contract(errors: list[str]) -> None:
    stage_six_paths = [ARCHITECTURE, TECHNOLOGY_DECISIONS, SECURITY_AND_PRIVACY]
    if not all(path.is_file() for path in stage_six_paths):
        return  # validate_workspace_contract reports missing required files

    architecture = ARCHITECTURE.read_text(encoding="utf-8")
    technology = TECHNOLOGY_DECISIONS.read_text(encoding="utf-8")
    security = SECURITY_AND_PRIVACY.read_text(encoding="utf-8")

    for path, content in [
        (ARCHITECTURE, architecture),
        (TECHNOLOGY_DECISIONS, technology),
        (SECURITY_AND_PRIVACY, security),
    ]:
        if "상태: **6단계 팀 내부 승인 완료**" not in content:
            errors.append(f"{path.name} must be marked as approved at stage six")
        if "·" in content:
            errors.append(
                f"{path.name}: use commas or natural conjunctions instead of middle-dot list separators"
            )
        opaque_terms = [term for term in ["REQ-", "INV-", "DEC-"] if term in content]
        if opaque_terms:
            errors.append(f"{path.name} uses opaque identifiers: " + ", ".join(opaque_terms))

    expected_architecture_sections = [
        "1. 구조가 지켜야 하는 기준",
        "2. 전체 구조",
        "3. 구성요소와 책임",
        "4. 외부기관 경계",
        "5. 정보가 놓이는 위치",
        "6. 공통 처리 구조",
        "7. 1차 발행과 T+2",
        "8. 24/7 USD 거래",
        "9. 24/7 USDC 거래",
        "10. 시장조성자 헤지와 재고조정",
        "11. 1차 환매",
        "12. 배당, 의결권과 기업행동",
        "13. 대사와 복구",
        "14. 배포 구조",
        "15. 요구사항 연결",
        "16. 범위 밖",
        "17. 승인 기준",
    ]
    found_architecture_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", architecture, flags=re.MULTILINE)
    ]
    if found_architecture_sections != expected_architecture_sections:
        errors.append(
            "ARCHITECTURE.md numbered sections do not match stage six: "
            f"found {found_architecture_sections}"
        )

    required_architecture_terms = [
        "고객별 수탁권리 원장이 최종투자자 권리의 기준 기록",
        "업무별 단일 백엔드",
        "PostgreSQL",
        "트랜잭션 발송함",
        "투자자 앱",
        "통합 기관 콘솔",
        "업무 조정기",
        "기관 모의 어댑터",
        "Avalanche Fuji",
        "실제 기관, 데이터베이스와 블록체인을 하나의 원자적 거래로 묶을 수 있다고 가정하지 않는다",
        "1차 발행과 T+2",
        "24/7 USD 거래",
        "24/7 USDC 거래",
        "시장조성자 헤지와 재고조정",
        "환매대금 지급청구",
        "배당, 의결권과 기업행동",
        "전체 발행토큰 - 환매 소각 대기 토큰",
        "7단계 공통 데이터, API와 이벤트 설계를 시작할 수 있다",
    ]
    missing_architecture_terms = [
        term for term in required_architecture_terms if term not in architecture
    ]
    if missing_architecture_terms:
        errors.append(
            "ARCHITECTURE.md is missing approved boundaries or lifecycle paths: "
            + ", ".join(missing_architecture_terms)
        )

    expected_technology_sections = [
        "1. 선택 원칙",
        "2. 애플리케이션 기술",
        "3. 발행 블록체인",
        "4. 토큰 표준",
        "5. 종목별 배포 구조",
        "6. 온체인 적격성",
        "7. USD와 USDC 정산 기술",
        "8. 외부 정보와 오라클",
        "9. 다중체인",
        "10. 확정하지 않는 세부사항",
        "11. 승인 기준",
    ]
    found_technology_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", technology, flags=re.MULTILINE)
    ]
    if found_technology_sections != expected_technology_sections:
        errors.append(
            "TECHNOLOGY_DECISIONS.md numbered sections do not match stage six: "
            f"found {found_technology_sections}"
        )

    required_technology_terms = [
        "TypeScript 모노레포",
        "Next.js",
        "PostgreSQL",
        "viem",
        "Solidity와 Foundry",
        "Docker Compose",
        "Avalanche Fuji C-Chain",
        "Hyperledger Besu 프라이빗 체인",
        "Base Sepolia",
        "ERC-20 인터페이스 기반 제한형 권리토큰",
        "ERC-3643 전체 구성",
        "일반 `transfer`, `transferFrom`이나 임의 `approve`",
        "EIP-712",
        "소수점 0",
        "KOSPI 200 기준 스냅샷 201개",
        "대표 6종목",
        "6자리 소수점",
        "탈중앙화 가격 오라클을 필수 구성요소로 사용하지 않는다",
        "LayerZero V2 OFT Burn&Mint",
        "상용 메인넷을 Avalanche로 확정한다는 뜻이 아니다",
    ]
    missing_technology_terms = [term for term in required_technology_terms if term not in technology]
    if missing_technology_terms:
        errors.append(
            "TECHNOLOGY_DECISIONS.md is missing selected technologies or rejected alternatives: "
            + ", ".join(missing_technology_terms)
        )

    expected_security_sections = [
        "1. 보호 대상",
        "2. 신뢰 경계",
        "3. 역할과 권한 분리",
        "4. 관리자와 운영키",
        "5. 고객 지갑과 복구",
        "6. 개인정보 최소화",
        "7. 주요 위협과 통제",
        "8. 사건별 중지와 재개",
        "9. 감사와 변경 이력",
        "10. 안전한 개발 기준",
        "11. 보안 인수 시나리오",
        "12. 남는 한계",
        "13. 승인 기준",
    ]
    found_security_sections = [
        match.group(1)
        for match in re.finditer(r"^## ([0-9]+\..+)$", security, flags=re.MULTILINE)
    ]
    if found_security_sections != expected_security_sections:
        errors.append(
            "SECURITY_AND_PRIVACY.md numbered sections do not match stage six: "
            f"found {found_security_sections}"
        )

    required_security_terms = [
        "고객 자기보관 지갑",
        "2-of-3",
        "발행, 정산, 소각, 적격성, 복구와 긴급중지는 서로 다른 키",
        "긴급중지 키는 즉시 중지할 수 있지만 재개할 수 없다",
        "여권번호나 고유식별정보의 해시",
        "공개 체인의 내용은 누구나 볼 수 있다고 전제",
        "무승인 발행",
        "고객 직접이전",
        "발행 승인 재사용",
        "USD 장부와 체인 일부 완료",
        "USDC DvP 뒤 권리 원장 실패",
        "운영키 탈취",
        "관리자 권한 남용",
        "NIST SSDF 1.1",
        "OWASP ASVS",
        "7단계를 시작할 수 있다",
    ]
    missing_security_terms = [term for term in required_security_terms if term not in security]
    if missing_security_terms:
        errors.append(
            "SECURITY_AND_PRIVACY.md is missing required assets, threats, controls or boundaries: "
            + ", ".join(missing_security_terms)
        )

    for path, content, minimum in [
        (ARCHITECTURE, architecture, 5),
        (TECHNOLOGY_DECISIONS, technology, 6),
        (SECURITY_AND_PRIVACY, security, 6),
    ]:
        approved_items = re.findall(r"^- \[x\] ", content, flags=re.MULTILINE)
        if len(approved_items) < minimum:
            errors.append(
                f"{path.name} must record its approved stage-six checklist: "
                f"found {len(approved_items)}"
            )

    combined = "\n".join([architecture, technology, security])
    forbidden_claims = [
        "토큰이 고객 권리의 기준 기록이다",
        "외부기관과 블록체인이 원자적으로 완료된다",
        "실제 개인정보를 사용한다",
        "고객 간 자유이전을 허용한다",
        "상용 메인넷으로 확정",
    ]
    found_forbidden_claims = [claim for claim in forbidden_claims if claim in combined]
    if found_forbidden_claims:
        errors.append(
            "stage-six documents overstate token rights, atomicity, privacy or production scope: "
            + ", ".join(found_forbidden_claims)
        )

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    workflow = WORKFLOW.read_text(encoding="utf-8")
    decisions = DECISIONS.read_text(encoding="utf-8")
    for label, content in [("README", readme), ("WORKFLOW", workflow)]:
        if "6단계" not in content or "7단계" not in content or "승인" not in content:
            errors.append(f"{label} must record stage-six approval and stage-seven readiness")
    for term in [
        "애플리케이션 구조",
        "ERC-20의 잔액, 공급량과 이벤트를 사용하는 제한형 권리토큰",
        "대표 6종목으로 한정",
        "Avalanche Fuji C-Chain",
        "24/7 정산",
        "탈중앙화 가격 오라클",
        "2-of-3",
        "60초 PoC 지연",
    ]:
        if term not in decisions:
            errors.append(f"DECISIONS.md is missing stage-six decision: {term}")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") not in {
        "ready_for_stage_seven", "awaiting_stage_seven_approval", "ready_for_stage_eight",
        "awaiting_stage_eight_approval", "ready_for_stage_nine", "awaiting_stage_nine_approval",
        "ready_for_stage_ten", "stage_ten_in_progress"
    }:
        errors.append("active project state must be at or beyond stage-seven preparation")
    if not isinstance(state.get("iteration"), int) or state["iteration"] < 28:
        errors.append("active project iteration must preserve stage-six approval history")


def validate_stage_seven_contract(errors: list[str]) -> None:
    stage_seven_paths = [DATA_MODEL, API_CONTRACTS, EVENT_CONTRACTS]
    if not all(path.is_file() for path in stage_seven_paths):
        return  # validate_workspace_contract reports missing required files

    documents = {path.name: path.read_text(encoding="utf-8") for path in stage_seven_paths}
    for path, content in [(path, documents[path.name]) for path in stage_seven_paths]:
        if "상태: **7단계 팀 내부 승인 완료**" not in content:
            errors.append(f"{path.name} must be marked as approved at stage seven")
        if "·" in content:
            errors.append(f"{path.name}: use natural conjunctions instead of middle-dot separators")
        opaque_terms = [term for term in ["REQ-", "INV-", "DEC-"] if term in content]
        if opaque_terms:
            errors.append(f"{path.name} uses opaque identifiers: " + ", ".join(opaque_terms))
        approved_items = re.findall(r"^- \[x\] ", content, flags=re.MULTILINE)
        if len(approved_items) < 6:
            errors.append(f"{path.name} must record at least six approved stage-seven checks")

    required_terms = {
        "DATA_MODEL.md": [
            "lowerCamelCase", "UPPER_SNAKE_CASE", "UTC RFC 3339", "Asia/Seoul",
            "정수 문자열", "amountMinor", "KRW", "USD", "USDC", "sourceInstitutionId",
            "sourceRecordId", "correctsEventId", "simulation", "projectionStatus", "EIP-712",
            "43113", "PrimaryOrderIntent", "SecondaryOrderIntent", "RedemptionIntent",
            "MarketMakerQuote", "BrokerSettlementApproval", "고객별 수탁권리 원장",
            "state-catalog.json", "traceability.json",
        ],
        "API_CONTRACTS.md": [
            "/api/v1", "202 Accepted", "Idempotency-Key", "X-Correlation-Id", "409",
            "합성 Bearer", "Ed25519", "RFC 8785", "projectionAsOf", "lastEventSequence",
            "projectionStatus", "WebSocket", "SSE", "재시도 가능", "책임 역할", "다음 행동",
            "/adapter-events", "traceability.json",
        ],
        "EVENT_CONTRACTS.md": [
            "PostgreSQL", "최소 한 번", "eventId", "sourceSequence", "aggregateVersion",
            "workflow.events.v1", "institution.events.v1", "chain.events.v1",
            "reconciliation.events.v1", "audit.events.v1", "quarantine.events.v1",
            "investor-protection.events.v1", "complaint.events.v1",
            "정정", "30초", "60초", "Kafka", "traceability.json",
        ],
    }
    for name, terms in required_terms.items():
        missing = [term for term in terms if term not in documents[name]]
        if missing:
            errors.append(f"{name} is missing stage-seven contract terms: " + ", ".join(missing))

    structured_paths = [
        COMMON_SCHEMA, DOMAIN_SCHEMA, SIGNATURES_SCHEMA, EVENTS_SCHEMA, STATE_CATALOG_SCHEMA,
        STATE_CATALOG, TRACEABILITY, PLATFORM_OPENAPI, ADAPTER_OPENAPI, ASYNCAPI,
        LIFECYCLE_EXAMPLES, FAILURE_EXAMPLES,
        SIGNED_INTENT_EXAMPLES,
    ]
    parsed: dict[Path, object] = {}
    for path in structured_paths:
        try:
            if path.suffix == ".json":
                parsed[path] = json.loads(path.read_text(encoding="utf-8"))
            elif path.suffix == ".jsonl":
                parsed[path] = [
                    json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
                ]
            else:
                parsed[path] = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"stage-seven structured data parse failed: {path.name}: {exc}")
    if len(parsed) != len(structured_paths):
        return

    schema_paths = [COMMON_SCHEMA, DOMAIN_SCHEMA, SIGNATURES_SCHEMA, EVENTS_SCHEMA, STATE_CATALOG_SCHEMA]
    schema_documents = [parsed[path] for path in schema_paths]
    registry = Registry()
    for path, schema in zip(schema_paths, schema_documents):
        try:
            Draft202012Validator.check_schema(schema)
            registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
        except Exception as exc:
            errors.append(f"invalid Draft 2020-12 schema {path.name}: {exc}")

    try:
        catalog_validator = Draft202012Validator(parsed[STATE_CATALOG_SCHEMA], registry=registry)
        for error in catalog_validator.iter_errors(parsed[STATE_CATALOG]):
            errors.append(f"state catalog schema violation: {error.message}")
        event_validator = Draft202012Validator(parsed[EVENTS_SCHEMA], registry=registry)
        for index, event in enumerate(parsed[LIFECYCLE_EXAMPLES], start=1):
            for error in event_validator.iter_errors(event):
                errors.append(f"lifecycle event line {index}: {error.message}")
        signed_intent_validator = Draft202012Validator(
            {"$ref": parsed[SIGNATURES_SCHEMA]["$id"] + "#/$defs/SignedTypedData"},
            registry=registry,
        )
        for index, signed_intent in enumerate(parsed[SIGNED_INTENT_EXAMPLES], start=1):
            for error in signed_intent_validator.iter_errors(signed_intent):
                errors.append(f"signed intent example {index}: {error.message}")
    except Exception as exc:
        errors.append(f"stage-seven schema reference validation failed: {exc}")

    def iter_refs(value: object):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "$ref" and isinstance(child, str):
                    yield child
                else:
                    yield from iter_refs(child)
        elif isinstance(value, list):
            for child in value:
                yield from iter_refs(child)

    def resolve_pointer(document: object, fragment: str) -> bool:
        current = document
        if not fragment or fragment == "#":
            return True
        if not fragment.startswith("#/"):
            return False
        for raw_part in fragment[2:].split("/"):
            part = raw_part.replace("~1", "/").replace("~0", "~")
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return False
        return True

    for path in [PLATFORM_OPENAPI, ADAPTER_OPENAPI, ASYNCAPI, *schema_paths]:
        document = parsed[path]
        for reference in iter_refs(document):
            target, separator, fragment = reference.partition("#")
            if target.startswith(("http://", "https://")):
                continue
            target_path = path if not target else (path.parent / target).resolve()
            if not target_path.is_file():
                errors.append(f"unresolved local reference in {path.name}: {reference}")
                continue
            try:
                if target_path in parsed:
                    target_document = parsed[target_path]
                elif target_path.suffix == ".json":
                    target_document = json.loads(target_path.read_text(encoding="utf-8"))
                else:
                    target_document = yaml.safe_load(target_path.read_text(encoding="utf-8"))
                pointer = f"#{fragment}" if separator else ""
                if pointer and not resolve_pointer(target_document, pointer):
                    errors.append(f"unresolved JSON pointer in {path.name}: {reference}")
            except Exception as exc:
                errors.append(f"failed to inspect reference in {path.name}: {reference}: {exc}")

    openapi_documents = [parsed[PLATFORM_OPENAPI], parsed[ADAPTER_OPENAPI]]
    if any(document.get("openapi") != "3.1.2" for document in openapi_documents):
        errors.append("both OpenAPI documents must use version 3.1.2")
    if parsed[ASYNCAPI].get("asyncapi") != "3.1.0":
        errors.append("AsyncAPI document must use version 3.1.0")

    operation_ids: list[str] = []
    mutating_operations: list[tuple[str, dict]] = []
    for document in openapi_documents:
        for route, path_item in document.get("paths", {}).items():
            for method, operation in path_item.items():
                if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                    continue
                operation_id = operation.get("operationId")
                if operation_id:
                    operation_ids.append(operation_id)
                if method.lower() != "get" and operation_id != "receiveAdapterEvent":
                    mutating_operations.append((operation_id or route, operation))
    duplicate_operation_ids = sorted({item for item in operation_ids if operation_ids.count(item) > 1})
    if duplicate_operation_ids:
        errors.append("duplicate OpenAPI operationIds: " + ", ".join(duplicate_operation_ids))

    for operation_id, operation in mutating_operations:
        if "202" not in operation.get("responses", {}):
            errors.append(f"state-changing operation must return 202: {operation_id}")
        if "409" not in operation.get("responses", {}):
            errors.append(f"state-changing operation must expose idempotency conflict 409: {operation_id}")
        parameter_refs = [parameter.get("$ref", "") for parameter in operation.get("parameters", [])]
        if not any("IdempotencyKey" in ref for ref in parameter_refs):
            errors.append(f"state-changing platform command lacks Idempotency-Key: {operation_id}")
        if not any("CorrelationId" in ref for ref in parameter_refs):
            errors.append(f"state-changing platform command lacks correlation ID: {operation_id}")

    async_messages = parsed[ASYNCAPI].get("components", {}).get("messages", {})
    message_names = [message.get("name") for message in async_messages.values()]
    if None in message_names or len(message_names) != len(set(message_names)):
        errors.append("AsyncAPI component message names must exist and be unique")
    expected_channels = {
        "workflow.events.v1", "institution.events.v1", "chain.events.v1",
        "reconciliation.events.v1", "audit.events.v1", "quarantine.events.v1",
        "investor-protection.events.v1", "complaint.events.v1",
    }
    actual_channels = {channel.get("address") for channel in parsed[ASYNCAPI].get("channels", {}).values()}
    if actual_channels != expected_channels:
        errors.append(f"AsyncAPI logical channels do not match approved set: {sorted(actual_channels)}")

    state_axes = set(parsed[DOMAIN_SCHEMA]["$defs"]["StateCatalogEntry"]["properties"]["axis"]["enum"])
    catalog_entries = parsed[STATE_CATALOG].get("entries", [])
    catalog_axes = {entry.get("axis") for entry in catalog_entries}
    catalog_keys = [(entry.get("axis"), entry.get("code")) for entry in catalog_entries]
    if catalog_axes != state_axes:
        errors.append("state catalog must cover every approved state axis")
    if len(catalog_keys) != len(set(catalog_keys)):
        errors.append("state catalog has duplicate axis and code pairs")

    traceability = parsed[TRACEABILITY]
    trace_axes = {entry.get("axis") for entry in traceability.get("stateAxes", [])}
    if trace_axes != state_axes:
        errors.append("traceability map must cover every state axis")
    known_operations = set(operation_ids)
    known_event_types = set(parsed[EVENTS_SCHEMA]["properties"]["eventType"]["enum"])
    for entry in traceability.get("stateAxes", []):
        referenced_operations = set(entry.get("queryOperationIds", []) + entry.get("commandOperationIds", []))
        if not referenced_operations.issubset(known_operations):
            errors.append(f"traceability has unknown operation for {entry.get('axis')}")
        if not set(entry.get("eventTypes", [])).issubset(known_event_types):
            errors.append(f"traceability has unknown event type for {entry.get('axis')}")
        if not entry.get("queryOperationIds") or not entry.get("eventTypes"):
            errors.append(f"traceability must connect query and event for {entry.get('axis')}")
    required_components = {
        "투자자 앱", "통합 기관 콘솔", "업무 조정기", "인가 해외 증권사 권리원장 모의 모듈",
        "1차 주문 모듈", "24/7 거래 모듈", "시장조성 모듈", "환매 모듈", "권리관리 모듈",
        "대사와 감사 모듈", "블록체인 연계 모듈", "기관 모의 어댑터",
        "PostgreSQL 업무와 증거 저장소", "PostgreSQL 발송함과 재처리기",
    }
    component_entries = traceability.get("architectureComponents", [])
    if {entry.get("component") for entry in component_entries} != required_components:
        errors.append("traceability map must cover every stage-six architecture component")
    if any(not entry.get("interfaces") for entry in component_entries):
        errors.append("every architecture component needs at least one interface")

    forbidden_schema_keys = {
        "passportNumber", "nationality", "taxResidence", "bankAccountNumber",
        "securitiesAccountNumber", "customerName",
    }
    for path in schema_paths:
        keys: set[str] = set()
        stack = [parsed[path]]
        while stack:
            value = stack.pop()
            if isinstance(value, dict):
                keys.update(value.keys())
                stack.extend(value.values())
            elif isinstance(value, list):
                stack.extend(value)
        found_keys = sorted(keys & forbidden_schema_keys)
        if found_keys:
            errors.append(f"{path.name} exposes forbidden personal data fields: {', '.join(found_keys)}")

    expected_failure_cases = {
        "duplicateCommand", "idempotencyBodyConflict", "lateCorrection", "duplicateEvent",
        "eventSequenceGap", "staleMarketData", "fractionalShare", "custodyMissingAfterSettlement",
        "rightsLedgerFailureAfterChain", "forbiddenPii",
    }
    actual_failure_cases = {case.get("case") for case in parsed[FAILURE_EXAMPLES]}
    if actual_failure_cases != expected_failure_cases:
        errors.append(f"failure examples do not match approved cases: {sorted(actual_failure_cases)}")
    signed_primary_types = {item.get("primaryType") for item in parsed[SIGNED_INTENT_EXAMPLES]}
    expected_primary_types = {
        "PrimaryOrderIntent", "SecondaryOrderIntent", "RedemptionIntent",
        "MarketMakerQuote", "BrokerSettlementApproval",
    }
    if signed_primary_types != expected_primary_types:
        errors.append("signed examples must cover all five EIP-712 primary types")
    lifecycle_event_types = {event.get("eventType") for event in parsed[LIFECYCLE_EXAMPLES]}
    expected_lifecycle_events = {
        "primary.execution.recorded.v1", "domestic.settlement.confirmed.v1",
        "custody.position.confirmed.v1", "secondary.trade.completed.v1",
        "market-maker.hedge.requested.v1", "redemption.cash-claim.created.v1",
        "dividend.usd-paid.v1", "vote.execution.recorded.v1", "regulatory-report.submitted.v1",
    }
    if not expected_lifecycle_events.issubset(lifecycle_event_types):
        errors.append("lifecycle examples must cover issuance, T+2, trading, hedge, redemption and rights")
    secondary_payment_modes = {
        event.get("data", {}).get("paymentMode")
        for event in parsed[LIFECYCLE_EXAMPLES]
        if event.get("eventType") == "secondary.trade.completed.v1"
    }
    if secondary_payment_modes != {"USD_LEDGER", "USDC_ONCHAIN"}:
        errors.append("lifecycle examples must cover both USD and USDC 24/7 settlement paths")

    combined = "\n".join(documents.values()) + "\n" + json.dumps(parsed[TRACEABILITY], ensure_ascii=False)
    forbidden_assumptions = [
        "protocol: kafka", "결제 후 발행", "고객 간 RFQ", "토큰이 고객 권리의 기준 기록이다",
    ]
    found_forbidden = [term for term in forbidden_assumptions if term in combined]
    if found_forbidden:
        errors.append("stage-seven contracts revive retired assumptions: " + ", ".join(found_forbidden))

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    workflow = WORKFLOW.read_text(encoding="utf-8")
    decisions = DECISIONS.read_text(encoding="utf-8")
    for label, content in [("README", readme), ("WORKFLOW", workflow)]:
        if "7단계" not in content or "승인" not in content or "8단계" not in content:
            errors.append(f"{label} must record stage-seven approval and stage-eight readiness")
    for term in ["공통 데이터 형식", "API 처리", "이벤트 전달", "기계 명세", "팀 결정 완료"]:
        if term not in decisions:
            errors.append(f"DECISIONS.md is missing stage-seven draft decision: {term}")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") not in {
        "ready_for_stage_eight", "awaiting_stage_eight_approval", "ready_for_stage_nine",
        "awaiting_stage_nine_approval",
        "ready_for_stage_ten",
        "stage_ten_in_progress",
    }:
        errors.append("active project state must preserve stage-seven approval while stage eight advances")
    if not isinstance(state.get("iteration"), int) or state["iteration"] < 30:
        errors.append("active project iteration must preserve stage-seven approval history")


def validate_stage_eight_contract(errors: list[str]) -> None:
    stage_eight_paths = [
        CONTRACT_ARCHITECTURE,
        CONTRACT_INTERFACES,
        ROLES_AND_GOVERNANCE,
        INVARIANTS,
    ]
    if not all(path.is_file() for path in stage_eight_paths) or not all(
        path.is_file() for path in [CONTRACT_MANIFEST, CONTRACT_ABI, GOVERNANCE_ABI, GOVERNANCE_ABI_SCHEMA]
    ):
        return  # validate_workspace_contract reports missing required files

    documents = {path.name: path.read_text(encoding="utf-8") for path in stage_eight_paths}
    for path, content in [(path, documents[path.name]) for path in stage_eight_paths]:
        if "상태: **8단계 팀 내부 승인 완료**" not in content:
            errors.append(f"{path.name} must be marked as approved at stage eight")
        opaque_terms = [term for term in ["REQ-", "INV-", "DEC-"] if term in content]
        if opaque_terms:
            errors.append(f"{path.name} uses opaque identifiers: " + ", ".join(opaque_terms))

    required_terms = {
        "CONTRACT_ARCHITECTURE.md": [
            "고객별 수탁권리 원장", "RestrictedEquityToken", "EligibilityRegistry",
            "SecurityTokenFactory", "IntentVerifier", "IssuanceController",
            "SecondarySettlementController", "RedemptionController", "RecoveryController",
            "CorporateActionController", "MarketPolicyRegistry", "다섯 수량 상태",
            "국내 결제 대기", "환매대금 결제 후 소각 대기", "대표 6종목",
            "LayerZero V2 OFT Burn&Mint", "프록시",
        ],
        "CONTRACT_INTERFACES.md": [
            "balanceOf", "totalSupply", "allowance", "Transfer", "transferFrom", "approve",
            "mintPending", "releasePending", "controlledTransfer",
            "lockForRedemption", "markBurnPending", "burnPending", "recoverAllBuckets",
            "applySplitBatch", "EIP-712", "ERC-1271", "settleUsdLedger", "settleUsdc",
            "부분체결", "EvidenceAlreadyUsed", "IssuanceEvidenceMismatch",
            "AllocationExceeded", "NonIntegralCorporateAction", "기계 판독 ABI",
        ],
        "ROLES_AND_GOVERNANCE.md": [
            "Safe 2-of-3", "60초", "DEFAULT_ADMIN_ROLE",
            "EXECUTION_ALLOCATION_CONFIRMER_ROLE", "RISK_APPROVER_ROLE",
            "RIGHTS_ENTRY_APPROVER_ROLE", "RIGHTS_RECORDING_CONFIRMER_ROLE",
            "SETTLEMENT_CONFIRMER_ROLE", "CUSTODY_CONFIRMER_ROLE",
            "EMERGENCY_PAUSER_ROLE", "독립 사실과 실행", "배포자", "재개",
        ],
        "INVARIANTS.md": [
            "전체\\ 발행량", "고객\\ 수탁권리\\ 합계", "다섯 수량 상태",
            "지갑 복구", "국내 통합계좌 총보유량", "USDC", "nonce", "소각 대기",
            "9단계 필수 반례",
        ],
    }
    for name, terms in required_terms.items():
        missing = [term for term in terms if term not in documents[name]]
        if missing:
            errors.append(f"{name} is missing stage-eight design terms: " + ", ".join(missing))

    try:
        manifest = json.loads(CONTRACT_MANIFEST.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"stage-eight contract manifest parse failed: {exc}")
        return

    if manifest.get("stage") != 8 or manifest.get("status") != "APPROVED":
        errors.append("contract manifest must be stage 8 and approved")
    network = manifest.get("network", {})
    if network.get("chainId") != 43113 or network.get("productionApproval") is not False:
        errors.append("contract manifest must use Fuji chain 43113 without production approval")

    token_model = manifest.get("tokenModel", {})
    expected_buckets = {
        "AVAILABLE", "PENDING_DOMESTIC_SETTLEMENT", "REDEMPTION_LOCKED",
        "BURN_PENDING", "ADMINISTRATIVE_FROZEN",
    }
    if token_model.get("standard") != "RESTRICTED_ERC20_INTERFACE":
        errors.append("contract manifest must use the restricted ERC-20 interface model")
    if token_model.get("decimals") != 0 or set(token_model.get("buckets", [])) != expected_buckets:
        errors.append("contract manifest must define zero decimals and the five approved buckets")
    required_true_flags = [
        "oneShareOneRightOneToken", "directTransferDisabled", "transferFromDisabled",
        "arbitraryApprovalDisabled",
    ]
    if any(token_model.get(flag) is not True for flag in required_true_flags):
        errors.append("contract manifest must block direct transfer and arbitrary approval")
    if (
        token_model.get("erc3643") != "COMPARISON_ONLY"
        or token_model.get("erc4626") != "EXCLUDED"
        or token_model.get("proxyUpgradeability") is not False
    ):
        errors.append("contract manifest revives an excluded token or upgrade model")

    governance = manifest.get("governance", {})
    if (
        governance.get("safeThreshold") != 2
        or governance.get("safeOwners") != 3
        or governance.get("timelockSeconds") != 60
        or governance.get("emergencyPauseCanResume") is not False
        or governance.get("deployerRenouncesAdmin") is not True
    ):
        errors.append("contract manifest governance does not match the approved 2-of-3 and 60-second design")

    expected_contracts = {
        "RestrictedEquityToken", "EligibilityRegistry", "SecurityTokenFactory", "IntentVerifier",
        "IssuanceController", "SecondarySettlementController", "RedemptionController",
        "RecoveryController", "CorporateActionController", "MarketPolicyRegistry",
    }
    contracts = manifest.get("contracts", [])
    contract_names = [contract.get("name") for contract in contracts]
    if set(contract_names) != expected_contracts or len(contract_names) != len(set(contract_names)):
        errors.append("contract manifest must contain each approved contract exactly once")
    function_keys: list[tuple[str, str]] = []
    event_keys: list[tuple[str, str]] = []
    for contract in contracts:
        name = contract.get("name", "")
        functions = contract.get("functions", [])
        events = contract.get("events", [])
        if not functions or not events or len(functions) != len(set(functions)) or len(events) != len(set(events)):
            errors.append(f"contract manifest has missing or duplicate functions/events for {name}")
        function_keys.extend((name, item) for item in functions)
        event_keys.extend((name, item) for item in events)
    if len(function_keys) != len(set(function_keys)) or len(event_keys) != len(set(event_keys)):
        errors.append("contract manifest has duplicate contract-scoped functions or events")

    expected_typed_data = {
        "PRIMARY_LIMIT_ORDER_INTENT", "SECONDARY_INVESTOR_ORDER", "REDEMPTION_INTENT",
        "MARKET_MAKER_QUOTE", "BROKER_SETTLEMENT_APPROVAL",
    }
    typed_data = manifest.get("typedData", {})
    if (
        typed_data.get("verifyingContract") != "IntentVerifier"
        or set(typed_data.get("types", [])) != expected_typed_data
        or typed_data.get("supportsErc1271") is not True
    ):
        errors.append("contract manifest must preserve all five signatures under IntentVerifier")

    required_roles = {
        "DEFAULT_ADMIN_ROLE", "EXECUTION_ALLOCATION_CONFIRMER_ROLE", "RISK_APPROVER_ROLE",
        "RIGHTS_ENTRY_APPROVER_ROLE", "RIGHTS_RECORDING_CONFIRMER_ROLE",
        "SETTLEMENT_CONFIRMER_ROLE", "CUSTODY_CONFIRMER_ROLE", "ISSUANCE_EXECUTOR_ROLE",
        "SETTLEMENT_EXECUTOR_ROLE", "REDEMPTION_RIGHTS_APPROVER_ROLE", "PAYMENT_APPROVER_ROLE",
        "REDEMPTION_EXECUTOR_ROLE", "RECOVERY_RIGHTS_APPROVER_ROLE",
        "RECOVERY_COMPLIANCE_APPROVER_ROLE", "RECOVERY_EXECUTOR_ROLE",
        "CORPORATE_ACTION_RIGHTS_APPROVER_ROLE", "CORPORATE_ACTION_AUDIT_APPROVER_ROLE",
        "CORPORATE_ACTION_EXECUTOR_ROLE", "EMERGENCY_PAUSER_ROLE",
    }
    roles = manifest.get("roles", [])
    if not required_roles.issubset(set(roles)) or len(roles) != len(set(roles)):
        errors.append("contract manifest is missing separated approval and execution roles")

    try:
        abi_spec = json.loads(CONTRACT_ABI.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"stage-eight contract ABI parse failed: {exc}")
        abi_spec = {}
    if abi_spec.get("status") != "APPROVED" or abi_spec.get("networkChainId") != 43113:
        errors.append("contract ABI must be approved for the Fuji PoC chain")
    abi_contracts = {entry.get("name"): entry for entry in abi_spec.get("contracts", [])}
    if set(abi_contracts) != expected_contracts:
        errors.append("contract ABI must define every manifest contract exactly once")
    for contract in contracts:
        name = contract.get("name")
        abi_contract = abi_contracts.get(name, {})
        abi_functions = [entry.get("name") for entry in abi_contract.get("functions", [])]
        abi_events = [entry.get("name") for entry in abi_contract.get("events", [])]
        if abi_functions != contract.get("functions", []):
            errors.append(f"contract ABI functions do not match manifest order for {name}")
        if abi_events != contract.get("events", []):
            errors.append(f"contract ABI events do not match manifest order for {name}")
        for entry in abi_contract.get("functions", []):
            if "stateMutability" not in entry or "inputs" not in entry or "outputs" not in entry:
                errors.append(f"contract ABI function is incomplete: {name}.{entry.get('name')}")
        for entry in abi_contract.get("events", []):
            if any("indexed" not in item for item in entry.get("inputs", [])):
                errors.append(f"contract ABI event lacks indexed flags: {name}.{entry.get('name')}")
    expected_abi_errors = {
        "DirectTransferDisabled", "ApprovalDisabled", "UnauthorizedController", "IneligibleWallet",
        "MarketMakerRequired", "InsufficientAvailableBalance", "ScopePaused", "SignatureExpired",
        "NonceAlreadyUsed", "PolicyVersionMismatch", "EvidenceAlreadyUsed",
        "MissingIndependentApproval", "IssuanceEvidenceMismatch", "AllocationExceeded",
        "PaymentMismatch", "NonIntegralCorporateAction",
    }
    abi_errors = [entry.get("name") for entry in abi_spec.get("errors", [])]
    if set(abi_errors) != expected_abi_errors or len(abi_errors) != len(set(abi_errors)):
        errors.append("contract ABI must define every approved custom error exactly once")
    try:
        governance_abi = json.loads(GOVERNANCE_ABI.read_text(encoding="utf-8"))
        governance_schema = json.loads(GOVERNANCE_ABI_SCHEMA.read_text(encoding="utf-8"))
        validator = Draft202012Validator(governance_schema)
        for issue in validator.iter_errors(governance_abi):
            errors.append(f"governance ABI schema violation: {issue.message}")
    except Exception as exc:
        errors.append(f"governance ABI validation failed: {exc}")
        governance_abi = {}
    if governance_abi.get("status") != "APPROVED" or governance_abi.get("businessAbiReference") != "./contract-abi.json":
        errors.append("governance ABI must be approved and reference the business ABI")
    if set(governance_abi.get("accessControlContracts", [])) != {
        "RestrictedEquityToken", "EligibilityRegistry", "SecurityTokenFactory",
        "IntentVerifier", "MarketPolicyRegistry",
    }:
        errors.append("governance ABI must cover all five foundation contracts")
    allowed_abi_types = {
        "address", "address[]", "bool", "bytes", "bytes16", "bytes32", "string",
        "uint8", "uint256", "PrimaryOrderIntent", "SecondaryOrderIntent",
        "RedemptionIntent", "MarketMakerQuote", "BrokerSettlementApproval",
    }
    abi_items = list(abi_spec.get("structs", []))
    for contract in abi_spec.get("contracts", []):
        abi_items.extend(contract.get("functions", []))
        abi_items.extend(contract.get("events", []))
    abi_items.extend(abi_spec.get("errors", []))
    for item in abi_items:
        arguments = item.get("fields", []) or item.get("inputs", [])
        for argument in arguments:
            if argument.get("type") not in allowed_abi_types:
                errors.append(f"contract ABI uses an unsupported type: {argument.get('type')}")
        for output in item.get("outputs", []):
            if output.get("type") not in allowed_abi_types:
                errors.append(f"contract ABI uses an unsupported output type: {output.get('type')}")
    try:
        signature_schema = json.loads(SIGNATURES_SCHEMA.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"signature schema parse failed during ABI comparison: {exc}")
        signature_schema = {}
    abi_structs = {entry.get("name"): entry for entry in abi_spec.get("structs", [])}
    for struct_name in [
        "PrimaryOrderIntent", "SecondaryOrderIntent", "RedemptionIntent",
        "MarketMakerQuote", "BrokerSettlementApproval",
    ]:
        schema_def = signature_schema.get("$defs", {}).get(struct_name, {})
        schema_properties = schema_def.get("allOf", [{}, {}])[-1].get("properties", {})
        schema_fields = [
            (field_name, field_schema.get("x-solidity-type"))
            for field_name, field_schema in schema_properties.items()
        ]
        abi_fields = [
            (field.get("name"), field.get("type"))
            for field in abi_structs.get(struct_name, {}).get("fields", [])
        ]
        if schema_fields != abi_fields:
            errors.append(f"EIP-712 schema fields do not match contract ABI struct: {struct_name}")

    deployment = manifest.get("deploymentScope", {})
    securities = deployment.get("securities", [])
    expected_codes = {"005930", "000660", "017670", "005380", "035420", "006800"}
    actual_codes = {security.get("krxCode") for security in securities}
    if (
        deployment.get("actualFujiDeploymentCount") != 6
        or deployment.get("requiresOfficialIsin") is not True
        or actual_codes != expected_codes
        or any(security.get("isinStatus") != "OFFICIAL_CONFIRMATION_REQUIRED" for security in securities)
    ):
        errors.append("contract manifest must limit Fuji deployment to six securities pending official ISIN checks")

    combined = "\n".join(documents.values())
    forbidden_assumptions = [
        "ERC-3643 기반 토큰", "ERC-4626 금고", "고객 간 자유이전",
        "토큰이 고객 권리의 기준 기록이다", "업그레이드 가능한 프록시",
    ]
    found_forbidden = [term for term in forbidden_assumptions if term in combined]
    if found_forbidden:
        errors.append("stage-eight design revives retired assumptions: " + ", ".join(found_forbidden))

    decisions = DECISIONS.read_text(encoding="utf-8")
    for term in ["계약 기능 분리", "토큰 수량 상태", "정산 서명 검증", "계약 변경관리", "팀 결정 완료"]:
        if term not in decisions:
            errors.append(f"DECISIONS.md is missing stage-eight draft decision: {term}")

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    workflow = WORKFLOW.read_text(encoding="utf-8")
    for label, content in [("README", readme), ("WORKFLOW", workflow)]:
        if "8단계" not in content or "승인" not in content or "9단계" not in content:
            errors.append(f"{label} must record stage-eight approval and stage-nine readiness")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") not in {
        "ready_for_stage_nine", "awaiting_stage_nine_approval", "ready_for_stage_ten",
        "stage_ten_in_progress",
    }:
        errors.append("active project state must preserve stage-eight approval while stage nine advances")
    if not isinstance(state.get("iteration"), int) or state["iteration"] < 32:
        errors.append("active project iteration must preserve stage-eight approval history")


def validate_stage_nine_contract(errors: list[str]) -> None:
    stage_nine_paths = [TEST_STRATEGY, TEST_SCENARIOS, FIXTURES_AND_EVIDENCE, DEMO_CHECKLIST]
    if not all(path.is_file() for path in stage_nine_paths):
        return  # validate_workspace_contract reports missing required files
    if not all(path.is_file() for path in [
        TEST_CATALOG, TEST_CATALOG_SCHEMA, TEST_FIXTURES,
        TEST_TRACEABILITY, TEST_TRACEABILITY_SCHEMA,
    ]):
        return

    documents = {path.name: path.read_text(encoding="utf-8") for path in stage_nine_paths}
    for path, content in [(path, documents[path.name]) for path in stage_nine_paths]:
        if "상태: **9단계 팀 내부 승인 완료**" not in content:
            errors.append(f"{path.name} must be marked as approved stage-nine design")
        opaque_terms = [term for term in ["REQ-", "INV-", "DEC-", "TEST-"] if term in content]
        if opaque_terms:
            errors.append(f"{path.name} uses opaque identifiers: " + ", ".join(opaque_terms))

    required_terms = {
        "TEST_STRATEGY.md": [
            "Vitest", "PostgreSQL", "Foundry", "Anvil", "Playwright Chromium",
            "빠른 검증", "전체 로컬 검증", "Fuji 시연 검증", "주입 가능한 시계",
            "건너뜀", "자동 재시도", "코드 라인과 분기 커버리지",
        ],
        "TEST_SCENARIOS.md": [
            "발행-정상-01", "결제-차단-01", "정산-DvP실패-01", "정산-원장실패-01",
            "시장조성-경계-01", "재시작-발송함-01", "환매-과도기-01",
            "거버넌스-지연-01", "기업행동-소수차단-01", "Fuji-생애주기-01",
            "공시-동의-01", "민원-정정종결-01", "주문-휴장만료-01",
            "발행-USDC전환-01", "발행-체결배분차단-01", "발행-권리승인차단-01",
            "발행-원장반영차단-01", "발행-증거불일치-01", "결제불이행-예외-01",
            "체결-정정취소-01", "배당-배당락-01", "의결권-승인실패-01",
            "보고-증거누락-01", "모의정보-표시-01", "호가-경계-01",
            "정보-경계-01", "USDC-경계-01", "손실-경계-01",
        ],
        "FIXTURES_AND_EVIDENCE.md": [
            "투자자 A", "투자자 B", "지정 시장조성자", "1,380.3원", "201개",
            "20주 허용", "21주 차단", "60초 허용", "61초 차단", "testRunId",
            "공식 ISIN은 추측하지 않는다",
        ],
        "DEMO_CHECKLIST.md": [
            "9단계 승인 확인", "10단계 구현 착수 전", "로컬 시연 후보 게이트",
            "Fuji 시연 게이트", "시연 직전 사람 확인", "공식 ISIN", "같은 커밋",
        ],
    }
    for name, terms in required_terms.items():
        missing = [term for term in terms if term not in documents[name]]
        if missing:
            errors.append(f"{name} is missing stage-nine test terms: " + ", ".join(missing))

    parsed: dict[Path, object] = {}
    for path in [
        TEST_CATALOG, TEST_CATALOG_SCHEMA, TEST_FIXTURES, TEST_TRACEABILITY,
        TEST_TRACEABILITY_SCHEMA, CONTRACT_MANIFEST, CONTRACT_ABI, GOVERNANCE_ABI,
        STATE_CATALOG,
        PLATFORM_OPENAPI, ADAPTER_OPENAPI, ASYNCAPI,
    ]:
        try:
            if path.suffix in {".yaml", ".yml"}:
                parsed[path] = yaml.safe_load(path.read_text(encoding="utf-8"))
            else:
                parsed[path] = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"stage-nine structured data parse failed: {path.name}: {exc}")
    if len(parsed) != 12:
        return

    catalog = parsed[TEST_CATALOG]
    fixtures = parsed[TEST_FIXTURES]
    traceability = parsed[TEST_TRACEABILITY]
    manifest = parsed[CONTRACT_MANIFEST]
    contract_abi = parsed[CONTRACT_ABI]
    governance_abi = parsed[GOVERNANCE_ABI]
    state_catalog = parsed[STATE_CATALOG]

    for schema_path, document_path in [
        (TEST_CATALOG_SCHEMA, TEST_CATALOG),
        (TEST_TRACEABILITY_SCHEMA, TEST_TRACEABILITY),
    ]:
        validator = Draft202012Validator(parsed[schema_path])
        for issue in sorted(validator.iter_errors(parsed[document_path]), key=lambda item: list(item.path)):
            location = "/".join(str(part) for part in issue.path) or "<root>"
            errors.append(f"{document_path.name} schema violation at {location}: {issue.message}")

    for name, document in [
        ("test catalog", catalog), ("test fixtures", fixtures), ("test traceability", traceability)
    ]:
        if document.get("status") != "APPROVED":
            errors.append(f"{name} must record stage-nine approval")

    groups = catalog.get("groups", [])
    test_cases = [case for group in groups for case in group.get("cases", [])]
    test_ids = [case.get("testId") for case in test_cases]
    if None in test_ids or len(test_ids) != len(set(test_ids)):
        errors.append("test catalog test IDs must exist and be unique")
    if len(test_ids) < 50:
        errors.append(f"test catalog must preserve the detailed scenario set: found {len(test_ids)}")
    for group in groups:
        if not group.get("preconditions") or not group.get("evidence") or not group.get("layers"):
            errors.append(f"test group lacks inherited execution fields: {group.get('groupId')}")
        for case in group.get("cases", []):
            if not case.get("inputs") or not case.get("steps") or not case.get("expectedQuantities"):
                errors.append(f"test case lacks concrete input, steps or expected quantities: {case.get('testId')}")
            if not case.get("expectedStates") or not case.get("startStates"):
                errors.append(f"test case lacks start or expected states: {case.get('testId')}")
            if not case.get("evidence") or not case.get("recoveryOrQuarantine") or not case.get("resumeConditions"):
                errors.append(f"test case lacks evidence or recovery rules: {case.get('testId')}")

    scenario_ids = set(
        re.findall(r"^\|\s*([^|]+-[0-9]{2})\s*\|", documents["TEST_SCENARIOS.md"], flags=re.MULTILINE)
    )
    if scenario_ids != set(test_ids):
        missing_in_catalog = sorted(scenario_ids - set(test_ids))
        missing_in_document = sorted(set(test_ids) - scenario_ids)
        errors.append(
            "test scenario document and catalog IDs differ: catalog missing "
            + ", ".join(missing_in_catalog)
            + "; document missing "
            + ", ".join(missing_in_document)
        )

    prd_text = PRD.read_text(encoding="utf-8")
    prd_requirement_ids = set(re.findall(r"^\|\s*([가-힣0-9]+-[0-9]{2})\s*\|", prd_text, flags=re.MULTILINE))
    requirement_entries = traceability.get("requirements", [])
    traced_requirement_ids = [entry.get("requirementId") for entry in requirement_entries]
    if set(traced_requirement_ids) != prd_requirement_ids or len(traced_requirement_ids) != len(set(traced_requirement_ids)):
        errors.append("stage-nine traceability must cover each PRD requirement exactly once")

    known_test_ids = set(test_ids)

    def check_test_refs(label: str, refs: list[object]) -> None:
        unknown = sorted({ref for ref in refs if isinstance(ref, str)} - known_test_ids)
        if unknown:
            errors.append(f"{label} references unknown tests: " + ", ".join(unknown))

    for entry in requirement_entries:
        positive = entry.get("positiveTests", [])
        negative = entry.get("negativeTests", [])
        if not positive:
            errors.append(f"PRD requirement lacks a positive test: {entry.get('requirementId')}")
        check_test_refs(f"requirement {entry.get('requirementId')}", positive + negative)
        for test_id in positive + negative:
            case = next((item for item in test_cases if item.get("testId") == test_id), {})
            if entry.get("requirementId") not in case.get("requirementIds", []):
                errors.append(
                    f"requirement mapping is not bidirectional: {entry.get('requirementId')} -> {test_id}"
                )
    requirement_test_pairs = {
        (entry.get("requirementId"), test_id)
        for entry in requirement_entries
        for test_id in entry.get("positiveTests", []) + entry.get("negativeTests", [])
    }
    for case in test_cases:
        for requirement_id in case.get("requirementIds", []):
            if (requirement_id, case.get("testId")) not in requirement_test_pairs:
                errors.append(
                    f"test requirement mapping is not bidirectional: {case.get('testId')} -> {requirement_id}"
                )

    catalog_state_keys = {
        (entry.get("axis"), entry.get("code")) for entry in state_catalog.get("entries", [])
    }
    state_entries = traceability.get("states", [])
    traced_state_keys = [(entry.get("axis"), entry.get("stateCode")) for entry in state_entries]
    if set(traced_state_keys) != catalog_state_keys or len(traced_state_keys) != len(set(traced_state_keys)):
        errors.append("stage-nine traceability must map every state code exactly once")
    cases_by_id = {case.get("testId"): case for case in test_cases}
    for entry in state_entries:
        refs = entry.get("tests", []) + entry.get("allowedTransitionTests", []) + entry.get("forbiddenTransitionTests", [])
        check_test_refs(f"state {entry.get('stateCode')}", refs)
        for transition_field in ["allowedTransitionTests", "forbiddenTransitionTests"]:
            for test_id in entry.get(transition_field, []):
                if entry.get("stateCode") not in cases_by_id.get(test_id, {}).get("coveredStateCodes", []):
                    errors.append(
                        f"state transition test does not declare covered state: {entry.get('stateCode')} -> {test_id}"
                    )

    def operation_ids(document: dict) -> set[str]:
        return {
            operation.get("operationId")
            for path_item in document.get("paths", {}).values()
            for method, operation in path_item.items()
            if method.lower() in {"get", "post", "put", "patch", "delete"}
            and isinstance(operation, dict)
        }

    expected_operations = operation_ids(parsed[PLATFORM_OPENAPI]) | operation_ids(parsed[ADAPTER_OPENAPI])
    operation_entries = traceability.get("openApiOperations", [])
    traced_operations = [entry.get("operationId") for entry in operation_entries]
    if set(traced_operations) != expected_operations or len(traced_operations) != len(set(traced_operations)):
        errors.append("stage-nine traceability must map every OpenAPI operation exactly once")
    for entry in operation_entries:
        check_test_refs(f"OpenAPI operation {entry.get('operationId')}", entry.get("tests", []))

    expected_messages = {
        message.get("name")
        for message in parsed[ASYNCAPI].get("components", {}).get("messages", {}).values()
    }
    message_entries = traceability.get("asyncApiMessages", [])
    traced_messages = [entry.get("messageName") for entry in message_entries]
    if set(traced_messages) != expected_messages or len(traced_messages) != len(set(traced_messages)):
        errors.append("stage-nine traceability must map every AsyncAPI message exactly once")
    for entry in message_entries:
        check_test_refs(f"AsyncAPI message {entry.get('messageName')}", entry.get("tests", []))

    expected_function_keys = {
        (contract.get("name"), function)
        for contract in manifest.get("contracts", [])
        for function in contract.get("functions", [])
    }
    function_entries = traceability.get("contractFunctions", [])
    traced_function_keys = [(entry.get("contract"), entry.get("function")) for entry in function_entries]
    if set(traced_function_keys) != expected_function_keys or len(traced_function_keys) != len(set(traced_function_keys)):
        errors.append("stage-nine traceability must map every contract function exactly once")
    for entry in function_entries:
        check_test_refs(
            f"contract function {entry.get('contract')}.{entry.get('function')}", entry.get("tests", [])
        )

    governance_functions = {
        ("AccessControl", entry.get("name"))
        for entry in governance_abi.get("standardAccessControl", {}).get("functions", [])
    } | {
        (extension.get("contract"), entry.get("name"))
        for extension in governance_abi.get("contractExtensions", [])
        for entry in extension.get("functions", [])
    }
    administrative_function_entries = traceability.get("administrativeContractFunctions", [])
    traced_governance_functions = [
        (entry.get("contract"), entry.get("function"))
        for entry in administrative_function_entries
    ]
    if set(traced_governance_functions) != governance_functions or len(traced_governance_functions) != len(set(traced_governance_functions)):
        errors.append("stage-nine traceability must map every administrative contract function exactly once")
    for entry in administrative_function_entries:
        check_test_refs(
            f"administrative function {entry.get('contract')}.{entry.get('function')}",
            entry.get("tests", []),
        )

    expected_event_keys = {
        (contract.get("name"), event)
        for contract in manifest.get("contracts", [])
        for event in contract.get("events", [])
    }
    event_entries = traceability.get("contractEvents", [])
    traced_event_keys = [(entry.get("contract"), entry.get("event")) for entry in event_entries]
    if set(traced_event_keys) != expected_event_keys or len(traced_event_keys) != len(set(traced_event_keys)):
        errors.append("stage-nine traceability must map every contract event exactly once")
    for entry in event_entries:
        check_test_refs(
            f"contract event {entry.get('contract')}.{entry.get('event')}", entry.get("tests", [])
        )

    governance_events = {
        ("AccessControl", entry.get("name"))
        for entry in governance_abi.get("standardAccessControl", {}).get("events", [])
    } | {
        (extension.get("contract"), entry.get("name"))
        for extension in governance_abi.get("contractExtensions", [])
        for entry in extension.get("events", [])
    }
    administrative_event_entries = traceability.get("administrativeContractEvents", [])
    traced_governance_events = [
        (entry.get("contract"), entry.get("event")) for entry in administrative_event_entries
    ]
    if set(traced_governance_events) != governance_events or len(traced_governance_events) != len(set(traced_governance_events)):
        errors.append("stage-nine traceability must map every administrative contract event exactly once")
    for entry in administrative_event_entries:
        check_test_refs(
            f"administrative event {entry.get('contract')}.{entry.get('event')}",
            entry.get("tests", []),
        )

    expected_contract_errors = {entry.get("name") for entry in contract_abi.get("errors", [])}
    contract_error_entries = traceability.get("contractErrors", [])
    traced_contract_errors = [entry.get("error") for entry in contract_error_entries]
    if (
        set(traced_contract_errors) != expected_contract_errors
        or len(traced_contract_errors) != len(set(traced_contract_errors))
    ):
        errors.append("stage-nine traceability must cover every approved contract error exactly once")
    for entry in contract_error_entries:
        check_test_refs(f"contract error {entry.get('error')}", entry.get("tests", []))

    governance_errors = {
        entry.get("name")
        for entry in governance_abi.get("standardAccessControl", {}).get("errors", [])
    } | {
        entry.get("name")
        for extension in governance_abi.get("contractExtensions", [])
        for entry in extension.get("errors", [])
    }
    administrative_error_entries = traceability.get("administrativeContractErrors", [])
    traced_governance_errors = [entry.get("error") for entry in administrative_error_entries]
    if set(traced_governance_errors) != governance_errors or len(traced_governance_errors) != len(set(traced_governance_errors)):
        errors.append("stage-nine traceability must cover every administrative contract error exactly once")
    for entry in administrative_error_entries:
        check_test_refs(f"administrative error {entry.get('error')}", entry.get("tests", []))

    manifest_roles = set(manifest.get("roles", []))
    role_entries = traceability.get("roles", [])
    traced_roles = [entry.get("role") for entry in role_entries]
    if set(traced_roles) != manifest_roles or len(traced_roles) != len(set(traced_roles)):
        errors.append("stage-nine traceability must map every manifest role exactly once")
    for entry in role_entries:
        check_test_refs(f"role {entry.get('role')}", entry.get("tests", []))

    manifest_invariants = set(manifest.get("requiredInvariants", []))
    invariant_entries = traceability.get("invariants", [])
    traced_invariants = [entry.get("invariant") for entry in invariant_entries]
    if set(traced_invariants) != manifest_invariants or len(traced_invariants) != len(set(traced_invariants)):
        errors.append("stage-nine traceability must cover every manifest invariant exactly once")
    for entry in invariant_entries:
        check_test_refs(f"invariant {entry.get('invariant')}", entry.get("tests", []))
    for entry in traceability.get("errorCategories", []):
        if not entry.get("category") or not entry.get("tests"):
            errors.append("every stage-nine error category must have tests")
        check_test_refs(f"error category {entry.get('category')}", entry.get("tests", []))

    if re.search(
        r'"(?:coverageMode|functionCoverage|eventCoverage|roleCoverageMode)"\s*:\s*"ALL_',
        TEST_TRACEABILITY.read_text(encoding="utf-8"),
    ):
        errors.append("stage-nine traceability must not use declarative ALL_* coverage markers")

    if fixtures.get("simulation") is not True or fixtures.get("baselineDate") != "2026-08-28":
        errors.append("stage-nine fixtures must remain simulated and use the approved baseline date")
    universe = fixtures.get("universe", {})
    if universe.get("distinctSecurityCount") != 201 or universe.get("officialIsinRequiredForFuji") is not True:
        errors.append("stage-nine fixtures must preserve the 201-security universe and Fuji ISIN gate")
    fixture_securities = fixtures.get("securities", [])
    expected_codes = {"005930", "000660", "017670", "005380", "035420", "006800"}
    if {item.get("krxCode") for item in fixture_securities} != expected_codes:
        errors.append("stage-nine fixtures must contain the approved six representative securities")
    if any(item.get("isinStatus") != "OFFICIAL_CONFIRMATION_REQUIRED" for item in fixture_securities):
        errors.append("stage-nine fixtures must not invent official ISIN values")

    expected_prices = {
        "005930": ("257000", "18619"), "000660": ("1653000", "119757"),
        "017670": ("98600", "7143"), "005380": ("399500", "28943"),
        "035420": ("220500", "15975"), "006800": ("36150", "2619"),
    }
    actual_prices = {
        item.get("krxCode"): (item.get("closeKrwMinor"), item.get("referenceUsdMinor"))
        for item in fixture_securities
    }
    if actual_prices != expected_prices:
        errors.append("stage-nine fixture prices differ from approved PoC test data")
    market_inputs = fixtures.get("marketInputs", {})
    if (
        market_inputs.get("usdKrw", {}).get("value") != "1380.3"
        or market_inputs.get("usdcUsdMinimum") != "0.9950"
        or market_inputs.get("usdcUsdMaximum") != "1.0050"
        or market_inputs.get("normalHalfSpreadBps") != 50
        or market_inputs.get("stressHalfSpreadBps") != 150
    ):
        errors.append("stage-nine market fixtures differ from approved values")
    mm = fixtures.get("marketMaker", {})
    expected_mm = {
        "settledInventoryPerSecurity": "100", "pendingInventoryPerSecurity": "20",
        "quoteQuantity": "10", "positionLimitAbsolute": "20",
        "perSecurityLossLimitBps": 200, "portfolioLossLimitBps": 150,
        "quoteValidSeconds": 30, "informationAgeAllowedSeconds": 60,
        "informationAgeBlockedSeconds": 61,
    }
    if any(mm.get(key) != value for key, value in expected_mm.items()):
        errors.append("stage-nine market-maker fixtures differ from approved values")
    if (
        mm.get("quoteAllowedAgeSeconds") != 29
        or mm.get("perSecurityLossBeforeLimitBps") != 199
        or mm.get("perSecurityLossAtLimitBps") != 200
        or mm.get("portfolioLossBeforeLimitBps") != 149
        or mm.get("portfolioLossAtLimitBps") != 150
        or market_inputs.get("usdcUsdBelowMinimum") != "0.9949"
        or market_inputs.get("usdcUsdAboveMaximum") != "1.0051"
    ):
        errors.append("stage-nine boundary fixtures must include values immediately before, at and outside each limit")
    expected_issuance_roles = {
        "EXECUTION_ALLOCATION_CONFIRMER_ROLE", "RISK_APPROVER_ROLE",
        "RIGHTS_ENTRY_APPROVER_ROLE", "RIGHTS_RECORDING_CONFIRMER_ROLE",
        "ISSUANCE_EXECUTOR_ROLE",
    }
    actual_issuance_roles = {entry.get("role") for entry in fixtures.get("issuanceRoles", [])}
    if actual_issuance_roles != expected_issuance_roles:
        errors.append("stage-nine fixtures must separate the five issuance fact and execution roles")
    governance = fixtures.get("governance", {})
    if governance != {"safeOwners": 3, "safeThreshold": 2, "timelockSeconds": 60}:
        errors.append("stage-nine governance fixture differs from approved design")

    snapshot = json.loads(KOSPI_SNAPSHOT.read_text(encoding="utf-8"))
    snapshot_rows = snapshot if isinstance(snapshot, list) else snapshot.get("constituents", [])
    snapshot_codes = [str(row.get("code") or row.get("krxCode", "")) for row in snapshot_rows]
    if len(set(snapshot_codes)) != 201:
        errors.append("approved KOSPI snapshot no longer has 201 distinct security codes")

    combined = "\n".join(documents.values())
    forbidden_assumptions = [
        "실제 유동성을 입증", "가격 공정성을 입증", "Firefox와 WebKit을 필수",
        "SQLite를 사용한다", "자동 재시도 1회", "공식 ISIN을 합성",
    ]
    found_forbidden = [term for term in forbidden_assumptions if term in combined]
    if found_forbidden:
        errors.append("stage-nine design revives excluded test assumptions: " + ", ".join(found_forbidden))

    decisions = DECISIONS.read_text(encoding="utf-8")
    for term in ["테스트 계층", "테스트 합격 기준", "Fuji 시연 게이트", "팀 결정 완료"]:
        if term not in decisions:
            errors.append(f"DECISIONS.md is missing approved stage-nine decision: {term}")
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    workflow = WORKFLOW.read_text(encoding="utf-8")
    for label, content in [("README", readme), ("WORKFLOW", workflow)]:
        if (
            "9단계" not in content
            or "승인" not in content
            or "10단계" not in content
            or "구현 중" not in content
        ):
            errors.append(f"{label} must record stage-nine approval and stage-ten implementation")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") != "stage_ten_in_progress":
        errors.append("active project state must record stage-ten implementation in progress")
    if state.get("iteration") != 38:
        errors.append("active project iteration must be 38 for eligibility and investor protection")
    expected_next_action = (
        "Review and commit eligibility and investor protection before implementing primary issuance and T+2 settlement."
    )
    if state.get("next_action") != expected_next_action:
        errors.append("active project next action must proceed to primary issuance after protection review")


def validate_master_regulatory_contract(errors: list[str]) -> None:
    master_path = MASTER
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
            "MASTER.md numbered sections do not match the approved structure: "
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
        "24/7",
        "결제 완료 재고",
        "지정가",
        "순포지션",
        "손실한도",
        "거래중지",
        "헤지 대기열",
        "국내 통합 보유총량",
        "발행인계좌관리기관",
        "연계장부",
        "최종투자자 직접 기록",
        "기존 상장주식",
        "T+2 매도대금 결제",
        "환매 대기열",
        "기준 생애주기",
        "KOSPI 200",
        "대표 6종목",
        "기준일의 공식 KOSPI 200 구성종목 전체",
        "토큰 표준",
        "발행할 블록체인",
        "제휴 플랫폼",
        "토큰 플랫폼",
        "인가 해외 증권사",
        "고객별 수탁권리 원장",
        "토큰 1차시장",
        "토큰 2차시장",
        "비례배분",
        "USD 지급",
        "시스템을 재시작",
        "LayerZero V2 OFT Burn&Mint",
        "불통일 행사",
    ]
    missing_terms = [term for term in required_terms if term not in master]
    if missing_terms:
        errors.append(
            "MASTER.md is missing required Korean securities-ledger concepts: "
            + ", ".join(missing_terms)
        )

    internal_source_ids = sorted(set(re.findall(r"(?<![A-Za-z0-9])S\d{3}(?!\d)", master)))
    if internal_source_ids:
        errors.append(
            "MASTER.md exposes internal source IDs: "
            + ", ".join(internal_source_ids)
        )

    removed_screen_terms = [
        "### 7.6 기관용 2단계 전환 비교 화면",
        "기관용 읽기 전용 화면",
    ]
    present_removed_terms = [term for term in removed_screen_terms if term in master]
    if present_removed_terms:
        errors.append(
            "MASTER.md retains the removed stage-two PoC screen: "
            + ", ".join(present_removed_terms)
        )

    stale_role_terms = [
        "인가 해외 증권사 파트너",
        "인가 파트너",
        "고객 권리 기준장부",
    ]
    present_stale_role_terms = [term for term in stale_role_terms if term in master]
    if present_stale_role_terms:
        errors.append(
            "MASTER.md retains ambiguous or superseded role terms: "
            + ", ".join(present_stale_role_terms)
        )

    stale_issuance_patterns = [
        r"T\+2 결제[·와 ]*수탁 뒤에만 권리를 발행",
        r"결제[·와 ]*수탁 완료를 발행 기준",
        r"결제[·와 ]*수탁 반영 후 발행",
    ]
    for pattern in stale_issuance_patterns:
        if re.search(pattern, master):
            errors.append(
                "MASTER.md retains the superseded post-settlement issuance rule: "
                + pattern
            )

    superseded_poc_patterns = [
        r"24시간 거래는 이번 PoC에 포함하지 않는다",
        r"24시간 거래 \| PoC에서 제외",
        r"### 8\.3 토큰의 추가 가치를 검증하는 기준",
        r"현재 비토큰 통합계좌.*기준선",
        r"비토큰 업무플랫폼 권고",
        r"판매 가능 판정을 통과한 고객 사이의 제한된 RFQ",
    ]
    for pattern in superseded_poc_patterns:
        if re.search(pattern, master):
            errors.append(
                "MASTER.md retains a superseded operational-efficiency or RFQ PoC rule: "
                + pattern
            )


def validate_alignment_approval_contract(errors: list[str]) -> None:
    documents = {
        "MASTER.md": MASTER.read_text(encoding="utf-8"),
        "POC_GOALS.md": POC_GOALS.read_text(encoding="utf-8"),
        "POC_TEST_DATA.md": POC_TEST_DATA.read_text(encoding="utf-8"),
        "PRD.md": PRD.read_text(encoding="utf-8"),
        "INSTITUTION_WORKFLOWS.md": INSTITUTION_WORKFLOWS.read_text(encoding="utf-8"),
        "REFERENCE_DATA.md": REFERENCE_DATA.read_text(encoding="utf-8"),
        "SCREEN_FLOWS.md": SCREEN_FLOWS.read_text(encoding="utf-8"),
        "STATE_MODEL.md": STATE_MODEL.read_text(encoding="utf-8"),
        "ERROR_AND_RECOVERY.md": ERROR_AND_RECOVERY.read_text(encoding="utf-8"),
    }

    for name, text in documents.items():
        if "1~5단계 정합성 보완 승인 완료" not in text:
            errors.append(f"{name} must be marked as alignment approval complete")

    required_by_document = {
        "MASTER.md": [
            "환매대금 지급청구",
            "수탁권리 원장 기입 완료",
            "KRW 지정가격",
            "고객 수탁권리 1단위",
            "다음 달 10일",
            "USDC 전환",
        ],
        "POC_GOALS.md": [
            "환매대금 지급청구",
            "권리기입 완료",
            "KRW 지정가격",
            "고객 수탁권리 1단위",
            "다음 달 10일",
            "USDC 전환",
        ],
        "POC_TEST_DATA.md": [
            "환매 소각 대기",
            "권리기입",
            "당일 유효 지정가",
            "0.5주",
            "다음 달 10일",
            "USDC 전환",
        ],
        "PRD.md": [
            "투자자보호-01",
            "민원처리-01",
            "배당전환-01",
            "수량단위-01",
            "USD 지급청구",
            "권리기입 완료",
            "KRW 지정가격",
            "다음 달 10일",
        ],
        "INSTITUTION_WORKFLOWS.md": [
            "환매대금 지급청구",
            "권리기입 완료",
            "KRW 지정가격",
            "다음 달 10일",
            "USDC 전환",
        ],
        "REFERENCE_DATA.md": [
            "고객 수탁권리 1단위",
            "소수 수량",
            "KRX 거래정지 또는 중요사건",
            "비현금 기업행동",
        ],
        "SCREEN_FLOWS.md": [
            "환매대금 지급청구",
            "권리기입 승인과 실제 원장 기입 완료",
            "KRW 지정가격",
            "민원 처리",
            "다음 달 10일",
            "USDC 전환",
        ],
        "STATE_MODEL.md": [
            "USD 지급청구",
            "권리기입 완료",
            "KRW 지정가격",
            "보호판정",
            "다음 달 10일",
            "USDC 전환",
        ],
        "ERROR_AND_RECOVERY.md": [
            "환매대금 지급청구",
            "권리기입 완료",
            "KRW 지정가격",
            "위험공시 동의",
            "다음 달 10일",
            "USDC 전환",
        ],
    }
    for name, required_terms in required_by_document.items():
        missing = [term for term in required_terms if term not in documents[name]]
        if missing:
            errors.append(f"{name} is missing alignment terms: " + ", ".join(missing))

    all_text = "\n".join(documents.values())
    forbidden_phrases = [
        "시장가 또는 지정가",
        "환매대금 결제 후에도 고객의 주식 수탁권리를 유지",
        "권리기입은 승인됐으나 T+2 위험 승인 전",
    ]
    found_forbidden = [phrase for phrase in forbidden_phrases if phrase in all_text]
    if found_forbidden:
        errors.append(
            "aligned documents retain superseded lifecycle language: "
            + ", ".join(found_forbidden)
        )


def validate_stage_ten_foundation(errors: list[str]) -> None:
    required_paths = [
        REPO_ROOT / "package.json",
        REPO_ROOT / "pnpm-lock.yaml",
        REPO_ROOT / "pnpm-workspace.yaml",
        REPO_ROOT / "compose.yaml",
        REPO_ROOT / "foundry.toml",
        REPO_ROOT / "playwright.config.ts",
        REPO_ROOT / "vitest.config.ts",
        REPO_ROOT / "apps" / "web" / "package.json",
        REPO_ROOT / "apps" / "api" / "package.json",
        REPO_ROOT / "apps" / "mock-institutions" / "package.json",
        REPO_ROOT / "packages" / "domain" / "package.json",
        REPO_ROOT / "packages" / "database" / "package.json",
        REPO_ROOT / "packages" / "contracts-client" / "package.json",
        REPO_ROOT / "packages" / "generated" / "package.json",
        REPO_ROOT / "packages" / "generated" / "src" / "platform-api.ts",
        REPO_ROOT / "packages" / "generated" / "src" / "adapters-api.ts",
        REPO_ROOT / "packages" / "generated" / "src" / "validate-contract-artifacts.ts",
        REPO_ROOT / "packages" / "contracts-client" / "src" / "foundation.ts",
        REPO_ROOT / "contracts" / "src" / "RestrictedEquityToken.sol",
        REPO_ROOT / "contracts" / "src" / "EligibilityRegistry.sol",
        REPO_ROOT / "contracts" / "src" / "SecurityTokenFactory.sol",
        REPO_ROOT / "contracts" / "src" / "IntentVerifier.sol",
        REPO_ROOT / "contracts" / "src" / "MarketPolicyRegistry.sol",
        REPO_ROOT / "contracts" / "script" / "DeployFoundation.s.sol",
        GOVERNANCE_ABI,
        GOVERNANCE_ABI_SCHEMA,
        REPO_ROOT / "docs" / "10-poc-implementation" / "IMPLEMENTATION_GUIDE.md",
        REPO_ROOT / "docs" / "10-poc-implementation" / "TOKEN_FOUNDATION_EVIDENCE.md",
    ]
    missing = [str(path.relative_to(REPO_ROOT)) for path in required_paths if not path.is_file()]
    if missing:
        errors.append("stage-ten runtime foundation is missing files: " + ", ".join(missing))
        return

    package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
    if package.get("packageManager") != "pnpm@10.32.1":
        errors.append("stage-ten foundation must pin pnpm 10.32.1")
    if package.get("engines") != {"node": "24.18.0", "pnpm": "10.32.1"}:
        errors.append("stage-ten foundation must pin the approved Node.js and pnpm engines")

    expected_versions = {
        ("apps/web", "dependencies", "next"): "16.3.3",
        ("apps/web", "dependencies", "react"): "19.2.8",
        ("apps/api", "dependencies", "fastify"): "5.12.1",
        ("packages/database", "dependencies", "drizzle-orm"): "0.45.2",
        ("packages/contracts-client", "dependencies", "viem"): "2.56.0",
    }
    for (directory, dependency_group, dependency), expected in expected_versions.items():
        manifest = json.loads(
            (REPO_ROOT / directory / "package.json").read_text(encoding="utf-8")
        )
        actual = manifest.get(dependency_group, {}).get(dependency)
        if actual != expected:
            errors.append(
                f"{directory} must pin {dependency} {expected}, found {actual}"
            )

    compose = (REPO_ROOT / "compose.yaml").read_text(encoding="utf-8")
    for term in ["postgres:", "anvil:", "postgres:17.6-bookworm", "foundry:v1.7.1"]:
        if term not in compose:
            errors.append(f"stage-ten compose file is missing approved runtime term: {term}")

    guide = (
        REPO_ROOT / "docs" / "10-poc-implementation" / "IMPLEMENTATION_GUIDE.md"
    ).read_text(encoding="utf-8")
    for term in [
        "상태: **10단계 구현 중**", "합성 Bearer", "PostgreSQL", "Anvil",
        "승인된 OpenAPI", "실제 비밀값", "제한형 권리토큰", "Safe 3인 중 2인",
        "업무 ABI", "관리 ABI",
    ]:
        if term not in guide:
            errors.append(f"stage-ten implementation guide is missing: {term}")

    if (REPO_ROOT / ".env").exists():
        errors.append("repository must not contain a local .env file")


def validate_stage_ten_protection(errors: list[str]) -> None:
    required_paths = [
        REPO_ROOT / "packages" / "database" / "migrations" / "0002_customer_product_protection.sql",
        REPO_ROOT / "packages" / "database" / "src" / "seed-protection.ts",
        REPO_ROOT / "packages" / "database" / "src" / "protection.ts",
        REPO_ROOT / "apps" / "api" / "src" / "protection-routes.ts",
        REPO_ROOT / "apps" / "web" / "app" / "investor" / "investor-workspace.tsx",
        REPO_ROOT / "apps" / "web" / "app" / "institution" / "institution-workspace.tsx",
        REPO_ROOT / "packages" / "contracts-client" / "src" / "eligibility.ts",
        REPO_ROOT / "docs" / "10-poc-implementation" / "ELIGIBILITY_AND_PROTECTION_EVIDENCE.md",
    ]
    missing = [str(path.relative_to(REPO_ROOT)) for path in required_paths if not path.is_file()]
    if missing:
        errors.append("stage-ten eligibility and protection implementation is missing: " + ", ".join(missing))
        return

    seed = (REPO_ROOT / "packages" / "database" / "src" / "seed-protection.ts").read_text(encoding="utf-8")
    for term in [
        "KOSPI200-2026-08-28", "SIM-RISK-2", "PRODUCT_SOURCE_CHECKSUM",
        "INFORMATION_UNCONFIRMED", "'DISABLED', 'DISABLED', 'DISABLED'",
    ]:
        if term not in seed:
            errors.append(f"protection seed is missing approved boundary: {term}")
    if seed.count('"005930"') < 1 or seed.count('"006800"') < 1:
        errors.append("protection seed must preserve the representative security set")

    evidence = (
        REPO_ROOT / "docs" / "10-poc-implementation" / "ELIGIBILITY_AND_PROTECTION_EVIDENCE.md"
    ).read_text(encoding="utf-8")
    for term in [
        "201개", "공식 ISIN", "전 종목 거래기능은 차단", "적격성 레지스트리",
        "민원", "모의 환경", "1차 지정가 주문",
    ]:
        if term not in evidence:
            errors.append(f"eligibility and protection evidence is missing: {term}")

    operation_count = 0
    for path in [PLATFORM_OPENAPI, ADAPTER_OPENAPI]:
        openapi = yaml.safe_load(path.read_text(encoding="utf-8"))
        operation_count += sum(
            1
            for item in openapi.get("paths", {}).values()
            for method, operation in item.items()
            if method.lower() in {"get", "post", "put", "patch", "delete"}
            and isinstance(operation, dict)
            and operation.get("operationId")
        )
    if operation_count != 47:
        errors.append(f"protection implementation must preserve 47 OpenAPI operations, found {operation_count}")


def main() -> int:
    errors: list[str] = []
    parse_structured_files(errors)
    validate_source_index(errors)
    validate_markdown_links(errors)
    validate_workspace_contract(errors)
    validate_poc_goals_contract(errors)
    validate_prd_contract(errors)
    validate_stage_four_contract(errors)
    validate_stage_five_contract(errors)
    validate_stage_six_contract(errors)
    validate_stage_seven_contract(errors)
    validate_stage_eight_contract(errors)
    validate_stage_nine_contract(errors)
    validate_stage_ten_foundation(errors)
    validate_stage_ten_protection(errors)
    validate_master_regulatory_contract(errors)
    validate_alignment_approval_contract(errors)

    if errors:
        print("Active research validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Active research workspace, links, metadata, master, PoC, PRD, stage-four through stage-nine contracts, stage-ten restricted token foundation, eligibility and investor protection, "
        "and 16 source checksums passed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
