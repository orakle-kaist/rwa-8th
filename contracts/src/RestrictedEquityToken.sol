// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IEligibilityRegistry} from "./interfaces/IEligibilityRegistry.sol";
import {IMarketPolicyRegistry} from "./interfaces/IMarketPolicyRegistry.sol";
import {
    ApprovalDisabled,
    DirectTransferDisabled,
    IneligibleWallet,
    InsufficientAvailableBalance,
    InsufficientPendingBalance,
    MarketMakerRequired,
    NonIntegralCorporateAction,
    ScopePaused
} from "./shared/Errors.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {PolicyScopes} from "./shared/PolicyScopes.sol";
import {RoleIds} from "./shared/RoleIds.sol";

contract RestrictedEquityToken is AccessControl, EvidenceGuard {
    string private _tokenName;
    string private _tokenSymbol;
    uint256 private _totalSupply;

    IEligibilityRegistry private immutable _eligibilityRegistry;
    IMarketPolicyRegistry private immutable _policyRegistry;

    mapping(address account => uint256 quantity) private _available;
    mapping(address account => uint256 quantity) private _pendingSettlement;
    mapping(address account => uint256 quantity) private _redemptionLocked;
    mapping(address account => uint256 quantity) private _burnPending;
    mapping(address account => uint256 quantity) private _administrativeFrozen;
    mapping(address account => bool frozen) private _addressFrozen;

    /// @dev ERC-20 호환 인덱서가 발행·이전·소각을 관찰하기 위한 표준 이벤트다.
    event Transfer(address indexed from, address indexed to, uint256 value);
    event PendingMinted(bytes16 indexed workflowId, address indexed account, uint256 quantity, bytes32 evidenceHash);
    event PendingReleased(bytes16 indexed workflowId, address indexed account, uint256 quantity);
    event PendingMintCancelled(bytes16 indexed workflowId, address indexed account, uint256 quantity);
    event ControlledTransfer(bytes16 indexed workflowId, address indexed from, address indexed to, uint256 quantity);
    event RedemptionLocked(bytes16 indexed workflowId, address indexed account, uint256 quantity);
    event BurnPendingMarked(bytes16 indexed workflowId, address indexed account, uint256 quantity);
    event PendingBurned(bytes16 indexed workflowId, address indexed account, uint256 quantity);
    event AdministrativeFreezeChanged(
        bytes16 indexed workflowId, address indexed account, uint256 quantity, bool frozen
    );
    event AddressFrozen(bytes16 indexed workflowId, address indexed account, bool frozen);
    event WalletRecovered(bytes16 indexed workflowId, address indexed oldWallet, address indexed newWallet);
    event SplitBatchApplied(bytes16 indexed workflowId, uint256 numerator, uint256 denominator, uint256 accountCount);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address administrator,
        IEligibilityRegistry eligibilityRegistry,
        IMarketPolicyRegistry policyRegistry
    ) {
        require(bytes(tokenName).length != 0, "name is empty");
        require(bytes(tokenSymbol).length != 0, "symbol is empty");
        require(administrator != address(0), "administrator is zero");
        require(address(eligibilityRegistry) != address(0), "eligibility registry is zero");
        require(address(policyRegistry) != address(0), "policy registry is zero");
        _tokenName = tokenName;
        _tokenSymbol = tokenSymbol;
        _eligibilityRegistry = eligibilityRegistry;
        _policyRegistry = policyRegistry;
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function name() external view returns (string memory) {
        return _tokenName;
    }

    function symbol() external view returns (string memory) {
        return _tokenSymbol;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _available[account] + _pendingSettlement[account] + _redemptionLocked[account] + _burnPending[account]
            + _administrativeFrozen[account];
    }

    function allowance(address owner, address spender) external pure returns (uint256) {
        owner;
        spender;
        return 0;
    }

    function transfer(address to, uint256 amount) external pure returns (bool) {
        to;
        amount;
        revert DirectTransferDisabled();
    }

    function transferFrom(address from, address to, uint256 amount) external pure returns (bool) {
        from;
        to;
        amount;
        revert DirectTransferDisabled();
    }

    function approve(address spender, uint256 amount) external pure returns (bool) {
        spender;
        amount;
        revert ApprovalDisabled();
    }

    function availableBalanceOf(address account) external view returns (uint256) {
        return _available[account];
    }

    function pendingSettlementBalanceOf(address account) external view returns (uint256) {
        return _pendingSettlement[account];
    }

    function redemptionLockedBalanceOf(address account) external view returns (uint256) {
        return _redemptionLocked[account];
    }

    function burnPendingBalanceOf(address account) external view returns (uint256) {
        return _burnPending[account];
    }

    function administrativeFrozenBalanceOf(address account) external view returns (uint256) {
        return _administrativeFrozen[account];
    }

    function isAddressFrozen(address account) external view returns (bool) {
        return _addressFrozen[account];
    }

    function mintPending(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.ISSUANCE);
        _requireUsableEligibleWallet(account);
        _validateMutation(workflowId, quantity, evidenceHash);
        _pendingSettlement[account] += quantity;
        _totalSupply += quantity;
        emit Transfer(address(0), account, quantity);
        emit PendingMinted(workflowId, account, quantity, evidenceHash);
    }

    function releasePending(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.GLOBAL);
        _requireUsableEligibleWallet(account);
        _validateMutation(workflowId, quantity, evidenceHash);
        _subtract(_pendingSettlement, account, quantity, "insufficient pending quantity");
        _available[account] += quantity;
        emit PendingReleased(workflowId, account, quantity);
    }

    function cancelPendingMint(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.ISSUANCE);
        _validateMutation(workflowId, quantity, evidenceHash);
        uint256 pending = _pendingSettlement[account];
        if (pending < quantity) revert InsufficientPendingBalance(account, pending, quantity);
        unchecked {
            _pendingSettlement[account] = pending - quantity;
        }
        _totalSupply -= quantity;
        emit Transfer(account, address(0), quantity);
        emit PendingMintCancelled(workflowId, account, quantity);
    }

    function controlledTransfer(bytes16 workflowId, address from, address to, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.SECONDARY);
        _requireUsableEligibleWallet(from);
        _requireUsableEligibleWallet(to);
        bool fromIsMarketMaker = _eligibilityRegistry.isMarketMaker(from);
        bool toIsMarketMaker = _eligibilityRegistry.isMarketMaker(to);
        if (fromIsMarketMaker == toIsMarketMaker) {
            revert MarketMakerRequired(to);
        }
        _validateMutation(workflowId, quantity, evidenceHash);
        uint256 available = _available[from];
        if (available < quantity) {
            revert InsufficientAvailableBalance(from, available, quantity);
        }
        unchecked {
            _available[from] = available - quantity;
        }
        _available[to] += quantity;
        emit Transfer(from, to, quantity);
        emit ControlledTransfer(workflowId, from, to, quantity);
    }

    function lockForRedemption(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.REDEMPTION);
        _requireUsableEligibleWallet(account);
        _validateMutation(workflowId, quantity, evidenceHash);
        uint256 available = _available[account];
        if (available < quantity) {
            revert InsufficientAvailableBalance(account, available, quantity);
        }
        unchecked {
            _available[account] = available - quantity;
        }
        _redemptionLocked[account] += quantity;
        emit RedemptionLocked(workflowId, account, quantity);
    }

    function cancelRedemptionLock(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.REDEMPTION);
        _requireUsableEligibleWallet(account);
        _validateMutation(workflowId, quantity, evidenceHash);
        _subtract(_redemptionLocked, account, quantity, "insufficient redemption lock");
        _available[account] += quantity;
    }

    function markBurnPending(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.REDEMPTION);
        _validateMutation(workflowId, quantity, evidenceHash);
        _subtract(_redemptionLocked, account, quantity, "insufficient redemption lock");
        _burnPending[account] += quantity;
        emit BurnPendingMarked(workflowId, account, quantity);
    }

    function burnPending(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE)
    {
        _requireScopeOpen(PolicyScopes.REDEMPTION);
        _validateMutation(workflowId, quantity, evidenceHash);
        _subtract(_burnPending, account, quantity, "insufficient burn pending");
        _totalSupply -= quantity;
        emit Transfer(account, address(0), quantity);
        emit PendingBurned(workflowId, account, quantity);
    }

    function freezeAvailable(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.RECOVERY_EXECUTOR_ROLE)
    {
        _validateMutation(workflowId, quantity, evidenceHash);
        uint256 available = _available[account];
        if (available < quantity) {
            revert InsufficientAvailableBalance(account, available, quantity);
        }
        unchecked {
            _available[account] = available - quantity;
        }
        _administrativeFrozen[account] += quantity;
        emit AdministrativeFreezeChanged(workflowId, account, quantity, true);
    }

    function unfreezeAvailable(bytes16 workflowId, address account, uint256 quantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.RECOVERY_EXECUTOR_ROLE)
    {
        _requireUsableEligibleWallet(account);
        _validateMutation(workflowId, quantity, evidenceHash);
        _subtract(_administrativeFrozen, account, quantity, "insufficient frozen quantity");
        _available[account] += quantity;
        emit AdministrativeFreezeChanged(workflowId, account, quantity, false);
    }

    function freezeAddress(bytes16 workflowId, address account, bool frozen, bytes32 evidenceHash) external {
        if (!hasRole(RoleIds.RECOVERY_EXECUTOR_ROLE, msg.sender) && !hasRole(RoleIds.EMERGENCY_PAUSER_ROLE, msg.sender))
        {
            revert AccessControlUnauthorizedAccount(msg.sender, RoleIds.RECOVERY_EXECUTOR_ROLE);
        }
        require(workflowId != bytes16(0), "workflow is zero");
        require(account != address(0), "account is zero");
        _consumeEvidence(evidenceHash);
        _addressFrozen[account] = frozen;
        emit AddressFrozen(workflowId, account, frozen);
    }

    function recoverAllBuckets(bytes16 workflowId, address oldWallet, address newWallet, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.RECOVERY_EXECUTOR_ROLE)
    {
        require(_addressFrozen[oldWallet], "old wallet is not frozen");
        require(!_addressFrozen[newWallet], "new wallet is frozen");
        require(balanceOf(newWallet) == 0, "new wallet already has a balance");
        if (!_eligibilityRegistry.isEligible(newWallet)) revert IneligibleWallet(newWallet);
        require(workflowId != bytes16(0), "workflow is zero");
        _consumeEvidence(evidenceHash);

        uint256 moved = balanceOf(oldWallet);
        _moveAll(_available, oldWallet, newWallet);
        _moveAll(_pendingSettlement, oldWallet, newWallet);
        _moveAll(_redemptionLocked, oldWallet, newWallet);
        _moveAll(_burnPending, oldWallet, newWallet);
        _moveAll(_administrativeFrozen, oldWallet, newWallet);
        if (moved != 0) emit Transfer(oldWallet, newWallet, moved);
        emit WalletRecovered(workflowId, oldWallet, newWallet);
    }

    function applySplitBatch(
        bytes16 workflowId,
        address[] calldata accounts,
        uint256 numerator,
        uint256 denominator,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.CORPORATE_ACTION_EXECUTOR_ROLE) {
        require(_policyRegistry.isScopePaused(address(this), PolicyScopes.ISSUANCE), "issuance is not paused");
        require(_policyRegistry.isScopePaused(address(this), PolicyScopes.SECONDARY), "secondary is not paused");
        require(_policyRegistry.isScopePaused(address(this), PolicyScopes.REDEMPTION), "redemption is not paused");
        require(workflowId != bytes16(0), "workflow is zero");
        require(accounts.length != 0, "accounts are empty");
        require(numerator != 0 && denominator != 0, "invalid split ratio");
        _consumeEvidence(evidenceHash);

        for (uint256 i = 0; i < accounts.length; ++i) {
            for (uint256 j = 0; j < i; ++j) {
                require(accounts[i] != accounts[j], "duplicate split account");
            }
            _applySplitToAccount(accounts[i], numerator, denominator);
        }
        emit SplitBatchApplied(workflowId, numerator, denominator, accounts.length);
    }

    function _applySplitToAccount(address account, uint256 numerator, uint256 denominator) private {
        uint256 oldBalance = balanceOf(account);
        _available[account] = _scaled(account, _available[account], numerator, denominator);
        _pendingSettlement[account] = _scaled(account, _pendingSettlement[account], numerator, denominator);
        _redemptionLocked[account] = _scaled(account, _redemptionLocked[account], numerator, denominator);
        // 매도대금 결제 뒤 소각을 기다리는 토큰에는 더 이상 주식 수탁권리가 없다.
        // 따라서 기준일 주식 권리에 적용하는 분할비율로 이 수량을 늘리거나 줄이지 않는다.
        _administrativeFrozen[account] = _scaled(account, _administrativeFrozen[account], numerator, denominator);
        uint256 newBalance = balanceOf(account);
        if (newBalance > oldBalance) {
            uint256 increase = newBalance - oldBalance;
            _totalSupply += increase;
            emit Transfer(address(0), account, increase);
        } else if (oldBalance > newBalance) {
            uint256 decrease = oldBalance - newBalance;
            _totalSupply -= decrease;
            emit Transfer(account, address(0), decrease);
        }
    }

    function _scaled(address account, uint256 quantity, uint256 numerator, uint256 denominator)
        private
        pure
        returns (uint256)
    {
        if (quantity == 0) return 0;
        uint256 product = quantity * numerator;
        if (product % denominator != 0) {
            revert NonIntegralCorporateAction(account, quantity, denominator);
        }
        return product / denominator;
    }

    function _validateMutation(bytes16 workflowId, uint256 quantity, bytes32 evidenceHash) private {
        require(workflowId != bytes16(0), "workflow is zero");
        require(quantity != 0, "quantity is zero");
        _consumeEvidence(evidenceHash);
    }

    function _requireUsableEligibleWallet(address account) private view {
        if (!_eligibilityRegistry.isEligible(account)) revert IneligibleWallet(account);
        require(!_addressFrozen[account], "address is frozen");
    }

    function _requireScopeOpen(bytes32 scope) private view {
        if (_policyRegistry.isScopePaused(address(this), scope)) {
            revert ScopePaused(address(this), scope);
        }
    }

    function _subtract(
        mapping(address account => uint256 quantity) storage bucket,
        address account,
        uint256 quantity,
        string memory reason
    ) private {
        uint256 current = bucket[account];
        require(current >= quantity, reason);
        unchecked {
            bucket[account] = current - quantity;
        }
    }

    function _moveAll(mapping(address account => uint256 quantity) storage bucket, address from, address to) private {
        uint256 quantity = bucket[from];
        if (quantity == 0) return;
        bucket[from] = 0;
        bucket[to] = quantity;
    }
}
