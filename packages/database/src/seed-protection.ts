import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

export const PLATFORM_INSTITUTION_ID = "00000000-0000-4000-8000-000000000201";
export const BROKER_INSTITUTION_ID = "00000000-0000-4000-8000-000000000202";
export const CURRENT_DISCLOSURE_ID = "00000000-0000-4000-8000-000000000301";
export const CURRENT_DISCLOSURE_VERSION = "SIM-RISK-2";
export const PRODUCT_REFERENCE_VERSION = "KOSPI200-2026-08-28";
export const PRODUCT_SOURCE_CHECKSUM =
  "41e35498cfb870dab7c3a9eef48e557b342287cd2b5f275208b37351212ba930";

const representativeCodes = new Set(["005930", "000660", "017670", "005380", "035420", "006800"]);

const productNotices = {
  rightsNatureKo:
    "이 상품은 국내 주주명의가 아니라 인가 해외 증권사 고객계좌의 수탁권리를 표시한다.",
  custodyRiskKo:
    "국내 통합계좌와 해외 증권사 권리원장의 분리보관 및 도산 시 권리보호 조건을 확인해야 한다.",
  transferRestrictionKo:
    "적격 투자자와 지정 시장조성자 사이의 승인된 거래만 가능하며 개인 간 자유이전은 허용하지 않는다.",
  settlementKo: "1차 발행 토큰은 국내 T+2 결제와 수탁수량 확인 전까지 거래할 수 없다.",
  dividendKo: "현금배당은 기준일 권리와 국내 수령총액을 확인한 뒤 고객별로 USD 배분한다.",
  votingKo: "의결권 지시는 해외 증권사가 취합하고 상임대리인 경로의 모의 행사 결과를 확인한다.",
  redemptionKo: "환매는 KRX 매도와 T+2 결제 후 권리종료, 토큰 소각과 USD 지급으로 완료된다.",
};

const disclosureSections = [
  {
    code: "RESPONSIBILITY",
    titleKo: "책임기관",
    summaryKo:
      "고객계약, 계좌, 주문과 수탁권리 원장은 인가 해외 증권사가 책임지고 토큰 플랫폼은 요청과 실행을 조정한다.",
  },
  {
    code: "CUSTODY_INSOLVENCY",
    titleKo: "수탁과 도산 위험",
    summaryKo:
      "고객 권리는 해외 증권사 고유재산과 분리해 관리하는 계약 및 장부통제가 필요하며 실제 도산효과는 계약과 관할법 검토 대상이다.",
  },
  {
    code: "TRANSFER_LIMIT",
    titleKo: "이전 제한",
    summaryKo:
      "토큰은 적격 투자자와 지정 시장조성자 사이에서만 이전되고 자유로운 개인 간 전송, DeFi와 래핑은 허용하지 않는다.",
  },
  {
    code: "COST",
    titleKo: "비용",
    summaryKo:
      "환전, 결제, 수탁, 시장조성 및 오프아워 위험 프리미엄이 발생할 수 있으며 PoC 수치는 실제 수수료가 아니다.",
  },
  {
    code: "COMPLAINT",
    titleKo: "민원기관",
    summaryKo: "기술문의는 토큰 플랫폼, 계좌·거래·규제 민원은 인가 해외 증권사가 담당한다.",
  },
];

const customerProfiles = [
  ["00000000-0000-4000-8000-000000000001", "합성 투자자 A", "ELIGIBLE", "PASSED"],
  ["00000000-0000-4000-8000-000000000002", "합성 투자자 B", "ELIGIBLE", "PASSED"],
  ["00000000-0000-4000-8000-000000000003", "합성 거절 고객", "INELIGIBLE", "FAILED"],
  ["00000000-0000-4000-8000-000000000004", "합성 만료 고객", "EXPIRED", "EXPIRED"],
] as const;

interface KospiSnapshot {
  as_of: string;
  row_count: number;
  source: { url: string };
  constituents: Array<{ code: string; name: string }>;
}

