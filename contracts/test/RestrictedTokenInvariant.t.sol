// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {RestrictedEquityToken} from "../src/RestrictedEquityToken.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {TestBase} from "./TestBase.sol";

contract RestrictedTokenHandler {
    RestrictedEquityToken private immutable _token;
    address private immutable _investor;
    address private immutable _marketMaker;
    uint256 private _sequence;

    constructor(RestrictedEquityToken token, address investor, address marketMaker) {
        _token = token;
        _investor = investor;
        _marketMaker = marketMaker;
    }

    function mint(uint96 rawQuantity, bool toMarketMaker) external {
        uint256 quantity = uint256(rawQuantity) % 100 + 1;
        _token.mintPending(_workflow(), _account(toMarketMaker), quantity, _evidence());
    }

    function release(uint96 rawQuantity, bool forMarketMaker) external {
        address account = _account(forMarketMaker);
        uint256 pending = _token.pendingSettlementBalanceOf(account);
        if (pending == 0) return;
        uint256 quantity = uint256(rawQuantity) % pending + 1;
        _token.releasePending(_workflow(), account, quantity, _evidence());
    }

    function transferAvailable(uint96 rawQuantity, bool investorSells) external {
        address from = investorSells ? _investor : _marketMaker;
        address to = investorSells ? _marketMaker : _investor;
        uint256 available = _token.availableBalanceOf(from);
        if (available == 0) return;
        uint256 quantity = uint256(rawQuantity) % available + 1;
        _token.controlledTransfer(_workflow(), from, to, quantity, _evidence());
    }

    function lockAndMarkBurn(uint96 rawQuantity, bool forMarketMaker) external {
        address account = _account(forMarketMaker);
        uint256 available = _token.availableBalanceOf(account);
        if (available == 0) return;
        uint256 quantity = uint256(rawQuantity) % available + 1;
        _token.lockForRedemption(_workflow(), account, quantity, _evidence());
        _token.markBurnPending(_workflow(), account, quantity, _evidence());
    }

    function burn(uint96 rawQuantity, bool forMarketMaker) external {
        address account = _account(forMarketMaker);
        uint256 pending = _token.burnPendingBalanceOf(account);
        if (pending == 0) return;
        uint256 quantity = uint256(rawQuantity) % pending + 1;
        _token.burnPending(_workflow(), account, quantity, _evidence());
    }

    function freezeAndUnfreeze(uint96 rawQuantity, bool forMarketMaker, bool unfreeze) external {
        address account = _account(forMarketMaker);
        uint256 source = unfreeze ? _token.administrativeFrozenBalanceOf(account) : _token.availableBalanceOf(account);
        if (source == 0) return;
        uint256 quantity = uint256(rawQuantity) % source + 1;
        if (unfreeze) {
            _token.unfreezeAvailable(_workflow(), account, quantity, _evidence());
        } else {
            _token.freezeAvailable(_workflow(), account, quantity, _evidence());
        }
    }

    function _account(bool marketMaker) private view returns (address) {
        return marketMaker ? _marketMaker : _investor;
    }

    function _workflow() private returns (bytes16) {
        ++_sequence;
        return bytes16(uint128(_sequence));
    }

    function _evidence() private returns (bytes32) {
        ++_sequence;
        return keccak256(abi.encode("invariant-evidence", _sequence));
    }
}

contract RestrictedTokenInvariantTest is TestBase {
    address private constant INVESTOR = address(0xA11CE);
    address private constant MARKET_MAKER = address(0xBEEF);

    RestrictedEquityToken private token;

    function setUp() public {
        vm.warp(1_800_000_000);
        EligibilityRegistry eligibility = new EligibilityRegistry(address(this));
        MarketPolicyRegistry policy = new MarketPolicyRegistry(address(this), keccak256("invariant-policy"));
        token = new RestrictedEquityToken("Invariant Custody Right", "INV", address(this), eligibility, policy);
        eligibility.grantRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE, address(this));
        eligibility.setEligibility(
            bytes16(uint128(1)), INVESTOR, true, block.timestamp + 30 days, keccak256("investor")
        );
        eligibility.setEligibility(
            bytes16(uint128(2)), MARKET_MAKER, true, block.timestamp + 30 days, keccak256("market-maker")
        );
        eligibility.setMarketMaker(
            bytes16(uint128(3)), MARKET_MAKER, true, block.timestamp + 30 days, keccak256("mm-status")
        );

        RestrictedTokenHandler handler = new RestrictedTokenHandler(token, INVESTOR, MARKET_MAKER);
        token.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(handler));
        token.grantRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE, address(handler));
        token.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(handler));
        token.grantRole(RoleIds.RECOVERY_EXECUTOR_ROLE, address(handler));
        _targetContract(address(handler));
    }

    function invariant_TotalSupplyEqualsAllFiveBuckets() public view {
        uint256 bucketTotal = _bucketTotal(INVESTOR) + _bucketTotal(MARKET_MAKER);
        assertEq(token.totalSupply(), bucketTotal);
        assertEq(token.balanceOf(INVESTOR) + token.balanceOf(MARKET_MAKER), bucketTotal);
    }

    function _bucketTotal(address account) private view returns (uint256) {
        return token.availableBalanceOf(account) + token.pendingSettlementBalanceOf(account)
            + token.redemptionLockedBalanceOf(account) + token.burnPendingBalanceOf(account)
            + token.administrativeFrozenBalanceOf(account);
    }
}
