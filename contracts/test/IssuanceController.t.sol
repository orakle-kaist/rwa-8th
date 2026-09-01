// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {IntentVerifier} from "../src/IntentVerifier.sol";
import {IssuanceController} from "../src/IssuanceController.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {RestrictedEquityToken} from "../src/RestrictedEquityToken.sol";
import {SecurityTokenFactory} from "../src/SecurityTokenFactory.sol";
import {IntentTypes} from "../src/shared/IntentTypes.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {TestBase} from "./TestBase.sol";

contract IssuanceControllerTest is TestBase {
    bytes32 private constant POLICY = keccak256("LOCAL-POLICY-V1");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PRIMARY_TYPEHASH = keccak256("PrimaryOrderIntent(bytes16 orderId,address investor,string securityId,uint256 shareQuantity,uint256 krwLimitPrice,string targetTradingDate,string fundingMode,uint256 fundingAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)");
    uint256 private constant INVESTOR_KEY = 0xA11CE;

    EligibilityRegistry private eligibility;
    MarketPolicyRegistry private policy;
    IntentVerifier private verifier;
    SecurityTokenFactory private factory;
    IssuanceController private controller;
    RestrictedEquityToken private token;
    address private investor;

    function setUp() public {
        vm.warp(1_800_000_000);
        investor = vm.addr(INVESTOR_KEY);
        eligibility = new EligibilityRegistry(address(this));
        policy = new MarketPolicyRegistry(address(this), POLICY);
        verifier = new IntentVerifier(address(this), policy);
        factory = new SecurityTokenFactory(address(this), eligibility, policy);
        address tokenAddress = factory.deploySecurityToken(bytes16(uint128(1)), "990001", "TEST00000001", "Synthetic Primary Scenario", "SIM990001", keccak256("v1"), keccak256("deploy"));
        token = RestrictedEquityToken(tokenAddress);
        controller = new IssuanceController(address(this), verifier, factory);
        eligibility.grantRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE, address(this));
        eligibility.setEligibility(bytes16(uint128(2)), investor, true, block.timestamp + 1 days, keccak256("eligible"));
        verifier.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(controller));
        token.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(controller));
        controller.grantRole(RoleIds.EXECUTION_ALLOCATION_CONFIRMER_ROLE, address(this));
        controller.grantRole(RoleIds.RISK_APPROVER_ROLE, address(this));
        controller.grantRole(RoleIds.RIGHTS_ENTRY_APPROVER_ROLE, address(this));
        controller.grantRole(RoleIds.RIGHTS_RECORDING_CONFIRMER_ROLE, address(this));
        controller.grantRole(RoleIds.SETTLEMENT_CONFIRMER_ROLE, address(this));
        controller.grantRole(RoleIds.CUSTODY_CONFIRMER_ROLE, address(this));
        controller.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(this));
    }

    function test_FourIndependentFactsAreRequiredBeforePendingMintAndBothSettlementFactsBeforeRelease() public {
        bytes16 workflowId = bytes16(uint128(101));
        IntentTypes.PrimaryOrderIntent memory intent = _intent(workflowId, 5, 1);
        controller.confirmExecutionAllocation(workflowId, address(token), investor, 6, 4, keccak256("execution"), keccak256("allocation"));
        vm.expectRevert();
        controller.executePendingMint(workflowId, intent, _signIntent(intent));
        controller.approveT2Risk(workflowId, address(token), investor, 4, keccak256("risk"));
        controller.approveRightsEntry(workflowId, address(token), investor, 4, keccak256("rights-approval"));
        controller.confirmRightsRecorded(workflowId, address(token), investor, 4, keccak256("rights-recorded"));
        controller.executePendingMint(workflowId, intent, _signIntent(intent));
        assertEq(token.pendingSettlementBalanceOf(investor), 4);
        assertEq(token.availableBalanceOf(investor), 0);
        controller.confirmDomesticSettlement(workflowId, address(token), investor, 4, keccak256("settlement"));
        vm.expectRevert();
        controller.executeRelease(workflowId, address(token), investor, 4);
        controller.confirmCustodyQuantity(workflowId, address(token), investor, 4, keccak256("custody"));
        controller.executeRelease(workflowId, address(token), investor, 4);
        assertEq(token.pendingSettlementBalanceOf(investor), 0);
        assertEq(token.availableBalanceOf(investor), 4);
        assertEq(token.totalSupply(), 4);
    }

    function test_ApprovedCorrectionBurnsOnlyPendingQuantityAndCannotReuseEvidence() public {
        bytes16 workflowId = bytes16(uint128(201));
        IntentTypes.PrimaryOrderIntent memory intent = _intent(workflowId, 5, 2);
        controller.confirmExecutionAllocation(workflowId, address(token), investor, 5, 5, keccak256("execution-2"), keccak256("allocation-2"));
        controller.approveT2Risk(workflowId, address(token), investor, 5, keccak256("risk-2"));
        controller.approveRightsEntry(workflowId, address(token), investor, 5, keccak256("rights-approval-2"));
        controller.confirmRightsRecorded(workflowId, address(token), investor, 5, keccak256("rights-recorded-2"));
        controller.executePendingMint(workflowId, intent, _signIntent(intent));
        bytes16 correctionId = bytes16(uint128(202));
        controller.approvePendingCorrection(correctionId, workflowId, address(token), investor, 2, keccak256("correction-approval"));
        controller.confirmPendingRightsCorrection(correctionId, 2, keccak256("correction-recorded"));
        controller.executePendingCorrection(correctionId);
        assertEq(token.pendingSettlementBalanceOf(investor), 3);
        assertEq(token.totalSupply(), 3);
        vm.expectRevert();
        controller.executePendingCorrection(correctionId);
    }

    function _intent(bytes16 orderId, uint256 quantity, uint256 nonce) private view returns (IntentTypes.PrimaryOrderIntent memory) {
        return IntentTypes.PrimaryOrderIntent({orderId:orderId,investor:investor,securityId:"990001",shareQuantity:quantity,krwLimitPrice:257000,targetTradingDate:"2026-08-31",fundingMode:"USD_LEDGER",fundingAmountMinor:93096,nonce:nonce,expiresAt:block.timestamp+1 hours,policyVersion:POLICY});
    }

    function _signIntent(IntentTypes.PrimaryOrderIntent memory intent) private returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(PRIMARY_TYPEHASH,intent.orderId,intent.investor,keccak256(bytes(intent.securityId)),intent.shareQuantity,intent.krwLimitPrice,keccak256(bytes(intent.targetTradingDate)),keccak256(bytes(intent.fundingMode)),intent.fundingAmountMinor,intent.nonce,intent.expiresAt,intent.policyVersion));
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH,keccak256("Korean Equity RWA Intent"),keccak256("1"),block.chainid,address(verifier)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01",domainSeparator,structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(INVESTOR_KEY,digest);
        return abi.encodePacked(r,s,v);
    }
}
