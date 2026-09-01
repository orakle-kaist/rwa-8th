// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {RestrictedEquityToken} from "../src/RestrictedEquityToken.sol";
import {SecurityTokenFactory} from "../src/SecurityTokenFactory.sol";
import {
    ApprovalDisabled,
    DirectTransferDisabled,
    IneligibleWallet,
    MarketMakerRequired
} from "../src/shared/Errors.sol";
import {PolicyScopes} from "../src/shared/PolicyScopes.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {TestBase} from "./TestBase.sol";

contract RestrictedTokenFoundationTest is TestBase {
    bytes32 private constant POLICY_VERSION = keccak256("policy-v1");
    address private constant INVESTOR = address(0xA11CE);
    address private constant INVESTOR_TWO = address(0xB0B);
    address private constant MARKET_MAKER = address(0xBEEF);

    EligibilityRegistry private eligibility;
    MarketPolicyRegistry private policy;
    RestrictedEquityToken private token;
    uint256 private evidenceSequence;

    function setUp() public {
        vm.warp(1_800_000_000);
        eligibility = new EligibilityRegistry(address(this));
        policy = new MarketPolicyRegistry(address(this), POLICY_VERSION);
        token = new RestrictedEquityToken(
            "Samsung Electronics Custody Right", "K005930", address(this), eligibility, policy
        );

        eligibility.grantRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE, address(this));
        token.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.RECOVERY_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.CORPORATE_ACTION_EXECUTOR_ROLE, address(this));
        policy.grantRole(RoleIds.EMERGENCY_PAUSER_ROLE, address(this));

        _setEligible(INVESTOR);
        _setEligible(INVESTOR_TWO);
        _setEligible(MARKET_MAKER);
        eligibility.setMarketMaker(_workflow(), MARKET_MAKER, true, block.timestamp + 30 days, _evidence());
    }

    function test_MetadataAndDirectErc20ActionsAreRestricted() public {
        assertEq(token.name(), "Samsung Electronics Custody Right");
        assertEq(token.symbol(), "K005930");
        assertEq(token.decimals(), 0);
        assertEq(token.allowance(INVESTOR, address(this)), 0);

        vm.expectRevert(DirectTransferDisabled.selector);
        token.transfer(INVESTOR, 1);
        vm.expectRevert(DirectTransferDisabled.selector);
        token.transferFrom(INVESTOR, MARKET_MAKER, 1);
        vm.expectRevert(ApprovalDisabled.selector);
        token.approve(address(this), 1);
    }

    function test_FiveBucketsAlwaysEqualTotalSupply() public {
        token.mintPending(_workflow(), INVESTOR, 105, _evidence());
        token.releasePending(_workflow(), INVESTOR, 100, _evidence());
        token.lockForRedemption(_workflow(), INVESTOR, 20, _evidence());
        token.markBurnPending(_workflow(), INVESTOR, 10, _evidence());
        token.freezeAvailable(_workflow(), INVESTOR, 10, _evidence());

        uint256 bucketTotal = token.availableBalanceOf(INVESTOR) + token.pendingSettlementBalanceOf(INVESTOR)
            + token.redemptionLockedBalanceOf(INVESTOR) + token.burnPendingBalanceOf(INVESTOR)
            + token.administrativeFrozenBalanceOf(INVESTOR);
        assertEq(bucketTotal, 105);
        assertEq(token.balanceOf(INVESTOR), 105);
        assertEq(token.totalSupply(), 105);

        token.burnPending(_workflow(), INVESTOR, 10, _evidence());
        assertEq(token.totalSupply(), 95);
        assertEq(token.balanceOf(INVESTOR), 95);
    }

    function test_ControlledTransferRequiresExactlyOneMarketMaker() public {
        token.mintPending(_workflow(), INVESTOR, 20, _evidence());
        token.releasePending(_workflow(), INVESTOR, 20, _evidence());
        token.controlledTransfer(_workflow(), INVESTOR, MARKET_MAKER, 7, _evidence());
        assertEq(token.availableBalanceOf(INVESTOR), 13);
        assertEq(token.availableBalanceOf(MARKET_MAKER), 7);

        vm.expectRevert(abi.encodeWithSelector(MarketMakerRequired.selector, INVESTOR_TWO));
        token.controlledTransfer(_workflow(), INVESTOR, INVESTOR_TWO, 1, _evidence());

        address ineligible = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(IneligibleWallet.selector, ineligible));
        token.controlledTransfer(_workflow(), INVESTOR, ineligible, 1, _evidence());
    }

    function test_UnauthorizedWalletCannotMintTransferOrBurn() public {
        address attacker = address(0xBAD0);
        vm.startPrank(attacker);
        vm.expectRevert();
        token.mintPending(_workflow(), INVESTOR, 1, _evidence());
        vm.expectRevert();
        token.controlledTransfer(_workflow(), INVESTOR, MARKET_MAKER, 1, _evidence());
        vm.expectRevert();
        token.burnPending(_workflow(), INVESTOR, 1, _evidence());
        vm.stopPrank();
    }

    function test_RecoveryPreservesEveryBucketAndSupply() public {
        token.mintPending(_workflow(), INVESTOR, 30, _evidence());
        token.releasePending(_workflow(), INVESTOR, 25, _evidence());
        token.lockForRedemption(_workflow(), INVESTOR, 5, _evidence());
        token.freezeAvailable(_workflow(), INVESTOR, 4, _evidence());
        token.freezeAddress(_workflow(), INVESTOR, true, _evidence());

        uint256 beforeSupply = token.totalSupply();
        token.recoverAllBuckets(_workflow(), INVESTOR, INVESTOR_TWO, _evidence());
        assertEq(token.balanceOf(INVESTOR), 0);
        assertEq(token.availableBalanceOf(INVESTOR_TWO), 16);
        assertEq(token.pendingSettlementBalanceOf(INVESTOR_TWO), 5);
        assertEq(token.redemptionLockedBalanceOf(INVESTOR_TWO), 5);
        assertEq(token.administrativeFrozenBalanceOf(INVESTOR_TWO), 4);
        assertEq(token.totalSupply(), beforeSupply);
    }

    function test_SplitRequiresPausedScopesAndPreservesIntegerBuckets() public {
        token.mintPending(_workflow(), INVESTOR, 10, _evidence());
        token.releasePending(_workflow(), INVESTOR, 8, _evidence());
        token.lockForRedemption(_workflow(), INVESTOR, 2, _evidence());
        token.markBurnPending(_workflow(), INVESTOR, 1, _evidence());
        token.freezeAvailable(_workflow(), INVESTOR, 2, _evidence());
        _pause(PolicyScopes.ISSUANCE);
        _pause(PolicyScopes.SECONDARY);
        _pause(PolicyScopes.REDEMPTION);

        address[] memory accounts = new address[](1);
        accounts[0] = INVESTOR;
        token.applySplitBatch(_workflow(), accounts, 2, 1, _evidence());
        assertEq(token.availableBalanceOf(INVESTOR), 8);
        assertEq(token.pendingSettlementBalanceOf(INVESTOR), 4);
        assertEq(token.redemptionLockedBalanceOf(INVESTOR), 2);
        assertEq(token.burnPendingBalanceOf(INVESTOR), 1);
        assertEq(token.administrativeFrozenBalanceOf(INVESTOR), 4);
        assertEq(token.totalSupply(), 19);
    }

    function testFuzz_MintAndReleasePreserveSupply(uint96 rawQuantity) public {
        uint256 quantity = uint256(rawQuantity) + 1;
        token.mintPending(_workflow(), INVESTOR, quantity, _evidence());
        token.releasePending(_workflow(), INVESTOR, quantity, _evidence());
        assertEq(token.availableBalanceOf(INVESTOR), quantity);
        assertEq(token.pendingSettlementBalanceOf(INVESTOR), 0);
        assertEq(token.totalSupply(), quantity);
    }

    function test_EligibilityExpiresAndRevocationAlsoRemovesMarketMakerStatus() public {
        assertTrue(eligibility.isEligible(MARKET_MAKER));
        assertTrue(eligibility.isMarketMaker(MARKET_MAKER));
        vm.warp(block.timestamp + 31 days);
        assertFalse(eligibility.isMarketMaker(MARKET_MAKER));

        vm.warp(1_800_000_000);
        eligibility.revoke(_workflow(), MARKET_MAKER, _evidence());
        assertFalse(eligibility.isEligible(MARKET_MAKER));
        assertFalse(eligibility.isMarketMaker(MARKET_MAKER));
    }

    function test_FactoryCreatesDistinctTokensAndRejectsDuplicateKey() public {
        SecurityTokenFactory factory = new SecurityTokenFactory(address(this), eligibility, policy);
        bytes32 version = keccak256("restricted-token-v1");
        address samsung = factory.deploySecurityToken(
            _workflow(), "005930", "KRTEST000001", "Samsung Synthetic Right", "K005930", version, _evidence()
        );
        address hynix = factory.deploySecurityToken(
            _workflow(), "000660", "KRTEST000002", "SK Hynix Synthetic Right", "K000660", version, _evidence()
        );
        assertTrue(samsung != hynix);
        assertEq(factory.getSecurityToken("005930", "KRTEST000001", version), samsung);

        vm.expectRevert();
        factory.deploySecurityToken(_workflow(), "005930", "KRTEST000001", "Duplicate", "DUP", version, _evidence());

        vm.expectRevert();
        factory.deploySecurityToken(_workflow(), "A05930", "KRTEST000003", "Invalid Code", "BAD", version, _evidence());
        vm.expectRevert();
        factory.deploySecurityToken(_workflow(), "005930", "SHORT", "Invalid ISIN", "BAD", version, _evidence());
    }

    function test_EmergencyPauserCannotResumeScope() public {
        _pause(PolicyScopes.SECONDARY);
        assertTrue(policy.isScopePaused(address(token), PolicyScopes.SECONDARY));
        address emergencyOnly = address(0xE911);
        policy.grantRole(RoleIds.EMERGENCY_PAUSER_ROLE, emergencyOnly);
        vm.prank(emergencyOnly);
        vm.expectRevert();
        policy.resumeScope(_workflow(), address(token), PolicyScopes.SECONDARY, _evidence());
        policy.resumeScope(_workflow(), address(token), PolicyScopes.SECONDARY, _evidence());
        assertFalse(policy.isScopePaused(address(token), PolicyScopes.SECONDARY));
    }

    function _setEligible(address wallet) private {
        eligibility.setEligibility(_workflow(), wallet, true, block.timestamp + 30 days, _evidence());
    }

    function _pause(bytes32 scope) private {
        policy.pauseScope(_workflow(), address(token), scope, keccak256("test-reason"), _evidence());
    }

    function _workflow() private returns (bytes16) {
        ++evidenceSequence;
        return bytes16(uint128(evidenceSequence));
    }

    function _evidence() private returns (bytes32) {
        ++evidenceSequence;
        return keccak256(abi.encode("evidence", evidenceSequence));
    }
}
