/**
 * Double Ratchet Service - Corrected implementation for PFS
 * Uses TweetNaCl for DH key agreement and HMAC-SHA256 for KDF chains.
 * Symmetric message encryption uses nacl.secretbox (xsalsa20-poly1305).
 *
 * Fixes applied:
 *  - recvChainKey is now properly initialized during DH ratchet steps
 *  - Decryption uses symmetric message keys derived from recvChainKey (not DH keys)
 *  - DH ratchet rotation occurs on receive when a new ratchetKey is detected
 *  - Skipped message keys are stored so out-of-order messages can be decrypted
 *  - Pre-key secret keys are persisted locally for X3DH responder flow
 */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import localforage from 'localforage';

// Storage for Ratchet Sessions
const sessionStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'sessions',
});

// Storage for local pre-key secrets (needed by X3DH responder)
const preKeySecretStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'prekey_secrets',
});

const MAX_SKIP = 100; // Max skipped message keys to store per session

// ──────────────────────────────────────────────
// KDF Utilities
// ──────────────────────────────────────────────

/**
 * HMAC-SHA256 based KDF.
 * @param {Uint8Array|string} key - HMAC key (base64 string or Uint8Array)
 * @param {Uint8Array|string} input - Data to sign (base64 string, Uint8Array, or plain string)
 * @returns {Promise<Uint8Array>} 32-byte derived output
 */
