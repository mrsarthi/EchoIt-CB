/**
 * Double Ratchet Service - Corrected implementation for PFS
 * Uses TweetNaCl for DH key agreement and HMAC-SHA256 for KDF chains.
 * Symmetric message encryption uses nacl.secretbox (xsalsa20-poly1305).
 */
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import localforage from 'localforage';
import { cryptoWorker } from './cryptoWorkerClient';

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

// In-memory session key (mirrored from storageService or imported)
let storageSessionKey = null;

/**
 * Update the session key for cryptographic storage (called from WalletContext)
 */
export function setCryptoSessionKey(key) {
    storageSessionKey = key;
}

/**
 * Internal helper to encrypt sensitive state before saving
 */
async function encryptSensitive(data) {
    if (!storageSessionKey) return data;
    const str = JSON.stringify(data);
    const { ciphertext, nonce } = await cryptoWorker.encryptSymmetric(str, storageSessionKey);
    return { _isEncrypted: true, encrypted: ciphertext, nonce };
}

/**
 * Internal helper to decrypt sensitive state after loading
 */
async function decryptSensitive(data) {
    if (!storageSessionKey || !data._isEncrypted) return data;
    try {
        const decrypted = await cryptoWorker.decryptSymmetric(data.encrypted, data.nonce, storageSessionKey);
        return decrypted ? JSON.parse(decrypted) : null;
    } catch (err) {
        console.error('Failed to decrypt sensitive DR state:', err);
        return null;
    }
}

const MAX_SKIP = 100;

// ──────────────────────────────────────────────
// KDF Utilities
// ──────────────────────────────────────────────

async function kdf(key, input) {
    const keyBase64 = typeof key === 'string' ? key : encodeBase64(key);
    let inputToWorker = input;
    if (input instanceof Uint8Array) inputToWorker = encodeBase64(input);
    
    const signature = await cryptoWorker.hmacSha256(keyBase64, inputToWorker);
    return decodeBase64(signature);
}

async function kdfRootChain(rootKey, dhOutput) {
    const rootInput = new Uint8Array([...dhOutput, 0x01]);
    const chainInput = new Uint8Array([...dhOutput, 0x02]);
    const newRootKey = await kdf(rootKey, rootInput);
    const newChainKey = await kdf(rootKey, chainInput);
    return { rootKey: encodeBase64(newRootKey), chainKey: encodeBase64(newChainKey) };
}

async function kdfChainKey(chainKey) {
    const messageKey = await kdf(chainKey, 'msg_key');
    const nextChainKey = await kdf(chainKey, 'next_chain');
    return { messageKey: messageKey.slice(0, 32), nextChainKey: encodeBase64(nextChainKey) };
}

// ──────────────────────────────────────────────
// Session Serialization Helpers
// ──────────────────────────────────────────────

function serializeKeyPair(kp) {
    if (!kp) return null;
    return {
        publicKey: kp.publicKey,
        secretKey: kp.secretKey
    };
}

function deserializeKeyPair(kp) {
    if (!kp) return null;
    return {
        publicKey: kp.publicKey,
        secretKey: kp.secretKey
    };
}

async function saveSession(peerAddress, session) {
    const encrypted = await encryptSensitive(session);
    await sessionStore.setItem(peerAddress.toLowerCase(), encrypted);
}

async function loadSession(peerAddress) {
    const data = await sessionStore.getItem(peerAddress.toLowerCase());
    if (!data) return null;
    const session = await decryptSensitive(data);
    return session;
}

// ──────────────────────────────────────────────
// Pre-Key Secret Storage
// ──────────────────────────────────────────────

export async function storePreKeySecrets(preKeys) {
    for (const pk of preKeys) {
        const encrypted = await encryptSensitive({ secretKey: pk.secretKey instanceof Uint8Array ? encodeBase64(pk.secretKey) : pk.secretKey });
        await preKeySecretStore.setItem(`pk_${pk.id}`, encrypted);
    }
}

