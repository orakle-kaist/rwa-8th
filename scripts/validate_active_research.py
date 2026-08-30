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
KOSPI_SNAPSHOT = RESEARCH_ROOT / "sources" / "web" / "kospi200-2026-08-28.json"
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
        or "6단계 승인 완료, 7단계 데이터와 연계 설계 착수 가능" not in readme
    ):
        errors.append("README must identify PRD.md and the approved stage-six status")
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
        "ERC-3643 기반 제한형 토큰",
        "일반 `transfer`나 `transferFrom`",
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
        "ERC-3643 기반 제한형 토큰",
        "Avalanche Fuji C-Chain",
        "24/7 정산",
        "탈중앙화 가격 오라클",
        "2-of-3",
    ]:
        if term not in decisions:
            errors.append(f"DECISIONS.md is missing stage-six decision: {term}")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") != "ready_for_stage_seven":
        errors.append("active project state must be ready for stage seven after stage-six approval")
    if state.get("iteration") != 28:
        errors.append("active project iteration must be 28 after stage-six approval")
    expected_next_action = (
        "Start stage seven common data, API, and event design from the approved stage-one-to-six documents."
    )
    if state.get("next_action") != expected_next_action:
        errors.append("active project next action must start stage-seven design from approved inputs")


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
    validate_master_regulatory_contract(errors)
    validate_alignment_approval_contract(errors)

    if errors:
        print("Active research validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Active research workspace, links, metadata, master, PoC, PRD, stage-four through stage-six contracts, "
        "and 16 source checksums passed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