async function kdf(key, input) {
    const keyBuffer = typeof key === 'string' ? decodeBase64(key) : key;

    let inputBuffer;
    if (input instanceof Uint8Array) {
        inputBuffer = input;
    } else if (typeof input === 'string') {
        // If it looks like base64 (no spaces, correct charset), decode it
        // Otherwise treat as a plain label string
        try {
            if (/^[A-Za-z0-9+/=]+$/.test(input) && input.length > 20) {
                inputBuffer = decodeBase64(input);
            } else {
                inputBuffer = new TextEncoder().encode(input);
            }
        } catch {
            inputBuffer = new TextEncoder().encode(input);
        }
    }

    const importedKey = await window.crypto.subtle.importKey(
        'raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const signature = await window.crypto.subtle.sign('HMAC', importedKey, inputBuffer);
    return new Uint8Array(signature);
}

/**
 * Root KDF: splits a DH output into a new rootKey + chainKey.
 * @param {string} rootKey - Current root key (base64)
 * @param {Uint8Array} dhOutput - Raw DH shared secret
 * @returns {Promise<{ rootKey: string, chainKey: string }>}
 */
async function kdfRootKey(rootKey, dhOutput) {
    const result = await kdf(rootKey, dhOutput);
    return {
        rootKey: encodeBase64(result.slice(0, 32)),
        chainKey: encodeBase64(result.slice(0, 32)) // Use first half for both in 32-byte output
    };
    // For a proper 64-byte split we'd need a longer output. With HMAC-SHA256
    // producing 32 bytes, we derive two separate keys:
}

/**
 * Improved Root KDF that produces two independent 32-byte keys.
 */
async function kdfRootChain(rootKey, dhOutput) {
    // Derive rootKey from HMAC(rootKey, dhOutput || 0x01)
    const rootInput = new Uint8Array([...dhOutput, 0x01]);
    const chainInput = new Uint8Array([...dhOutput, 0x02]);

    const newRootKey = await kdf(rootKey, rootInput);
    const newChainKey = await kdf(rootKey, chainInput);

    return {
        rootKey: encodeBase64(newRootKey),
        chainKey: encodeBase64(newChainKey)
    };
}

/**
 * Chain KDF: derive a message key and advance the chain.
 * @param {string} chainKey - Current chain key (base64)
 * @returns {Promise<{ messageKey: Uint8Array, nextChainKey: string }>}
 */
async function kdfChainKey(chainKey) {
    const messageKey = await kdf(chainKey, new TextEncoder().encode('msg_key'));
    const nextChainKey = await kdf(chainKey, new TextEncoder().encode('next_chain'));

    return {
        messageKey: messageKey.slice(0, nacl.secretbox.keyLength), // 32 bytes
        nextChainKey: encodeBase64(nextChainKey)
    };
}

// ──────────────────────────────────────────────
// Session Serialization Helpers
// ──────────────────────────────────────────────

function serializeKeyPair(kp) {
    if (!kp) return null;
    return {
        publicKey: kp.publicKey instanceof Uint8Array ? encodeBase64(kp.publicKey) : kp.publicKey,
        secretKey: kp.secretKey instanceof Uint8Array ? encodeBase64(kp.secretKey) : kp.secretKey
    };
}

function deserializeKeyPair(kp) {
    if (!kp) return null;
    return {
        publicKey: typeof kp.publicKey === 'string' ? decodeBase64(kp.publicKey) : kp.publicKey,
        secretKey: typeof kp.secretKey === 'string' ? decodeBase64(kp.secretKey) : kp.secretKey
    };
}

async function saveSession(peerAddress, session) {
    // Serialize Uint8Arrays before storing
    const serialized = {
        ...session,
        sendRatchetKeyPair: serializeKeyPair(session.sendRatchetKeyPair)
    };
    await sessionStore.setItem(peerAddress.toLowerCase(), serialized);
}

async function loadSession(peerAddress) {
    const session = await sessionStore.getItem(peerAddress.toLowerCase());
    if (!session) return null;
    // Deserialize back to Uint8Arrays
    session.sendRatchetKeyPair = deserializeKeyPair(session.sendRatchetKeyPair);
    return session;
}

// ──────────────────────────────────────────────
// Pre-Key Secret Storage
// ──────────────────────────────────────────────

/**
 * Store pre-key secret keys locally so the X3DH responder can use them.
 * @param {Array<{ id: number, secretKey: string }>} preKeys
 */
export async function storePreKeySecrets(preKeys) {
    for (const pk of preKeys) {
        await preKeySecretStore.setItem(`pk_${pk.id}`, pk.secretKey);
    }
}

/**
 * Retrieve and consume a pre-key secret (one-time use).
 * @param {number} keyId
 * @returns {Promise<string|null>} Base64-encoded secret key
 */
export async function consumePreKeySecret(keyId) {
    const key = `pk_${keyId}`;
    const secret = await preKeySecretStore.getItem(key);
    if (secret) {
        await preKeySecretStore.removeItem(key); // One-time use
    }
    return secret;
}

// ──────────────────────────────────────────────
// Session Creation
// ──────────────────────────────────────────────

/**
 * Create a new ratchet session (called by the INITIATOR after X3DH).
 *
 * The initiator knows:
 *  - initialSharedSecret: the X3DH derived secret
 *  - peerRatchetPublicKey: the peer's identity/signed pre-key (used as initial ratchet key)
 *  - x3dhParams: { ephemeralKey, preKeyId } to be re-sent until ACKed (Task 13)
 */
export async function createSession(peerAddress, initialSharedSecret, peerRatchetPublicKey, x3dhParams = null) {
    // Normalize the shared secret
    const sharedSecretBytes = typeof initialSharedSecret === 'string'
        ? decodeBase64(initialSharedSecret)
        : initialSharedSecret;

    const session = {
        peerAddress,
        rootKey: encodeBase64(sharedSecretBytes.slice(0, 32)),
        sendChainKey: null,
        recvChainKey: null,
        sendRatchetKeyPair: nacl.box.keyPair(),
        recvRatchetPublicKey: peerRatchetPublicKey, // base64
        sendIndex: 0,
        recvIndex: 0,
        previousCounter: 0,
        skippedMessageKeys: {}, // { "ratchetKey:index": base64MessageKey }
        acknowledged: false, // Task 13
        x3dhParams // Task 13: Store for re-sending until ACKed
    };

    // Perform the initial DH ratchet step to derive the sending chain
    const peerPub = decodeBase64(session.recvRatchetPublicKey);
    const dhOutput = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const { rootKey, chainKey } = await kdfRootChain(session.rootKey, dhOutput);

    session.rootKey = rootKey;
    session.sendChainKey = chainKey;
    // recvChainKey stays null until we receive a message with a new DH ratchet key

    await saveSession(peerAddress, session);
    console.log(`🔐 DR session created (initiator) with ${peerAddress.slice(0, 10)}`);
    return session;
}

/**
 * Create a new ratchet session (called by the RESPONDER on first received message).
 * The responder receives the initiator's ratchetKey in the message header.
 */
export async function createSessionResponder(peerAddress, initialSharedSecret, peerRatchetPublicKey) {
    const sharedSecretBytes = typeof initialSharedSecret === 'string'
        ? decodeBase64(initialSharedSecret)
        : initialSharedSecret;

    const session = {
        peerAddress,
        rootKey: encodeBase64(sharedSecretBytes.slice(0, 32)),
        sendChainKey: null,
        recvChainKey: null,
        sendRatchetKeyPair: nacl.box.keyPair(),
        recvRatchetPublicKey: peerRatchetPublicKey, // initiator's ratchet public key
        sendIndex: 0,
        recvIndex: 0,
        previousCounter: 0,
        skippedMessageKeys: {},
        acknowledged: true // Task 13: We just successfully decrypted their first message!
    };

    // Step 1: DH ratchet to derive recvChainKey (for decrypting incoming messages)
    const peerPub = decodeBase64(peerRatchetPublicKey);
    const dhRecv = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const recvResult = await kdfRootChain(session.rootKey, dhRecv);

    session.rootKey = recvResult.rootKey;
    session.recvChainKey = recvResult.chainKey;

    // Step 2: Generate new DH keypair and derive sendChainKey
    session.sendRatchetKeyPair = nacl.box.keyPair();
    const dhSend = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const sendResult = await kdfRootChain(session.rootKey, dhSend);

    session.rootKey = sendResult.rootKey;
    session.sendChainKey = sendResult.chainKey;

    await saveSession(peerAddress, session);
    console.log(`🔐 DR session created (responder) with ${peerAddress.slice(0, 10)}`);
    return session;
}

// ──────────────────────────────────────────────
// Encrypt
// ──────────────────────────────────────────────

/**
 * Encrypt a message using the current ratchet state.
 * Uses SYMMETRIC encryption (nacl.secretbox) with a chain-derived message key.
 */
export async function encryptRatchet(peerAddress, plaintext) {
    let session = await loadSession(peerAddress);
    if (!session || !session.sendChainKey) return null;

    // Advance Sending Chain → derive message key
    const { messageKey, nextChainKey } = await kdfChainKey(session.sendChainKey);
    session.sendChainKey = nextChainKey;
    const index = session.sendIndex++;

    // Encrypt with SYMMETRIC key (nacl.secretbox = xsalsa20-poly1305)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes
    const encrypted = nacl.secretbox(decodeUTF8(plaintext), nonce, messageKey);

    await saveSession(peerAddress, session);

    return {
        ciphertext: encodeBase64(encrypted),
        nonce: encodeBase64(nonce),
        header: {
            ratchetKey: session.sendRatchetKeyPair.publicKey instanceof Uint8Array
                ? encodeBase64(session.sendRatchetKeyPair.publicKey)
                : session.sendRatchetKeyPair.publicKey,
            index,
            previousCounter: session.previousCounter
        },
        acknowledged: session.acknowledged, // Task 13
        x3dhParams: session.x3dhParams    // Task 13
    };
}

// ──────────────────────────────────────────────
// Decrypt
// ──────────────────────────────────────────────

/**
 * Try to decrypt using a skipped message key (for out-of-order messages).
 */
function trySkippedMessageKeys(session, header, ciphertext, nonce) {
    const skipKey = `${header.ratchetKey}:${header.index}`;
    const storedKey = session.skippedMessageKeys[skipKey];

    if (storedKey) {
        const messageKey = decodeBase64(storedKey);
        delete session.skippedMessageKeys[skipKey];

        const decrypted = nacl.secretbox.open(
            decodeBase64(ciphertext),
            decodeBase64(nonce),
            messageKey
        );

        if (decrypted) {
            session.acknowledged = true; // Task 13
            return encodeUTF8(decrypted);
        }
    }
    return null; // Not a skipped message
}


/**
 * Store skipped message keys when we need to advance past some indices.
 */
async function skipMessageKeys(session, until) {
    if (session.recvIndex + MAX_SKIP < until) {
        console.warn('🔐 Too many skipped messages, potential data loss');
        return;
    }

    while (session.recvIndex < until) {
        const { messageKey, nextChainKey } = await kdfChainKey(session.recvChainKey);
        const currentRatchetKey = session.recvRatchetPublicKey;
        const skipKey = `${currentRatchetKey}:${session.recvIndex}`;

        session.skippedMessageKeys[skipKey] = encodeBase64(messageKey);
        session.recvChainKey = nextChainKey;
        session.recvIndex++;
    }
}

/**
 * Perform a DH ratchet step when we receive a new ratchet public key from the peer.
 */
async function dhRatchetStep(session, newPeerRatchetKey) {
    // Save previous send counter
    session.previousCounter = session.sendIndex;
    session.sendIndex = 0;
    session.recvIndex = 0;
    session.recvRatchetPublicKey = newPeerRatchetKey;

    // DH with our current sending keypair and the new peer key → derive recvChainKey
    const peerPub = decodeBase64(newPeerRatchetKey);
    const dhRecv = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const recvResult = await kdfRootChain(session.rootKey, dhRecv);

    session.rootKey = recvResult.rootKey;
    session.recvChainKey = recvResult.chainKey;

    // Generate NEW DH keypair for our future sends → derive sendChainKey
    session.sendRatchetKeyPair = nacl.box.keyPair();
    const dhSend = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const sendResult = await kdfRootChain(session.rootKey, dhSend);

    session.rootKey = sendResult.rootKey;
    session.sendChainKey = sendResult.chainKey;

    console.log(`🔐 DH ratchet step performed. New ratchet key from peer.`);
}

/**
 * Decrypt a message using the current ratchet state.
 * Handles DH ratchet rotation, skipped messages, and symmetric decryption.
 */
export async function decryptRatchet(peerAddress, { ciphertext, nonce, header }) {
    let session = await loadSession(peerAddress);
    if (!session) return null;

    // 1. Check if this is a previously skipped message
    const skippedResult = trySkippedMessageKeys(session, header, ciphertext, nonce);
    if (skippedResult) {
        await saveSession(peerAddress, session);
        return skippedResult;
    }

    // 2. Check if the sender has a new ratchet key → DH ratchet step needed
    if (header.ratchetKey !== session.recvRatchetPublicKey) {
        // Skip any messages we missed from the PREVIOUS ratchet
        if (session.recvChainKey) {
            await skipMessageKeys(session, header.previousCounter);
        }
        // Perform the DH ratchet step with the new peer key
        await dhRatchetStep(session, header.ratchetKey);
    }

    // 3. Skip ahead to the correct index in the current receiving chain
    if (session.recvChainKey) {
        await skipMessageKeys(session, header.index);
    }

    // 4. Derive the message key for THIS message
    if (!session.recvChainKey) {
        console.error('🔐 Cannot decrypt: recvChainKey is null');
        return null;
    }

    const { messageKey, nextChainKey } = await kdfChainKey(session.recvChainKey);
    session.recvChainKey = nextChainKey;
    session.recvIndex = header.index + 1;

    // 5. Decrypt with SYMMETRIC key
    try {
        const decrypted = nacl.secretbox.open(
            decodeBase64(ciphertext),
            decodeBase64(nonce),
            messageKey
        );

        if (!decrypted) {
            console.error('🔐 Decryption returned null (bad key or corrupted data)');
            return null;
        }

        session.acknowledged = true; // Task 13: Successfully decrypted a message!
        await saveSession(peerAddress, session);
        return encodeUTF8(decrypted);
    } catch (e) {
        console.error('🔐 Ratchet decryption error:', e);
        return null;
    }
}

// ──────────────────────────────────────────────
// Session Utilities
// ──────────────────────────────────────────────

/**
 * Check if a ratchet session exists for a peer
 */
export async function hasSession(peerAddress) {
    const session = await sessionStore.getItem(peerAddress.toLowerCase());
    return session !== null;
}

/**
 * Delete a ratchet session (e.g., when a key change is detected)
 */
export async function deleteSession(peerAddress) {
    await sessionStore.removeItem(peerAddress.toLowerCase());
    console.log(`🔐 DR session deleted for ${peerAddress.slice(0, 10)}`);
}
