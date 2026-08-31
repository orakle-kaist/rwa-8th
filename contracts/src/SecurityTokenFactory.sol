// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IEligibilityRegistry} from "./interfaces/IEligibilityRegistry.sol";
import {IMarketPolicyRegistry} from "./interfaces/IMarketPolicyRegistry.sol";
import {RestrictedEquityToken} from "./RestrictedEquityToken.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";

contract SecurityTokenFactory is AccessControl, EvidenceGuard {
    struct TokenDetails {
        string krxCode;
        string isin;
        string displayName;
        string tokenSymbol;
        bytes32 designVersionHash;
    }

    address private immutable _tokenAdministrator;
    IEligibilityRegistry private immutable _eligibilityRegistry;
    IMarketPolicyRegistry private immutable _policyRegistry;
    mapping(bytes32 securityKey => address token) private _securityTokens;
    mapping(address token => string krxCode) private _tokenSecurityIds;

    event SecurityTokenRegistered(
        bytes16 indexed workflowId,
        address indexed token,
        bytes32 indexed securityKey,
        string krxCode,
        string isin,
        bytes32 designVersionHash
    );

    constructor(address administrator, IEligibilityRegistry eligibilityRegistry, IMarketPolicyRegistry policyRegistry) {
        require(administrator != address(0), "administrator is zero");
        require(address(eligibilityRegistry) != address(0), "eligibility registry is zero");
        require(address(policyRegistry) != address(0), "policy registry is zero");
        _tokenAdministrator = administrator;
        _eligibilityRegistry = eligibilityRegistry;
        _policyRegistry = policyRegistry;
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function deploySecurityToken(
        bytes16 workflowId,
        string calldata krxCode,
        string calldata isin,
        string calldata displayName,
        string calldata symbol,
        bytes32 designVersionHash,
        bytes32 evidenceHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (address token) {
        require(workflowId != bytes16(0), "workflow is zero");
        _validateKrxCode(krxCode);
        require(bytes(isin).length == 12, "ISIN must have 12 characters");
        require(bytes(displayName).length != 0, "display name is empty");
        require(bytes(symbol).length != 0, "symbol is empty");
        require(designVersionHash != bytes32(0), "design version is zero");
        _consumeEvidence(evidenceHash);

        TokenDetails memory details = TokenDetails({
            krxCode: krxCode,
            isin: isin,
            displayName: displayName,
            tokenSymbol: symbol,
            designVersionHash: designVersionHash
        });
        bytes32 securityKey = _securityKey(krxCode, isin, designVersionHash);
        require(_securityTokens[securityKey] == address(0), "security token already exists");
        token = _deploy(details, securityKey);
        _securityTokens[securityKey] = token;
        _tokenSecurityIds[token] = krxCode;
        _emitRegistration(workflowId, token, securityKey, details);
    }

    function getTokenSecurityId(address token) external view returns (string memory) {
        return _tokenSecurityIds[token];
    }

    function getSecurityToken(string calldata krxCode, string calldata isin, bytes32 designVersionHash)
        external
        view
        returns (address)
    {
        return _securityTokens[_securityKey(krxCode, isin, designVersionHash)];
    }

    function _securityKey(string calldata krxCode, string calldata isin, bytes32 designVersionHash)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(krxCode, isin, designVersionHash));
    }

    function _deploy(TokenDetails memory details, bytes32 securityKey) private returns (address) {
        return address(
            new RestrictedEquityToken{salt: securityKey}(
                details.displayName, details.tokenSymbol, _tokenAdministrator, _eligibilityRegistry, _policyRegistry
            )
        );
    }

    function _emitRegistration(bytes16 workflowId, address token, bytes32 securityKey, TokenDetails memory details)
        private
    {
        emit SecurityTokenRegistered(
            workflowId, token, securityKey, details.krxCode, details.isin, details.designVersionHash
        );
    }

    function _validateKrxCode(string calldata krxCode) private pure {
        bytes calldata raw = bytes(krxCode);
        require(raw.length == 6, "KRX code must have 6 digits");
        for (uint256 i = 0; i < raw.length; ++i) {
            require(raw[i] >= 0x30 && raw[i] <= 0x39, "KRX code must be numeric");
        }
    }
}
