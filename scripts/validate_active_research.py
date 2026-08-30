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
RESEARCH_ROOT = REPO_ROOT / "research" / "korean-equity-rwa"
ARCHIVE_ROOT = REPO_ROOT / "archive" / "pre-prd-v1"
SOURCE_ROOT = RESEARCH_ROOT / "sources" / "user"
SOURCE_INDEX = RESEARCH_ROOT / "_work" / "source_index.jsonl"
POC_GOALS = REPO_ROOT / "POC_GOALS.md"
POC_TEST_DATA = REPO_ROOT / "POC_TEST_DATA.md"
PRD = REPO_ROOT / "PRD.md"
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
        REPO_ROOT / "PROJECT_WORKFLOW.md",
        REPO_ROOT / "PROJECT_DECISIONS.md",
        POC_GOALS,
        POC_TEST_DATA,
        PRD,
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
        POC_GOALS,
        POC_TEST_DATA,
        PRD,
        KOSPI_SNAPSHOT,
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
    if (
        "final_candidate.md" not in readme
        or "승인된" not in readme
        or "마스터" not in readme
    ):
        errors.append("README must identify final_candidate.md as the approved master")
    if "PRD.md" not in readme or "3단계" not in readme or "승인 대기" not in readme:
        errors.append("README must identify PRD.md as the stage-three review draft")

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
        REPO_ROOT / "PROJECT_WORKFLOW.md",
        REPO_ROOT / "PROJECT_DECISIONS.md",
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
        "팀 내부 승인 완료",
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
        "종목별로 취합",
        "비례해 배분",
        "주문 접수시각",
        "T+2 결제차이 위험",
        "국내 결제 대기",
        "결제완료·거래 가능",
        "권리종료",
        "토큰 플랫폼이 같은 수량을 소각",
        "고객 USD 현금계좌",
        "USDC 재전환",
        "수량과 처리 원칙",
        "전체 발행토큰수량",
        "같은 요청번호",
        "시스템 재시작",
        "한 번만 최종 반영",
    ]
    missing_goal_terms = [term for term in required_goal_terms if term not in poc_goals]
    if missing_goal_terms:
        errors.append(
            "POC_GOALS.md is missing the revised end-to-end market contract: "
            + ", ".join(missing_goal_terms)
        )

    required_test_terms = [
        "2단계 승인 시험자료",
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
        REPO_ROOT / "PROJECT_DECISIONS.md",
        RESEARCH_ROOT / "brief.md",
        RESEARCH_ROOT / "drafts" / "final_candidate.md",
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
        "11. 3단계 승인 기준",
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
        "팀 내부 검토안, 승인 대기",
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
        "팀 내부 검토안, 승인 대기",
        "상태 이름 전체 목록",
        "데이터 형식",
        "토큰 표준",
        "발행할 블록체인",
        "스마트컨트랙트 동작",
        "모든 항목이 승인되기 전에는 4단계",
    ]
    missing_terms = [term for term in required_terms if term not in prd]
    if missing_terms:
        errors.append(
            "PRD.md is missing required product boundaries or lifecycle terms: "
            + ", ".join(missing_terms)
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
    }
    expected_ids = {
        f"{family}-{number:02d}"
        for family, count in requirement_families.items()
        for number in range(1, count + 1)
    }
    defined_ids = re.findall(
        r"^\|\s*((?:고객확인|상품목록|1차발행|국내결제|24시간거래|시장조성|환매|권리관리|안전통제|감사기록)-\d{2})\s*\|",
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
        r"(?:고객확인|상품목록|1차발행|국내결제|24시간거래|시장조성|환매|권리관리|안전통제|감사기록)-\d{2}",
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

    approval_items = re.findall(r"^- \[ \] ", prd, flags=re.MULTILINE)
    if len(approval_items) != 8:
        errors.append(f"PRD.md must retain eight unchecked approval items: found {len(approval_items)}")

    state = json.loads((RESEARCH_ROOT / "_work" / "state.json").read_text(encoding="utf-8"))
    if state.get("stage") != "awaiting_prd_approval":
        errors.append("active project state must await PRD approval before stage four")

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

    stale_role_terms = [
        "인가 해외 증권사 파트너",
        "인가 파트너",
        "고객 권리 기준장부",
    ]
    present_stale_role_terms = [term for term in stale_role_terms if term in master]
    if present_stale_role_terms:
        errors.append(
            "final_candidate.md retains ambiguous or superseded role terms: "
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
                "final_candidate.md retains the superseded post-settlement issuance rule: "
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
                "final_candidate.md retains a superseded operational-efficiency or RFQ PoC rule: "
                + pattern
            )


def main() -> int:
    errors: list[str] = []
    parse_structured_files(errors)
    validate_source_index(errors)
    validate_markdown_links(errors)
    validate_workspace_contract(errors)
    validate_poc_goals_contract(errors)
    validate_prd_contract(errors)
    validate_master_regulatory_contract(errors)

    if errors:
        print("Active research validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Active research workspace, links, metadata, master, PoC and PRD contracts, "
        "and 16 source checksums passed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
