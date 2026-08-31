// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IMarketPolicyRegistry} from "./interfaces/IMarketPolicyRegistry.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {PolicyScopes} from "./shared/PolicyScopes.sol";
import {RoleIds} from "./shared/RoleIds.sol";

contract MarketPolicyRegistry is IMarketPolicyRegistry, AccessControl, EvidenceGuard {
    mapping(address token => mapping(bytes32 scope => bool paused)) private _paused;
    bytes32 private _policyVersion;

    event ScopePaused(
        bytes16 indexed workflowId,
        address indexed token,
        bytes32 indexed scope,
        bytes32 reasonCode,
        bytes32 evidenceHash
    );
    event ScopeResumed(bytes16 indexed workflowId, address indexed token, bytes32 indexed scope, bytes32 evidenceHash);
    event PolicyVersionChanged(bytes16 indexed workflowId, bytes32 indexed policyVersion, bytes32 evidenceHash);

    constructor(address administrator, bytes32 initialPolicyVersion) {
        require(administrator != address(0), "administrator is zero");
        require(initialPolicyVersion != bytes32(0), "policy version is zero");
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
        _policyVersion = initialPolicyVersion;
    }

    function pauseScope(bytes16 workflowId, address token, bytes32 scope, bytes32 reasonCode, bytes32 evidenceHash)
        external
    {
        if (!hasRole(RoleIds.EMERGENCY_PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, RoleIds.EMERGENCY_PAUSER_ROLE);
        }
        _validateScopeTarget(token, scope);
        require(!_paused[token][scope], "scope already paused");
        require(workflowId != bytes16(0), "workflow is zero");
        require(reasonCode != bytes32(0), "reason is zero");
        _consumeEvidence(evidenceHash);
        _paused[token][scope] = true;
        emit ScopePaused(workflowId, token, scope, reasonCode, evidenceHash);
    }

    function resumeScope(bytes16 workflowId, address token, bytes32 scope, bytes32 evidenceHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _validateScopeTarget(token, scope);
        require(_paused[token][scope], "scope is not paused");
        require(workflowId != bytes16(0), "workflow is zero");
        _consumeEvidence(evidenceHash);
        _paused[token][scope] = false;
        emit ScopeResumed(workflowId, token, scope, evidenceHash);
    }

    function setPolicyVersion(bytes16 workflowId, bytes32 policyVersion, bytes32 evidenceHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(workflowId != bytes16(0), "workflow is zero");
        require(policyVersion != bytes32(0), "policy version is zero");
        _consumeEvidence(evidenceHash);
        _policyVersion = policyVersion;
        emit PolicyVersionChanged(workflowId, policyVersion, evidenceHash);
    }

    function isScopePaused(address token, bytes32 scope) external view override returns (bool) {
        if (_paused[address(0)][PolicyScopes.GLOBAL]) return true;
        if (scope == PolicyScopes.GLOBAL) return _paused[address(0)][PolicyScopes.GLOBAL];
        return _paused[token][scope];
    }

    function policyVersion() external view override returns (bytes32) {
        return _policyVersion;
    }

    function _validateScopeTarget(address token, bytes32 scope) private pure {
        require(PolicyScopes.isKnown(scope), "unknown scope");
        if (scope == PolicyScopes.GLOBAL) {
            require(token == address(0), "global scope token must be zero");
        } else {
            require(token != address(0), "token is zero");
        }
    }
}
