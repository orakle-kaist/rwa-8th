// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function readFile(string calldata path) external view returns (string memory data);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory value);
    function warp(uint256 newTimestamp) external;
}

abstract contract TestBase {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address[] private _invariantTargets;

    function _targetContract(address target) internal {
        _invariantTargets.push(target);
    }

    function targetContracts() public view returns (address[] memory) {
        return _invariantTargets;
    }

    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory values) {}

    function targetArtifacts() public pure returns (string[] memory values) {}

    function excludeArtifacts() public pure returns (string[] memory values) {}

    function targetSenders() public pure returns (address[] memory values) {}

    function excludeSenders() public pure returns (address[] memory values) {}

    function excludeContracts() public pure returns (address[] memory values) {}

    function targetInterfaces() public pure returns (FuzzInterface[] memory values) {}

    function targetSelectors() public pure returns (FuzzSelector[] memory values) {}

    function excludeSelectors() public pure returns (FuzzSelector[] memory values) {}

    function assertTrue(bool condition) internal pure {
        require(condition, "assert true failed");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assert false failed");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint values differ");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "addresses differ");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "bytes32 values differ");
    }

    function assertEq(string memory actual, string memory expected) internal pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), "strings differ");
    }
}
