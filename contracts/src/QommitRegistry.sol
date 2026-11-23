// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev QoreChain's built-in post-quantum precompiles (active on the qorechain-diana testnet).
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

/// @title QommitRegistry
/// @notice Public directory of Qommit git-signing keys (ML-DSA-87) and the QoreChain accounts they belong to,
///         plus timestamped release anchors that prove a commit was signed before a given block.
/// @dev Every state change is authorised by an ML-DSA-87 signature from the Qommit key itself, verified on-chain by
///      the pqcVerify precompile. So anyone may relay a transaction, but nobody can forge one. Messages are
///      domain-separated and bound to this chain and this contract, so a signature can't be replayed elsewhere.
///      The owner's side of the link (the account saying "this key is mine") is a hybrid-signed QoreChain
///      transaction with memo "qommit:bind:v1:<fingerprint>"; verifiers check both sides.
contract QommitRegistry {
    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);

    uint256 internal constant ML_DSA_87_PUBKEY_LENGTH = 2592;

    /// @dev `owner` is the account the KEY claims to belong to (signed by the key). The owner's consent is published
    ///      separately, on QoreChain's native lane, as a hybrid-signed "qommit:bind:v1:<fingerprint>" memo (QoreX can't
    ///      sign EVM transactions yet). Integrators must check that bind before treating `owner` as proven.
    struct Key {
        address owner; // the QoreChain account the key claims (same 20 bytes as its qor1… address)
        uint64 registeredAt; // block timestamp
        uint64 revokedAt; // 0 while active
    }

    struct Anchor {
        uint64 timestamp;
        uint64 blockNumber;
    }

    /// @notice keyId = keccak256(ML-DSA-87 public key)
    mapping(bytes32 keyId => Key) public keys;
    /// @notice git commit (SHA-1) => signing key => first anchor by that key. Per key, so nobody can block another
    ///         signer's timestamp by anchoring the same public commit first.
    mapping(bytes20 commit => mapping(bytes32 keyId => Anchor)) public anchors;

    event KeyRegistered(bytes32 indexed keyId, address indexed owner, bytes pubkey);
    event KeyRevoked(bytes32 indexed keyId, address indexed owner);
    event CommitAnchored(bytes20 indexed commit, bytes32 indexed keyId, address indexed owner);

    error InvalidPublicKey();
    error InvalidSignature();
    error OwnerNotQuantumProtected(address owner);
    error AlreadyRegistered(bytes32 keyId);
    error UnknownKey(bytes32 keyId);
    error KeyIsRevoked(bytes32 keyId);
    error AlreadyAnchored(bytes20 commit);

    // ---------------------------------------------------------------- messages the Qommit key signs

    function registerMessage(address owner) public view returns (bytes memory) {
        return abi.encodePacked("qommit:register:v1", block.chainid, address(this), owner);
    }

    function revokeMessage() public view returns (bytes memory) {
        return abi.encodePacked("qommit:revoke:v1", block.chainid, address(this));
    }

    function anchorMessage(bytes20 commit) public view returns (bytes memory) {
        return abi.encodePacked("qommit:anchor:v1", block.chainid, address(this), commit);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Register a Qommit key as belonging to `owner`. `sig` is the key's signature over registerMessage(owner).
    /// @dev `owner` must have a registered ML-DSA-87 account key on QoreChain, so the identity itself is
    ///      quantum-protected.
    function register(address owner, bytes calldata pubkey, bytes calldata sig) external returns (bytes32 keyId) {
        if (pubkey.length != ML_DSA_87_PUBKEY_LENGTH) revert InvalidPublicKey();
        keyId = keccak256(pubkey);
        if (keys[keyId].registeredAt != 0) revert AlreadyRegistered(keyId);
        (bool ownerRegistered, uint8 algorithmId,,) = PQC_STATUS.pqcKeyStatus(owner);
        if (!ownerRegistered || algorithmId != 1) revert OwnerNotQuantumProtected(owner); // 1 = ML-DSA-87
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, registerMessage(owner))) revert InvalidSignature();

        keys[keyId] = Key({owner: owner, registeredAt: uint64(block.timestamp), revokedAt: 0});
        emit KeyRegistered(keyId, owner, pubkey);
    }

    /// @notice Revoke a key (e.g. a laptop was lost). `sig` is the key's signature over revokeMessage().
    function revoke(bytes calldata pubkey, bytes calldata sig) external {
        bytes32 keyId = _activeKey(pubkey);
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, revokeMessage())) revert InvalidSignature();
        keys[keyId].revokedAt = uint64(block.timestamp);
        emit KeyRevoked(keyId, keys[keyId].owner);
    }

    /// @notice Timestamp a signed git commit: proof it was signed with this post-quantum key no later than now.
    ///         Only the first anchor per (commit, key) is kept.
    function anchor(bytes calldata pubkey, bytes20 commit, bytes calldata sig) external {
        bytes32 keyId = _activeKey(pubkey);
        if (anchors[commit][keyId].timestamp != 0) revert AlreadyAnchored(commit);
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, anchorMessage(commit))) revert InvalidSignature();
        anchors[commit][keyId] = Anchor({timestamp: uint64(block.timestamp), blockNumber: uint64(block.number)});
        emit CommitAnchored(commit, keyId, keys[keyId].owner);
    }

    // ---------------------------------------------------------------- views

    /// @notice Owner of an active key, or address(0) if unknown or revoked.
    function ownerOf(bytes32 keyId) external view returns (address) {
        Key memory k = keys[keyId];
        return k.revokedAt == 0 ? k.owner : address(0);
    }

    function _activeKey(bytes calldata pubkey) internal view returns (bytes32 keyId) {
        keyId = keccak256(pubkey);
        Key memory k = keys[keyId];
        if (k.registeredAt == 0) revert UnknownKey(keyId);
        if (k.revokedAt != 0) revert KeyIsRevoked(keyId);
    }
}
