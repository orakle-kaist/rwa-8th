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

    assert fixture["meta"]["fixtureVersion"] == "1.1.0"

    def indexed(rows: list[dict[str, object]], key: str) -> dict[str, dict[str, object]]:
        values = [str(row[key]) for row in rows]
        if len(values) != len(set(values)):
            raise AssertionError(f"fixture contains duplicate {key}")
        return {str(row[key]): row for row in rows}

    institutions = indexed(fixture["institutions"], "institutionId")
    participants = indexed(fixture["participants"], "participantId")
    accounts = indexed(fixture["institutionalAccounts"], "accountId")
    linkages = indexed(fixture["accountLinkages"], "linkageId")
    products = indexed(fixture["products"], "instrumentId")

    required_institution_roles = {
        "FOREIGN_DISTRIBUTOR",
        "KR_BROKER_CUSTODIAN",
        "SETTLEMENT_BANK",
        "TOKEN_OPERATOR",
        "INDEPENDENT_CONTROL",
        "AUDITOR",
    }
    actual_institution_roles = {str(row["role"]) for row in institutions.values()}
    if not required_institution_roles.issubset(actual_institution_roles):
        raise AssertionError("fixture does not demonstrate every institutional workbench role")

    required_account_types = {
        "ENTITLEMENT_SUBLEDGER",
        "FOREIGN_OMNIBUS_BROKERAGE",
        "STANDING_PROXY_CUSTODY",
        "SETTLEMENT_CASH",
        "CONTROL_RESIDUAL",
    }
    actual_account_types = {str(row["accountType"]) for row in accounts.values()}
    if not required_account_types.issubset(actual_account_types):
        raise AssertionError("fixture does not demonstrate every required institutional account type")

    active_linkages = [row for row in linkages.values() if row["status"] == "ACTIVE"]
    for unique_key in ["participantId", "entitlementAccountRef", "wallet"]:
        values = [str(row[unique_key]).lower() for row in active_linkages]
        if len(values) != len(set(values)):
            raise AssertionError(f"active account linkages violate one-to-one {unique_key}")

    for linkage in active_linkages:
        participant_id = str(linkage["participantId"])
        entitlement_ref = str(linkage["entitlementAccountRef"])
        omnibus_ref = str(linkage["omnibusAccountRef"])
        custody_ref = str(linkage["custodyAccountRef"])
        distributor_id = str(linkage["distributorInstitutionId"])
        if participant_id not in participants or distributor_id not in institutions:
            raise AssertionError("account linkage references an unknown participant or institution")
        if participants[participant_id]["wallet"].lower() != str(linkage["wallet"]).lower():
            raise AssertionError("account linkage wallet differs from the participant's dedicated wallet")
        expected_types = {
            entitlement_ref: "ENTITLEMENT_SUBLEDGER",
            omnibus_ref: "FOREIGN_OMNIBUS_BROKERAGE",
            custody_ref: "STANDING_PROXY_CUSTODY",
        }
        for account_ref, expected_type in expected_types.items():
            if account_ref not in accounts or accounts[account_ref]["accountType"] != expected_type:
                raise AssertionError(
                    f"account linkage {linkage['linkageId']} has invalid {expected_type} reference"
                )

    for position in fixture["custodyPositions"]:
        account_id = str(position["accountId"])
        if account_id not in accounts or accounts[account_id]["accountType"] != "STANDING_PROXY_CUSTODY":
            raise AssertionError("custody position must belong to a standing-proxy custody account")
        if str(position["instrumentId"]) not in products:
            raise AssertionError("custody position references an unknown product")
        settled = int(position["settledQuantity"])
        for quantity_key in [
            "allocatedBackingQuantity",
            "unallocatedQuantity",
            "redemptionPendingQuantity",
            "controlHoldQuantity",
            "issuableQuantity",
        ]:
            if int(position[quantity_key]) > settled:
                raise AssertionError(f"custody position {quantity_key} exceeds settled quantity")
        if position["status"] != "CURRENT" and int(position["issuableQuantity"]) != 0:
            raise AssertionError("stale or held custody position cannot expose issuable quantity")

    active_linkages_by_account = {
        str(linkage["entitlementAccountRef"]): linkage for linkage in active_linkages
    }
    entitlement_position_keys: set[tuple[str, str]] = set()
    for position in fixture["entitlementPositions"]:
        account_ref = str(position["entitlementAccountRef"])
        instrument_id = str(position["instrumentId"])
        position_key = (account_ref, instrument_id)
        if position_key in entitlement_position_keys:
            raise AssertionError("duplicate entitlement position for one account and instrument")
        entitlement_position_keys.add(position_key)
        if account_ref not in accounts or accounts[account_ref]["accountType"] != "ENTITLEMENT_SUBLEDGER":
            raise AssertionError("entitlement position must belong to an entitlement subledger")
        if instrument_id not in products:
            raise AssertionError("entitlement position references an unknown product")
        linkage = active_linkages_by_account.get(account_ref)
        if linkage is None:
            raise AssertionError("entitlement position has no active account linkage")
        if str(position["participantId"]) != str(linkage["participantId"]):
            raise AssertionError("entitlement position participant differs from its account linkage")
        if str(position["wallet"]).lower() != str(linkage["wallet"]).lower():
            raise AssertionError("entitlement position wallet differs from its account linkage")
        component_total = sum(
            int(position[key])
            for key in ["availableQuantity", "lockedQuantity", "settlementEscrowQuantity"]
        )
        if int(position["totalEntitlementQuantity"]) != component_total:
            raise AssertionError("entitlement position components do not equal its total")
        if position["status"] == "CURRENT" and int(position["tokenRecordedQuantity"]) != component_total:
            raise AssertionError("current entitlement position does not match its token record")

    for report in fixture["regulatoryReports"]:
        account_id = str(report["accountId"])
        if account_id not in accounts or accounts[account_id]["accountType"] != "FOREIGN_OMNIBUS_BROKERAGE":
            raise AssertionError("regulatory report must map to a foreign omnibus brokerage account")
        if report["status"] in {"SUBMITTED", "RETAINED"} and report["submittedAt"] is None:
            raise AssertionError("submitted or retained report requires submittedAt evidence")
        if int(str(report["retentionUntil"])[:4]) < int(str(report["reportingPeriod"])[:4]) + 10:
            raise AssertionError("regulatory reporting evidence retention is shorter than ten years")

    normal = fixture["normalScenario"]
    normal_refs = {
        str(normal["participantId"]): participants,
        str(normal["counterpartyId"]): participants,
        str(normal["accountLinkageId"]): linkages,
        str(normal["entitlementAccountRef"]): accounts,
        str(normal["omnibusAccountId"]): accounts,
        str(normal["custodyAccountId"]): accounts,
        str(normal["instrumentId"]): products,
    }
    if any(reference not in collection for reference, collection in normal_refs.items()):
        raise AssertionError("normal scenario contains an unresolved reference")


