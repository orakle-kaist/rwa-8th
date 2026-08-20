@controls @demo_only
Feature: Institutional failure controls
  Every rejected or failed action must be safe, explainable and auditable.

  Background:
    Given the deterministic demo fixture version "1.1.0" is loaded
    And balances and invariant results are captured before each scenario

  Scenario: Expired eligibility blocks a new order
    Given participant "INV_EXPIRED_001" has status "EXPIRED"
    When the participant attempts action "BUY_PRIMARY"
    Then the error code is "ELIGIBILITY_EXPIRED"
    And no protected business state has changed

  Scenario: Sanctions suspension blocks send and receive
    Given participant "INV_SANCTIONED_001" has status "SUSPENDED"
    When the participant attempts to receive an entitlement
    Then the error code is "ELIGIBILITY_SUSPENDED"
    And the audit event contains only an opaque participant ID and reason code

  Scenario: A denied distribution policy stops before the Korean market
    Given the distribution policy decision is "DENY"
    When a primary order is submitted
    Then the error code is "JURISDICTION_POLICY_DENIED"
    And no KRX mock execution request exists

  Scenario: Missing or duplicate account-wallet linkage blocks an order
    Given participant "INV_EXPIRED_001" is bound to a wallet already used by another active linkage
    When an order draft attempts to use that participant and wallet mapping
    Then the error code is "ACCOUNT_LINKAGE_INVALID"
    And no omnibus order, cash reservation or entitlement change exists

  Scenario: Suspended account linkage blocks every value-moving action
    Given an otherwise eligible participant has an account linkage in "SUSPENDED" state
    When the participant attempts action "BUY_PRIMARY"
    Then the error code is "ACCOUNT_LINKAGE_SUSPENDED"
    And no protected business state has changed

  Scenario: Manual review requires two different approvers
    Given a policy decision is "MANUAL_REVIEW"
    When one compliance operator approves it
    Then the error code is "DUAL_CONTROL_REQUIRED"
    When the same principal submits a second approval
    Then the error code is "DUAL_CONTROL_CONFLICT"
    When an independent control principal approves the same payload hash
    Then the eligibility may become "ACTIVE"

  Scenario Outline: Market readiness failures are fail closed
    Given an otherwise valid primary order
    And the market condition is "<condition>"
    When the order is sent to the KRX mock
    Then the error code is "<code>"
    And no execution or entitlement mint exists

    Examples:
      | condition              | code                        |
      | CLOSED                 | MARKET_CLOSED               |
      | QUOTE_EXPIRED          | QUOTE_STALE                 |
      | FOREIGN_ROOM_STALE     | FOREIGN_ROOM_DATA_STALE     |

  Scenario: KT inventory acquisition is rejected when aggregate foreign room is insufficient
    Given "EQ_KT_001" has synthetic aggregate foreign room of 50 shares
    When the Korean broker requests 100 additional shares for foreign inventory
    Then the error code is "FOREIGN_ROOM_INSUFFICIENT"
    And no custody, reserve or supply quantity changes

  Scenario: Foreign-to-foreign secondary transfer does not consume aggregate foreign room
    Given two eligible foreign participants transfer already-backed "EQ_KT_001" entitlements
    When their investor-level and distribution policies allow the transfer
    Then the aggregate foreign room value is unchanged
    And the DvP may settle atomically

  Scenario: Market execution alone cannot support minting
    Given an order has status "AWAITING_CUSTODY_SETTLEMENT"
    And no custody settlement exists
    When the token operator requests minting
    Then the error code is "RESERVE_ATTESTATION_MISSING"
    And the total supply remains 0

  Scenario: A custody evidence record cannot be consumed twice
    Given settlement and reserve evidence already minted 10 units
    When another issuance uses the same evidence with a new issuance ID
    Then the error code is "EVIDENCE_ALREADY_CONSUMED"
    And the total supply remains 10

  Scenario: A terminal partial fill requires human allocation review
    Given a confirmed order requests 10 shares
    And the Korean broker records a terminal cumulative fill of 6 shares and 4 unfilled shares
    When the order and entitlement projections are updated
    Then the error code is "PARTIAL_FILL_REVIEW_REQUIRED"
    And the order status is "PARTIAL_FILL_REVIEW"
    And no entitlement is minted before T+2 settlement of the filled quantity
    And the 4-share unfilled cash reservation is not released twice

  Scenario: A post-trade correction or bust freezes dependent issuance
    Given a market fill is linked to a pending custody settlement and issuance request
    When the Korean broker appends a correction or bust for that fill
    Then the error code is "EXECUTION_CORRECTION_HOLD"
    And the original activity remains in the audit lineage
    And dependent settlement, issuance and redemption stay on hold until re-reconciliation

  Scenario: A missed activity sequence makes the operator projection stale
    Given the local account projection last processed activity sequence 41
    When signed activity sequence 43 arrives before sequence 42
    Then the error code is "PROJECTION_STALE"
    And the operator console shows the last confirmed sequence and as-of time
    And no value-moving command relies on the stale projection

  Scenario: Insufficient cash reverts both legs of DvP
    Given the seller owns 2 available entitlement units
    And the buyer does not own enough mock KRW
    When DvP settlement is attempted
    Then the error code is "INSUFFICIENT_CASH"
    And assetMoved is false
    And cashMoved is false
    And all four party balances equal their captured values

  Scenario: Duplicate KSD event is idempotent
    Given KSD event sequence 7 has been processed
    When the identical signed event is delivered two more times
    Then both deliveries return "EVENT_DUPLICATE"
    And custody and supply change only once

  Scenario: Out-of-order KSD event waits for the missing event
    Given the next expected KSD sequence is 8
    When valid signed KSD sequence 9 arrives
    Then the error code is "EVENT_SEQUENCE_GAP"
    And the dependent order does not advance
    When valid signed KSD sequence 8 arrives
    Then sequence 8 is processed before buffered sequence 9

  Scenario: PII field is rejected before persistence
    Given an otherwise schema-valid event contains a field named "passportHash"
    When the event is submitted
    Then the error code is "PII_FIELD_FORBIDDEN"
    And the event is absent from the ledger, event store and application log body

  Scenario: Reconciliation mismatch places a fail-closed hold
    Given settled custody is 9 and total supply is 10 for one instrument
    When incremental reconciliation runs
    Then the error code is "RECONCILIATION_MISMATCH"
    And system state is "RECONCILIATION_HOLD"
    And mint and secondary DvP return "RECONCILIATION_HOLD_ACTIVE"
    And read-only audit remains available

  Scenario: Recovery needs a full match and two independent approvals
    Given the system is in "RECONCILIATION_HOLD"
    And a signed correction event has been appended
    When full recovery reconciliation passes every mandatory invariant
    And the Korean custodian approves resume
    Then the system remains on hold
    When independent control approves the same resume payload
    Then system state is "RUNNING"

  Scenario: The same principal cannot submit and independently approve an adjustment
    Given one principal submitted a custody residual adjustment
    When the same principal attempts the independent approval
    Then the error code is "SEGREGATION_OF_DUTIES_VIOLATION"
    And the adjustment remains pending without balance changes

  Scenario: An overdue monthly omnibus report blocks new issuance
    Given a required month-end allocation report has no submitted evidence after its due date
    When the token operator requests a new issuance
    Then the error code is "REGULATORY_REPORT_OVERDUE"
    And new issuance remains blocked
    And read-only order, position and reporting evidence remains available

  Scenario: Lost-key recovery is controlled and auditable
    Given an active investor reports a lost wallet key
    When the old wallet is frozen
    And the new wallet completes eligibility checks
    And the custodian and independent control approve a forced transfer
    Then the old wallet available balance is 0
    And the new wallet receives exactly the frozen entitlement quantity
    And one audit lineage links the report, freeze, approval and forced transfer

  Scenario: Public anchor failure does not stop core settlement
    Given the optional public anchor is unavailable
    When a valid atomic DvP is executed on the permissioned ledger
    Then DvP succeeds
    And warning code "ANCHOR_UNAVAILABLE" is queued for retry
