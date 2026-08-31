// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IEligibilityRegistry} from "./interfaces/IEligibilityRegistry.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {RoleIds} from "./shared/RoleIds.sol";

contract EligibilityRegistry is IEligibilityRegistry, AccessControl, EvidenceGuard {
    struct EligibilityRecord {
        bool eligible;
        uint256 validUntil;
        bool marketMaker;
        uint256 marketMakerValidUntil;
    }

    mapping(address wallet => EligibilityRecord record) private _records;

    event EligibilityUpdated(
        bytes16 indexed workflowId, address indexed wallet, bool eligible, uint256 validUntil, bytes32 evidenceHash
    );
    event MarketMakerStatusUpdated(
        bytes16 indexed workflowId, address indexed wallet, bool marketMaker, uint256 validUntil, bytes32 evidenceHash
    );

    constructor(address administrator) {
        require(administrator != address(0), "administrator is zero");
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function setEligibility(bytes16 workflowId, address wallet, bool eligible, uint256 validUntil, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE)
    {
        require(workflowId != bytes16(0), "workflow is zero");
        require(wallet != address(0), "wallet is zero");
        if (eligible) require(validUntil > block.timestamp, "eligibility already expired");
        _consumeEvidence(evidenceHash);

        EligibilityRecord storage record = _records[wallet];
        record.eligible = eligible;
        record.validUntil = validUntil;
        if (!eligible) {
            record.marketMaker = false;
            record.marketMakerValidUntil = 0;
        }

        emit EligibilityUpdated(workflowId, wallet, eligible, validUntil, evidenceHash);
        if (!eligible) {
            emit MarketMakerStatusUpdated(workflowId, wallet, false, 0, evidenceHash);
        }
    }

    function setMarketMaker(
        bytes16 workflowId,
        address wallet,
        bool marketMaker,
        uint256 validUntil,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE) {
        require(workflowId != bytes16(0), "workflow is zero");
        require(wallet != address(0), "wallet is zero");
        if (marketMaker) {
            require(isEligible(wallet), "market maker is not eligible");
            require(validUntil > block.timestamp, "market maker status already expired");
        }
        _consumeEvidence(evidenceHash);

        EligibilityRecord storage record = _records[wallet];
        record.marketMaker = marketMaker;
        record.marketMakerValidUntil = validUntil;
        emit MarketMakerStatusUpdated(workflowId, wallet, marketMaker, validUntil, evidenceHash);
    }

    function revoke(bytes16 workflowId, address wallet, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE)
    {
        require(workflowId != bytes16(0), "workflow is zero");
        require(wallet != address(0), "wallet is zero");
        _consumeEvidence(evidenceHash);
        delete _records[wallet];
        emit EligibilityUpdated(workflowId, wallet, false, 0, evidenceHash);
        emit MarketMakerStatusUpdated(workflowId, wallet, false, 0, evidenceHash);
    }

    function isEligible(address wallet) public view override returns (bool) {
        EligibilityRecord storage record = _records[wallet];
        return record.eligible && record.validUntil >= block.timestamp && record.validUntil != 0;
    }

    function isMarketMaker(address wallet) external view override returns (bool) {
        EligibilityRecord storage record = _records[wallet];
        return isEligible(wallet) && record.marketMaker && record.marketMakerValidUntil >= block.timestamp
            && record.marketMakerValidUntil != 0;
    }
}
