// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IMarketPolicyRegistry {
    function isScopePaused(address token, bytes32 scope) external view returns (bool);
    function policyVersion() external view returns (bytes32);
}