export async function seedProtectionData(pool: Pool): Promise<void> {
  const sourceUrl = new URL(
    "../../../research/korean-equity-rwa/sources/web/kospi200-2026-08-28.json",
    import.meta.url,
  );
  const bytes = await readFile(fileURLToPath(sourceUrl));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== PRODUCT_SOURCE_CHECKSUM)
    throw new Error("KOSPI 200 원본 체크섬이 승인값과 다르다.");
  const snapshot = JSON.parse(bytes.toString("utf8")) as KospiSnapshot;
  const distinctCodes = new Set(snapshot.constituents.map((item) => item.code));
  if (snapshot.as_of !== "2026-08-28" || snapshot.row_count !== 201 || distinctCodes.size !== 201) {
    throw new Error("KOSPI 200 기준정보가 승인된 201개 스냅샷과 다르다.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [principalId, displayName, eligibility, protection] of customerProfiles) {
      await client.query(
        `INSERT INTO synthetic_customer_profiles
          (principal_id, display_name, eligibility_status, protection_status, valid_until,
           policy_version, rights_account_reference, responsible_institution_id)
         VALUES ($1, $2, $3, $4, $5, 'SIM-CUSTOMER-1', $6, $7)
         ON CONFLICT (principal_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           eligibility_status = EXCLUDED.eligibility_status,
           protection_status = EXCLUDED.protection_status,
           valid_until = EXCLUDED.valid_until,
           policy_version = EXCLUDED.policy_version`,
        [
          principalId,
          displayName,
          eligibility,
          protection,
          eligibility === "EXPIRED" ? "2026-08-30T00:00:00Z" : "2027-08-31T00:00:00Z",
          `RIGHTS-${principalId.slice(-3)}`,
          BROKER_INSTITUTION_ID,
        ],
      );
    }

    await client.query(
      `INSERT INTO disclosures
        (disclosure_id, version, title_ko, sections, effective_from, valid_until,
         responsible_institution_id, content_evidence_id)
       VALUES ($1, $2, '한국형 수탁 권리토큰 핵심 위험공시', $3::jsonb,
               '2026-08-31T00:00:00Z', '2027-08-31T00:00:00Z', $4, $5)
       ON CONFLICT (version) DO UPDATE SET sections = EXCLUDED.sections, valid_until = EXCLUDED.valid_until`,
      [
        CURRENT_DISCLOSURE_ID,
        CURRENT_DISCLOSURE_VERSION,
        JSON.stringify(disclosureSections),
        BROKER_INSTITUTION_ID,
        "00000000-0000-4000-8000-000000000302",
      ],
    );

    const blockingReasons = [
      {
        code: "OFFICIAL_ISIN_MISSING",
        messageKo: "공식 ISIN 확인 전에는 상품을 활성화할 수 없다.",
      },
      {
        code: "CUSTODY_SUPPORT_UNCONFIRMED",
        messageKo: "수탁기관 지원 여부가 아직 확인되지 않았다.",
      },
      {
        code: "DISTRIBUTION_POLICY_UNCONFIRMED",
        messageKo: "판매 관할 정책이 아직 확정되지 않았다.",
      },
    ];
    for (const item of snapshot.constituents) {
      await client.query(
        `INSERT INTO products
          (security_id, name_ko, reference_version, reference_date, source_url, source_checksum,
           candidate_status, representative, primary_availability, secondary_availability,
           redemption_availability, blocking_reasons, notices)
         VALUES ($1, $2, $3, $4, $5, $6, 'INFORMATION_UNCONFIRMED', $7,
                 'DISABLED', 'DISABLED', 'DISABLED', $8::jsonb, $9::jsonb)
         ON CONFLICT (security_id) DO UPDATE SET
           name_ko = EXCLUDED.name_ko,
           reference_version = EXCLUDED.reference_version,
           reference_date = EXCLUDED.reference_date,
           source_url = EXCLUDED.source_url,
           source_checksum = EXCLUDED.source_checksum,
           representative = EXCLUDED.representative,
           candidate_status = EXCLUDED.candidate_status,
           primary_availability = EXCLUDED.primary_availability,
           secondary_availability = EXCLUDED.secondary_availability,
           redemption_availability = EXCLUDED.redemption_availability,
           blocking_reasons = EXCLUDED.blocking_reasons,
           notices = EXCLUDED.notices`,
        [
          item.code,
          item.name,
          PRODUCT_REFERENCE_VERSION,
          snapshot.as_of,
          snapshot.source.url,
          checksum,
          representativeCodes.has(item.code),
          JSON.stringify(blockingReasons),
          JSON.stringify(productNotices),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
