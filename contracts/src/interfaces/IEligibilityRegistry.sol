// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IEligibilityRegistry {
    function isEligible(address wallet) external view returns (bool);
    function isMarketMaker(address wallet) external view returns (bool);
}
