@core @demo_only
Feature: Backed Korean equity entitlement lifecycle
  The consortium must demonstrate an end-to-end controlled lifecycle without
  presenting the entitlement as a directly registered share.

  Background:
    Given the deterministic demo fixture version "1.0.0" is loaded
    And the system is not under "RECONCILIATION_HOLD"
    And every displayed market value is labelled "DEMO_ONLY"

  Scenario: Jurisdiction-neutral onboarding uses KR and HK reference decisions
    Given participant "INV_HK_001" has completed offchain KYC
    When policy profile "KR_ASSET_001" evaluates action "BUY_PRIMARY"
    And policy profile "HK_DIST_POLICY_001" evaluates action "BUY_PRIMARY"
    Then both signed decisions are "ALLOW"
    And the eligibility status is "ACTIVE"
    And no shared payload contains restricted PII
    And no core contract branches on jurisdiction code "HK"

  Scenario: AI creates an order draft but cannot confirm it
    Given active participant "INV_HK_001"
    When the AI agent creates a draft to buy 10 units of "EQ_SKHYNIX_001"
    Then the order status is "DRAFT"
    And no market order has been submitted
    And no cash or entitlement balance has changed
    When the human verifies the displayed fields and signs the EIP-712 payload
    Then the order status is "CONFIRMED"
    And the signature nonce is consumed once

  Scenario: Market execution does not mint before T+2 custody settlement
    Given a human-confirmed and funded order for 10 units of "EQ_SKHYNIX_001"
    When the KRX mock records a full execution
    Then the order status is "AWAITING_CUSTODY_SETTLEMENT"
    And the entitlement total supply is 0
    When the simulation clock advances to T+2
    And the KSD mock records settlement of 10 shares
    And the custodian and independent control approve backing of 10 shares
    Then the order status is "BACKED"
    And the entitlement total supply is still 0
    When the token operator submits the issuance request
    Then exactly 10 entitlement units are minted
    And "INV_SUPPLY_BACKING_EQUAL" passes
    And "INV_BACKING_NOT_ABOVE_CUSTODY" passes

  Scenario: Eligible parties settle a secondary RFQ atomically
    Given "INV_HK_001" owns 10 available units of "EQ_SKHYNIX_001"
    And "INV_HK_002" owns sufficient mock KRW
    And both parties have current send and receive policy decisions
    When both humans sign a trade for 2 units
    And the DvP settlement transaction succeeds
    Then the seller entitlement balance decreases by 2
    And the buyer entitlement balance increases by 2
    And the buyer mock KRW balance decreases by the agreed cash amount
    And the seller mock KRW balance increases by the agreed cash amount
    And "INV_DVP_ATOMIC" passes

  Scenario: Cash dividend is allocated from omnibus receipt to eligible holders
    Given a record-date snapshot for "EQ_SKHYNIX_001"
    And the custodian records the synthetic gross dividend receipt
    When offchain tax allocation evidence is recorded
    Then gross received equals tax withheld plus net payable plus fees plus residual
    When the bank mock pays every net amount
    Then the corporate action status is "RECONCILED"
    And no tax identity data appears in shared events

  Scenario: Redemption burns only after underlying disposition and cash readiness
    Given "INV_HK_001" requests redemption of 3 available units
    And current redemption policies allow the request
    When the entitlement units are locked
    Then the total supply has not changed
    When the custodian records completed underlying disposition
    And the bank records cash readiness
    Then exactly 3 entitlement units are burned
    And the investor receives the synthetic cash amount
    And the redemption status is "RECONCILED"

  Scenario: HK distribution profile can be replaced without a core change
    Given the same Korean asset, ledger contracts and API version
    When "HK_DIST_POLICY_001" is disabled
    And another conforming distribution policy profile is registered
    Then the core contract addresses are unchanged
    And no domain schema changes are required
    And the new profile returns the standard PolicyDecision shape
