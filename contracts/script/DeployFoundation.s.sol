// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {IntentVerifier} from "../src/IntentVerifier.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {SecurityTokenFactory} from "../src/SecurityTokenFactory.sol";

interface VmDeployment {
    function envUint(string calldata name) external returns (uint256);
    function envAddress(string calldata name) external returns (address);
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface ISafeSetup {
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
}

interface ISafeProxyFactoryDeployment {
    function createProxyWithNonce(address singleton, bytes calldata initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @notice 로컬 Anvil용 실제 Safe, 60초 지연 계약과 기반 계약 배포 도우미다.
/// @dev 합성 관리자와 합성 정책만 사용한다. Fuji 배포에는 사용하지 않는다.
contract DeployFoundation {
    VmDeployment private constant vm = VmDeployment(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        address safe;
        address timelock;
        address eligibilityRegistry;
        address marketPolicyRegistry;
        address intentVerifier;
        address securityTokenFactory;
    }

    function run() external returns (Deployment memory deployed) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address[] memory owners = new address[](3);
        owners[0] = vm.envAddress("SAFE_OWNER_1");
        owners[1] = vm.envAddress("SAFE_OWNER_2");
        owners[2] = vm.envAddress("SAFE_OWNER_3");

        vm.startBroadcast(deployerKey);
        address singleton = _deployArtifact(
            "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json"
        );
        ISafeProxyFactoryDeployment proxyFactory = ISafeProxyFactoryDeployment(
            _deployArtifact(
                "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json"
            )
        );
        bytes memory initializer = abi.encodeCall(
            ISafeSetup.setup, (owners, 2, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        deployed.safe = proxyFactory.createProxyWithNonce(singleton, initializer, 1);

        address[] memory proposers = new address[](1);
        proposers[0] = deployed.safe;
        address[] memory executors = new address[](1);
        executors[0] = deployed.safe;
        deployed.timelock = address(new TimelockController(60, proposers, executors, address(0)));

        deployed.eligibilityRegistry = address(new EligibilityRegistry(deployed.timelock));
        deployed.marketPolicyRegistry =
            address(new MarketPolicyRegistry(deployed.timelock, keccak256("LOCAL_POLICY_V1")));
        deployed.intentVerifier =
            address(new IntentVerifier(deployed.timelock, MarketPolicyRegistry(deployed.marketPolicyRegistry)));
        deployed.securityTokenFactory = address(
            new SecurityTokenFactory(
                deployed.timelock,
                EligibilityRegistry(deployed.eligibilityRegistry),
                MarketPolicyRegistry(deployed.marketPolicyRegistry)
            )
        );
        vm.stopBroadcast();
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