export async function consumePreKeySecret(keyId) {
    const key = `pk_${keyId}`;
    const data = await preKeySecretStore.getItem(key);
    if (data) {
        await preKeySecretStore.removeItem(key);
        const decrypted = await decryptSensitive(data);
        return decrypted ? decrypted.secretKey : null;
    }
    return null;
}

// ──────────────────────────────────────────────
// Session Creation
// ──────────────────────────────────────────────

export async function createSession(peerAddress, initialSharedSecret, peerRatchetPublicKey, x3dhParams = null) {
    const sharedSecretBase64 = typeof initialSharedSecret === 'string' ? initialSharedSecret : encodeBase64(initialSharedSecret);
    const newKeyPair = await cryptoWorker.generateKeyPair();
    
    const session = {
        peerAddress,
        rootKey: encodeBase64(decodeBase64(sharedSecretBase64).slice(0, 32)),
        sendChainKey: null,
        recvChainKey: null,
        sendRatchetKeyPair: newKeyPair,
        recvRatchetPublicKey: peerRatchetPublicKey,
        sendIndex: 0,
        recvIndex: 0,
        previousCounter: 0,
        skippedMessageKeys: {},
        acknowledged: false,
        x3dhParams
    };

    const dhOutputBase64 = await cryptoWorker.dhBefore(session.recvRatchetPublicKey, session.sendRatchetKeyPair.secretKey);
    const dhOutput = decodeBase64(dhOutputBase64);

    const { rootKey, chainKey } = await kdfRootChain(session.rootKey, dhOutput);
    session.rootKey = rootKey;
    session.sendChainKey = chainKey;
    await saveSession(peerAddress, session);
    console.log(`🔐 DR session created (initiator) with ${peerAddress.slice(0, 10)}`);
    return session;
}

