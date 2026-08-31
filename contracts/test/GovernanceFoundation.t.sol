// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {TestBase} from "./TestBase.sol";

interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function getThreshold() external view returns (uint256);
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        uint256 transactionNonce
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool success);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes calldata initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

contract GovernanceFoundationTest is TestBase {
    uint256 private constant OWNER_ONE_KEY = 0x101;
    uint256 private constant OWNER_TWO_KEY = 0x202;
    uint256 private constant OWNER_THREE_KEY = 0x303;
    bytes32 private constant INITIAL_POLICY = keccak256("policy-v1");

    ISafe private safe;
    TimelockController private timelock;
    MarketPolicyRegistry private policy;

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(OWNER_ONE_KEY);
        owners[1] = vm.addr(OWNER_TWO_KEY);
        owners[2] = vm.addr(OWNER_THREE_KEY);

        address singleton = _deployArtifact(
            "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json"
        );
        ISafeProxyFactory proxyFactory = ISafeProxyFactory(
            _deployArtifact(
                "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json"
            )
        );
        bytes memory initializer = abi.encodeCall(
            ISafe.setup, (owners, 2, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        address proxy = proxyFactory.createProxyWithNonce(singleton, initializer, 1);
        safe = ISafe(proxy);

        address[] memory proposers = new address[](1);
        proposers[0] = address(safe);
        address[] memory executors = new address[](1);
        executors[0] = address(safe);
        timelock = new TimelockController(60, proposers, executors, address(0));
        policy = new MarketPolicyRegistry(address(timelock), INITIAL_POLICY);
    }

    function test_SafeAndTimelockEnforceTwoSignaturesAndSixtySecondDelay() public {
        assertEq(safe.getThreshold(), 2);
        assertEq(timelock.getMinDelay(), 60);
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), address(safe)));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), address(safe)));
        assertTrue(policy.hasRole(policy.DEFAULT_ADMIN_ROLE(), address(timelock)));
        assertFalse(policy.hasRole(policy.DEFAULT_ADMIN_ROLE(), address(this)));

        bytes32 nextPolicy = keccak256("policy-v2");
        bytes memory policyCall = abi.encodeCall(
            MarketPolicyRegistry.setPolicyVersion,
            (bytes16(uint128(1)), nextPolicy, keccak256("governance-policy-change"))
        );
        bytes32 salt = keccak256("schedule-policy-v2");
        bytes memory scheduleCall =
            abi.encodeCall(TimelockController.schedule, (address(policy), 0, policyCall, bytes32(0), salt, 60));

        bytes32 scheduleHash = _safeTransactionHash(address(timelock), scheduleCall);
        vm.expectRevert();
        _callSafe(address(timelock), scheduleCall, _oneSignature(OWNER_ONE_KEY, scheduleHash));
        assertEq(safe.nonce(), 0);

        _executeSafe(address(timelock), scheduleCall, _twoSignatures(scheduleHash));
        assertEq(safe.nonce(), 1);

        bytes memory executeCall =
            abi.encodeCall(TimelockController.execute, (address(policy), 0, policyCall, bytes32(0), salt));
        bytes32 executeHash = _safeTransactionHash(address(timelock), executeCall);
        vm.expectRevert();
        _callSafe(address(timelock), executeCall, _twoSignatures(executeHash));
        assertEq(safe.nonce(), 1);
        assertEq(policy.policyVersion(), INITIAL_POLICY);

        vm.warp(block.timestamp + 60);
        executeHash = _safeTransactionHash(address(timelock), executeCall);
        _executeSafe(address(timelock), executeCall, _twoSignatures(executeHash));
        assertEq(policy.policyVersion(), nextPolicy);
    }

    function _safeTransactionHash(address target, bytes memory data) private view returns (bytes32) {
        return safe.getTransactionHash(target, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), safe.nonce());
    }

    function _executeSafe(address target, bytes memory data, bytes memory signatures) private {
        require(_callSafe(target, data, signatures), "Safe transaction failed");
    }

    function _callSafe(address target, bytes memory data, bytes memory signatures) private returns (bool) {
        return safe.execTransaction(target, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
    }

    function _oneSignature(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        return _signature(privateKey, digest);
    }

    function _twoSignatures(bytes32 digest) private returns (bytes memory) {
        address first = vm.addr(OWNER_ONE_KEY);
        address second = vm.addr(OWNER_TWO_KEY);
        if (first < second) {
            return bytes.concat(_signature(OWNER_ONE_KEY, digest), _signature(OWNER_TWO_KEY, digest));
        }
        return bytes.concat(_signature(OWNER_TWO_KEY, digest), _signature(OWNER_ONE_KEY, digest));
    }

    function _signature(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _deployArtifact(string memory path) private returns (address deployed) {
        string memory artifact = vm.readFile(path);
        bytes memory creationCode = vm.parseJsonBytes(artifact, ".bytecode");
        assembly ("memory-safe") {
            deployed := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        require(deployed != address(0), "artifact deployment failed");
    }
}