def validate_operating_model_contract() -> None:
    domain = load_json(ROOT / "specs/schemas/domain.schema.json")
    definitions = domain["$defs"]
    order_required = set(definitions["OrderDraft"]["required"])
    issuance_required = set(definitions["IssuanceRequest"]["required"])
    execution_required = set(definitions["MarketExecution"]["required"])
    if not {"accountLinkageId", "entitlementAccountRef"}.issubset(order_required):
        raise AssertionError("orders must carry account and entitlement lineage")
    if "accountLinkageId" not in issuance_required:
        raise AssertionError("issuance must retain account linkage lineage")
    if not {"marketOrderId", "accountId", "cumulativeQuantity", "leavesQuantity", "sourceRequestId"}.issubset(execution_required):
        raise AssertionError("market execution cannot represent partial-fill accounting and account lineage")

    openapi = yaml.safe_load((ROOT / "specs/openapi.yaml").read_text(encoding="utf-8"))
    required_paths = {
        "/participants/{participantId}/account-linkage",
        "/institutional-accounts/{accountId}",
        "/institutional-accounts/{accountId}/positions",
        "/institutional-accounts/{accountId}/activities",
        "/orders/{orderId}/timeline",
        "/custody-positions",
        "/entitlement-positions",
        "/corporate-actions/{actionId}/allocations",
        "/regulatory-reports",
    }
    missing_paths = sorted(required_paths - set(openapi["paths"]))
    if missing_paths:
        raise AssertionError(f"operational workbench paths are missing: {missing_paths}")

    asyncapi = yaml.safe_load((ROOT / "specs/asyncapi.yaml").read_text(encoding="utf-8"))
    required_channels = {
        "accountLinkages",
        "accountActivities",
        "custodyPositions",
        "entitlementPositions",
        "corporateActionAllocations",
        "regulatoryReports",
    }
    missing_channels = sorted(required_channels - set(asyncapi["channels"]))
    if missing_channels:
        raise AssertionError(f"operational event channels are missing: {missing_channels}")


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

    for path in (ROOT / "specs").rglob("*"):
        if path.name == "traceability-matrix.md":
            continue
        if path.is_file() and path.suffix in {".md", ".yaml", ".json", ".feature"}:
            if "dinari" in path.read_text(encoding="utf-8").lower():
                raise AssertionError(
                    f"Dinari must remain a case study, not a core dependency: {path.relative_to(ROOT)}"
                )

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

    invariant_text = (ROOT / "specs/invariants.md").read_text(encoding="utf-8")
    defined_invariants = set(re.findall(r"`(INV_[A-Z0-9_]+)`", invariant_text))
    used_invariants: set[str] = set()
    for feature in (ROOT / "specs/bdd").glob("*.feature"):
        used_invariants.update(
            re.findall(
                r'"(INV_[A-Z0-9_]+)" passes',
                feature.read_text(encoding="utf-8"),
            )
        )
    missing_invariants = sorted(used_invariants - defined_invariants)
    if missing_invariants:
        raise AssertionError(f"BDD invariants missing from normative definitions: {missing_invariants}")


