import { describe, expect, it } from "vitest";

import {
  canTransitionComplaint,
  complaintResponsibleInstitution,
  walletOwnershipMessage,
} from "../src/index.js";

describe("투자자 보호 업무 규칙", () => {
  it("민원을 승인된 순서로만 전환한다", () => {
    expect(canTransitionComplaint("SUBMITTED", "ASSIGNED")).toBe(true);
    expect(canTransitionComplaint("ASSIGNED", "CLOSED")).toBe(false);
    expect(canTransitionComplaint("RESPONSE_RECORDED", "CORRECTION_REVIEW")).toBe(true);
  });

  it("기술문의와 증권업무 민원의 책임기관을 분리한다", () => {
    expect(complaintResponsibleInstitution("PLATFORM_TECHNICAL")).toBe("PLATFORM");
    expect(complaintResponsibleInstitution("TRADE_ERROR")).toBe("OVERSEAS_BROKER");
  });

  it("지갑 소유확인 메시지에 고객과 목적을 묶는다", () => {
    expect(walletOwnershipMessage("customer", "0xABC", "LINK")).toBe(
      "K-EQUITY:LINK:customer:0xabc",
    );
  });
});
