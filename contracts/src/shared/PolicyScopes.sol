// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library PolicyScopes {
    bytes32 internal constant ISSUANCE = keccak256("ISSUANCE");
    bytes32 internal constant SECONDARY = keccak256("SECONDARY");
    bytes32 internal constant REDEMPTION = keccak256("REDEMPTION");
    bytes32 internal constant USDC_PATH = keccak256("USDC_PATH");
    bytes32 internal constant GLOBAL = keccak256("GLOBAL_EMERGENCY");

    function isKnown(bytes32 scope) internal pure returns (bool) {
        return scope == ISSUANCE || scope == SECONDARY || scope == REDEMPTION || scope == USDC_PATH || scope == GLOBAL;
    }
}
