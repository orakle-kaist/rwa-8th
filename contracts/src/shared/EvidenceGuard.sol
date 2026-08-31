// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EvidenceAlreadyUsed} from "./Errors.sol";

abstract contract EvidenceGuard {
    mapping(bytes32 evidenceHash => bool used) private _usedEvidence;

    function _consumeEvidence(bytes32 evidenceHash) internal {
        require(evidenceHash != bytes32(0), "evidence hash is zero");
        if (_usedEvidence[evidenceHash]) revert EvidenceAlreadyUsed(evidenceHash);
        _usedEvidence[evidenceHash] = true;
    }
}
