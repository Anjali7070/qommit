// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {QommitRegistry} from "../src/QommitRegistry.sol";

/// @notice Deploys QommitRegistry. The deployer needs a registered ML-DSA-87 key and a live EVM authorisation
///         window first (pnpm window register / pnpm window open).
contract DeployScript is Script {
    function run() external returns (QommitRegistry registry) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY"); // Forge loads .env from the project root
        vm.startBroadcast(deployerKey);
        registry = new QommitRegistry();
        vm.stopBroadcast();
        console.log("QommitRegistry deployed at", address(registry));
    }
}
