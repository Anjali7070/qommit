// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QommitRegistry} from "../src/QommitRegistry.sol";

/// @dev Stand-in for QoreChain's precompiles in Foundry's local EVM (which doesn't have them).
///      "Signature" = keccak256(pubkey ‖ message): binds key and message like a real signature, so the
///      registry's logic can be tested. Real ML-DSA-87 verification is exercised on the testnet.
contract MockPQC {
    mapping(address => bool) public protectedAccount;

    function setProtected(address a, bool v) external {
        protectedAccount[a] = v;
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return keccak256(signature) == keccak256(abi.encodePacked(keccak256(abi.encodePacked(pubkey, message))));
    }

    mapping(address => uint8) public algorithm; // 0 = default ML-DSA-87 (1)

    function setAlgorithm(address a, uint8 alg) external {
        algorithm[a] = alg;
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        uint8 alg = algorithm[account] == 0 ? 1 : algorithm[account];
        return (protectedAccount[account], alg, "", false);
    }
}

contract QommitRegistryTest is Test {
    address constant VERIFY = 0x0000000000000000000000000000000000000a01;
    address constant STATUS = 0x0000000000000000000000000000000000000a02;

    QommitRegistry reg;
    bytes pubkey;
    bytes otherPubkey;
    address anjali = makeAddr("anjali");
    address mallory = makeAddr("mallory");
    bytes20 constant COMMIT = bytes20(hex"b7e3400aa1b2c3d4e5f60718293a4b5c6d7e8f90");

    function setUp() public {
        MockPQC mock = new MockPQC();
        vm.etch(VERIFY, address(mock).code);
        vm.etch(STATUS, address(mock).code);
        MockPQC(STATUS).setProtected(anjali, true);
        MockPQC(STATUS).setProtected(mallory, true);
        reg = new QommitRegistry();
        pubkey = _fakeKey(1);
        otherPubkey = _fakeKey(2);
    }

    function _fakeKey(uint8 seed) internal pure returns (bytes memory k) {
        k = new bytes(2592);
        for (uint256 i = 0; i < 2592; i += 32) k[i] = bytes1(seed);
    }

    function _sign(bytes memory key, bytes memory message) internal pure returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked(key, message)));
    }

    function _register() internal returns (bytes32) {
        return reg.register(anjali, pubkey, _sign(pubkey, reg.registerMessage(anjali)));
    }

    // ------------------------------------------------------------------ register

    function test_register_storesOwner() public {
        bytes32 id = _register();
        assertEq(id, keccak256(pubkey));
        assertEq(reg.ownerOf(id), anjali);
    }

    function test_register_anyoneCanRelay() public {
        vm.prank(mallory); // mallory pays the gas, but the key's signature decides the owner
        bytes32 id = reg.register(anjali, pubkey, _sign(pubkey, reg.registerMessage(anjali)));
        assertEq(reg.ownerOf(id), anjali);
    }

    function test_register_cannotRedirectOwner() public {
        // mallory relays anjali's signature but swaps in herself as owner
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.register(mallory, pubkey, sig);
    }

    function test_register_signatureFromOtherKeyFails() public {
        bytes memory sig = _sign(otherPubkey, reg.registerMessage(anjali));
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.register(anjali, pubkey, sig);
    }

    function test_register_replayOnOtherChainFails() public {
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        vm.chainId(9801); // mainnet
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.register(anjali, pubkey, sig);
    }

    function test_register_replayOnOtherRegistryFails() public {
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        QommitRegistry other = new QommitRegistry();
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        other.register(anjali, pubkey, sig);
    }

    function test_register_requiresQuantumProtectedOwner() public {
        address classical = makeAddr("classical-only");
        bytes memory sig = _sign(pubkey, reg.registerMessage(classical));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.OwnerNotQuantumProtected.selector, classical));
        reg.register(classical, pubkey, sig);
    }

    function test_register_twiceFails() public {
        bytes32 id = _register();
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.AlreadyRegistered.selector, id));
        reg.register(anjali, pubkey, sig);
    }

    function test_register_wrongKeyLengthFails() public {
        vm.expectRevert(QommitRegistry.InvalidPublicKey.selector);
        reg.register(anjali, hex"1234", hex"");
    }

    // ------------------------------------------------------------------ revoke

    function test_revoke_byKey() public {
        bytes32 id = _register();
        reg.revoke(pubkey, _sign(pubkey, reg.revokeMessage()));
        assertEq(reg.ownerOf(id), address(0));
        (,, uint64 revokedAt) = reg.keys(id);
        assertGt(revokedAt, 0);
    }

    function test_revoke_needsKeySignature() public {
        _register();
        bytes memory sig = _sign(otherPubkey, reg.revokeMessage());
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.revoke(pubkey, sig);
    }

    function test_revoke_registerSignatureCannotBeReusedToRevoke() public {
        _register();
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.revoke(pubkey, sig);
    }

    function test_revoked_keyCannotBeReRegistered() public {
        bytes32 id = _register();
        reg.revoke(pubkey, _sign(pubkey, reg.revokeMessage()));
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.AlreadyRegistered.selector, id));
        reg.register(anjali, pubkey, sig);
    }

    // ------------------------------------------------------------------ anchor

    function test_anchor_recordsTimestamp() public {
        bytes32 id = _register();
        vm.warp(1_800_000_000);
        reg.anchor(pubkey, COMMIT, _sign(pubkey, reg.anchorMessage(COMMIT)));
        (uint64 ts, uint64 blockNumber) = reg.anchors(COMMIT, id);
        assertEq(ts, 1_800_000_000);
        assertEq(blockNumber, block.number);
    }

    function test_anchor_signatureBoundToCommit() public {
        _register();
        bytes memory sig = _sign(pubkey, reg.anchorMessage(COMMIT));
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.anchor(pubkey, bytes20(uint160(1)), sig);
    }

    function test_anchor_firstOneWins() public {
        _register();
        reg.anchor(pubkey, COMMIT, _sign(pubkey, reg.anchorMessage(COMMIT)));
        bytes memory sig = _sign(pubkey, reg.anchorMessage(COMMIT));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.AlreadyAnchored.selector, COMMIT));
        reg.anchor(pubkey, COMMIT, sig);
    }

    function test_anchor_unknownKeyFails() public {
        bytes memory sig = _sign(pubkey, reg.anchorMessage(COMMIT));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.UnknownKey.selector, keccak256(pubkey)));
        reg.anchor(pubkey, COMMIT, sig);
    }

    function test_anchor_revokedKeyFails() public {
        bytes32 id = _register();
        reg.revoke(pubkey, _sign(pubkey, reg.revokeMessage()));
        bytes memory sig = _sign(pubkey, reg.anchorMessage(COMMIT));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.KeyIsRevoked.selector, id));
        reg.anchor(pubkey, COMMIT, sig);
    }

    // ------------------------------------------------------------------ fuzz

    /// Whatever owner the signature names, only that owner can be registered.
    function testFuzz_register_onlySignedOwner(address signedFor, address claimed) public {
        vm.assume(signedFor != claimed && signedFor != address(0) && claimed != address(0));
        MockPQC(STATUS).setProtected(signedFor, true);
        MockPQC(STATUS).setProtected(claimed, true);
        bytes memory sig = _sign(pubkey, reg.registerMessage(signedFor));
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.register(claimed, pubkey, sig);
    }

    // ------------------------------------------------------------------ added after mutation testing

    function _startsWith(bytes memory data, bytes memory prefix) internal pure returns (bool) {
        if (data.length < prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) if (data[i] != prefix[i]) return false;
        return true;
    }

    /// Each action signs a message with its own label, so a signature for one action can never be valid for another.
    function test_messages_areDomainSeparated() public view {
        assertTrue(_startsWith(reg.registerMessage(anjali), "qommit:register:v1"));
        assertTrue(_startsWith(reg.revokeMessage(), "qommit:revoke:v1"));
        assertTrue(_startsWith(reg.anchorMessage(COMMIT), "qommit:anchor:v1"));
    }

    function test_revokeSignatureCannotRegister() public {
        bytes memory sig = _sign(pubkey, reg.revokeMessage());
        vm.expectRevert(QommitRegistry.InvalidSignature.selector);
        reg.register(anjali, pubkey, sig);
    }

    // ------------------------------------------------------------------ added after the blind security review

    /// M-03: someone else anchoring the same public commit first must not block the real signer's anchor.
    function test_anchor_otherKeyCannotBlockMine() public {
        bytes32 mine = _register();
        bytes32 theirs = reg.register(mallory, otherPubkey, _sign(otherPubkey, reg.registerMessage(mallory)));
        reg.anchor(otherPubkey, COMMIT, _sign(otherPubkey, reg.anchorMessage(COMMIT))); // mallory front-runs
        reg.anchor(pubkey, COMMIT, _sign(pubkey, reg.anchorMessage(COMMIT))); // still works for anjali
        (uint64 tsMine,) = reg.anchors(COMMIT, mine);
        (uint64 tsTheirs,) = reg.anchors(COMMIT, theirs);
        assertGt(tsMine, 0);
        assertGt(tsTheirs, 0);
    }

    /// I-02: an owner whose registered key isn't ML-DSA-87 doesn't count as quantum-protected.
    function test_register_ownerMustUseMlDsa87() public {
        MockPQC(STATUS).setAlgorithm(anjali, 2);
        bytes memory sig = _sign(pubkey, reg.registerMessage(anjali));
        vm.expectRevert(abi.encodeWithSelector(QommitRegistry.OwnerNotQuantumProtected.selector, anjali));
        reg.register(anjali, pubkey, sig);
    }
}