export async function createSessionResponder(peerAddress, initialSharedSecret, peerRatchetPublicKey, myRatchetSecretKey) {
    const sharedSecretBase64 = typeof initialSharedSecret === 'string' ? initialSharedSecret : encodeBase64(initialSharedSecret);
    const session = {
        peerAddress,
        rootKey: encodeBase64(decodeBase64(sharedSecretBase64).slice(0, 32)),
        sendChainKey: null,
        recvChainKey: null,
        sendRatchetKeyPair: null,
        recvRatchetPublicKey: peerRatchetPublicKey,
        sendIndex: 0,
        recvIndex: 0,
        previousCounter: 0,
        skippedMessageKeys: {},
        acknowledged: true
    };
    
    // Step 1: Initialize receiving chain (matches Initiator's sending chain)
    const mySec = typeof myRatchetSecretKey === 'string' ? myRatchetSecretKey : encodeBase64(myRatchetSecretKey);
    const dhRecvBase64 = await cryptoWorker.dhBefore(peerRatchetPublicKey, mySec);
    const dhRecv = decodeBase64(dhRecvBase64);

    const recvResult = await kdfRootChain(session.rootKey, dhRecv);
    session.rootKey = recvResult.rootKey;
    session.recvChainKey = recvResult.chainKey;
    
    // Step 2: Initialize sending chain
    session.sendRatchetKeyPair = await cryptoWorker.generateKeyPair();
    const dhSendBase64 = await cryptoWorker.dhBefore(peerRatchetPublicKey, session.sendRatchetKeyPair.secretKey);
    const dhSend = decodeBase64(dhSendBase64);

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

export async function encryptRatchet(peerAddress, plaintext) {
    let session = await loadSession(peerAddress);
    if (!session || !session.sendChainKey) return null;
    const { messageKey, nextChainKey } = await kdfChainKey(session.sendChainKey);
    session.sendChainKey = nextChainKey;
    const index = session.sendIndex++;
    
    const { ciphertext, nonce } = await cryptoWorker.encryptSymmetric(plaintext, encodeBase64(messageKey));

    await saveSession(peerAddress, session);
    return {
        ciphertext,
        nonce,
        header: {
            ratchetKey: session.sendRatchetKeyPair.publicKey,
            index,
            previousCounter: session.previousCounter
        },
        acknowledged: session.acknowledged,
        x3dhParams: session.x3dhParams
    };
}

// ──────────────────────────────────────────────
// Decrypt
// ──────────────────────────────────────────────

async function trySkippedMessageKeys(session, header, ciphertext, nonce) {
    const skipKey = `${header.ratchetKey}:${header.index}`;
    const storedKey = session.skippedMessageKeys[skipKey];
    if (storedKey) {
        try {
            const decrypted = await cryptoWorker.decryptSymmetric(ciphertext, nonce, storedKey);
            if (decrypted) {
                delete session.skippedMessageKeys[skipKey];
                session.acknowledged = true;
                return decrypted;
            }
        } catch (err) {
            return null;
        }
    }
    return null;
}

async function skipMessageKeys(session, until) {
    if (session.recvIndex + MAX_SKIP < until) return;
    while (session.recvIndex < until) {
        const { messageKey, nextChainKey } = await kdfChainKey(session.recvChainKey);
        const currentRatchetKey = session.recvRatchetPublicKey;
        const skipKey = `${currentRatchetKey}:${session.recvIndex}`;
        session.skippedMessageKeys[skipKey] = encodeBase64(messageKey);
        session.recvChainKey = nextChainKey;
        session.recvIndex++;
    }
}

async function dhRatchetStep(session, newPeerRatchetKey) {
    session.previousCounter = session.sendIndex;
    session.sendIndex = 0;
    session.recvIndex = 0;
    session.recvRatchetPublicKey = newPeerRatchetKey;
    
    const dhRecvBase64 = await cryptoWorker.dhBefore(newPeerRatchetKey, session.sendRatchetKeyPair.secretKey);
    const dhRecv = decodeBase64(dhRecvBase64);

    const recvResult = await kdfRootChain(session.rootKey, dhRecv);
    session.rootKey = recvResult.rootKey;
    session.recvChainKey = recvResult.chainKey;
    
    session.sendRatchetKeyPair = await cryptoWorker.generateKeyPair();
    const dhSendBase64 = await cryptoWorker.dhBefore(newPeerRatchetKey, session.sendRatchetKeyPair.secretKey);
    const dhSend = decodeBase64(dhSendBase64);

    const sendResult = await kdfRootChain(session.rootKey, dhSend);
    session.rootKey = sendResult.rootKey;
    session.sendChainKey = sendResult.chainKey;
    console.log(`🔐 DH ratchet step performed.`);
}

export async function decryptRatchet(peerAddress, { ciphertext, nonce, header }) {
    let session = await loadSession(peerAddress);
    if (!session) return null;
    const skippedResult = await trySkippedMessageKeys(session, header, ciphertext, nonce);
    if (skippedResult) { await saveSession(peerAddress, session); return skippedResult; }
    if (header.ratchetKey !== session.recvRatchetPublicKey) {
        if (session.recvChainKey) await skipMessageKeys(session, header.previousCounter);
        await dhRatchetStep(session, header.ratchetKey);
    }
    if (session.recvChainKey) await skipMessageKeys(session, header.index);
    if (!session.recvChainKey) return null;
    const { messageKey, nextChainKey } = await kdfChainKey(session.recvChainKey);
    session.recvChainKey = nextChainKey;
    session.recvIndex = header.index + 1;
    try {
        const decrypted = await cryptoWorker.decryptSymmetric(ciphertext, nonce, encodeBase64(messageKey));
        if (!decrypted) return null;
        session.acknowledged = true;
        await saveSession(peerAddress, session);
        return decrypted;
    } catch { return null; }
}

export async function hasSession(peerAddress) {
    const data = await sessionStore.getItem(peerAddress.toLowerCase());
    return data !== null;
}

export async function deleteSession(peerAddress) {
    await sessionStore.removeItem(peerAddress.toLowerCase());
    console.log(`🔐 DR session deleted for ${peerAddress.slice(0, 10)}`);
}

export async function getSessionRootKey(peerAddress) {
    const session = await loadSession(peerAddress);
    return session ? session.rootKey : null;
}
