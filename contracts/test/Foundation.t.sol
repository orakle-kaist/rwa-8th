// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract FoundationTest {
    function test_FoundryUsesApprovedSolidityVersion() public pure {
        require(keccak256(bytes(_compilerVersion())) == keccak256(bytes("0.8.30")));
    }

    function _compilerVersion() private pure returns (string memory) {
        return "0.8.30";
    }
}