def validate_candidate_gate() -> None:
    candidate = ROOT / "research/korean-equity-rwa/drafts/final_candidate.md"
    text = candidate.read_text(encoding="utf-8")
    if len(text.strip()) < 12_000:
        raise AssertionError("final candidate is shorter than the examples-level gate")
    if "기관 검토용 마스터 제안서" not in text:
        raise AssertionError("final candidate must identify itself as the human-facing master proposal")

    forbidden_implementation_terms = {
        "JurisdictionPolicy",
        "KRAssetPolicy",
        "HKDistributionPolicy",
        "EntitlementToken",
        "EligibilityRegistry",
        "PolicyRegistry",
        "ReserveRegistry",
        "IssuanceController",
        "DvPSettlement",
        "DepositToken",
        "CorporateActionRegistry",
        "eventId",
        "schemaVersion",
        "occurredAt",
        "effectiveAt",
        "dataAsOf",
        "idempotencyKey",
        "EIP-712",
        "OpenAPI",
        "AsyncAPI",
        "JSON Schema",
        "BDD",
        "totalSupply",
        "tokenizedBackingQuantity",
        "settledCustodyQuantity",
    }
    present = sorted(term for term in forbidden_implementation_terms if term in text)
    if present:
        raise AssertionError(
            f"implementation identifiers leaked into final candidate: {present}"
        )
    if "`" in text:
        raise AssertionError("inline or fenced code markup is not allowed in final candidate")
    if re.search(r"\[S\d{3}\]", text):
        raise AssertionError("internal source IDs must not appear in final candidate")

    required_access_route_terms = {
        "국내 직접계좌",
        "외국인 통합계좌",
        "ADR·GDR",
        "해외 ETF·펀드",
        "합성·파생형 상품",
        "주요 공식 참고자료",
    }
    missing_access_route_terms = sorted(
        term for term in required_access_route_terms if term not in text
    )
    if missing_access_route_terms:
        raise AssertionError(
            f"foreign access route comparison is incomplete: {missing_access_route_terms}"
        )

    required_translation_terms = {
        "Dinari 국제형",
        "Dinari 미국형",
        "권위 있는 기록",
        "투자자 거래 화면",
        "토큰화 운영 콘솔",
        "국내 브로커·수탁 인프라 콘솔",
    }
    missing_translation_terms = sorted(
        term for term in required_translation_terms if term not in text
    )
    if missing_translation_terms:
        raise AssertionError(
            f"Dinari-to-Korea operating model is incomplete: {missing_translation_terms}"
        )

    official_sources = (
        ROOT / "research/korean-equity-rwa/sources/web/official-sources.md"
    ).read_text(encoding="utf-8")
    for required_source in ["S027", "S032", "S037", "S038"]:
        if required_source not in official_sources:
            raise AssertionError(f"missing operating-model evidence note: {required_source}")

    if (ROOT / "research/korean-equity-rwa/review/needs_work.md").exists():
        raise AssertionError("review/needs_work.md exists; folder is not review-ready")


def main() -> None:
    validate_serialization()
    validate_schemas_and_fixture()
    validate_operating_model_contract()
    validate_indexed_sources()
    validate_markdown_links()
    validate_pii_and_neutrality()
    validate_bdd_traceability()
    validate_candidate_gate()
    print("ok: institutional design package passed local validation")


if __name__ == "__main__":
    main()
