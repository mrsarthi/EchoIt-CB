/**
 * Double Ratchet Service - Corrected implementation for PFS
 * Uses TweetNaCl for DH key agreement and HMAC-SHA256 for KDF chains.
 * Symmetric message encryption uses nacl.secretbox (xsalsa20-poly1305).
 */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import localforage from 'localforage';
import { encryptSymmetric, decryptSymmetric } from './crypto';

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
function encryptSensitive(data) {
    if (!storageSessionKey) return data;
    const str = JSON.stringify(data);
    const { encrypted, nonce } = encryptSymmetric(str, storageSessionKey);
    return { _isEncrypted: true, encrypted, nonce };
}

/**
 * Internal helper to decrypt sensitive state after loading
 */
function decryptSensitive(data) {
    if (!storageSessionKey || !data._isEncrypted) return data;
    try {
        const decrypted = decryptSymmetric(data.encrypted, data.nonce, storageSessionKey);
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
    const keyBuffer = typeof key === 'string' ? decodeBase64(key) : key;
    let inputBuffer;
    if (input instanceof Uint8Array) inputBuffer = input;
    else if (typeof input === 'string') {
        try {
            if (/^[A-Za-z0-9+/=]+$/.test(input) && input.length > 20) inputBuffer = decodeBase64(input);
            else inputBuffer = new TextEncoder().encode(input);
        } catch { inputBuffer = new TextEncoder().encode(input); }
    }
    const importedKey = await window.crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await window.crypto.subtle.sign('HMAC', importedKey, inputBuffer);
    return new Uint8Array(signature);
}

async function kdfRootChain(rootKey, dhOutput) {
    const rootInput = new Uint8Array([...dhOutput, 0x01]);
    const chainInput = new Uint8Array([...dhOutput, 0x02]);
    const newRootKey = await kdf(rootKey, rootInput);
    const newChainKey = await kdf(rootKey, chainInput);
    return { rootKey: encodeBase64(newRootKey), chainKey: encodeBase64(newChainKey) };
}

async function kdfChainKey(chainKey) {
    const messageKey = await kdf(chainKey, new TextEncoder().encode('msg_key'));
    const nextChainKey = await kdf(chainKey, new TextEncoder().encode('next_chain'));
    return { messageKey: messageKey.slice(0, nacl.secretbox.keyLength), nextChainKey: encodeBase64(nextChainKey) };
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
    const serialized = { ...session, sendRatchetKeyPair: serializeKeyPair(session.sendRatchetKeyPair) };
    const encrypted = encryptSensitive(serialized);
    await sessionStore.setItem(peerAddress.toLowerCase(), encrypted);
}

async function loadSession(peerAddress) {
    const data = await sessionStore.getItem(peerAddress.toLowerCase());
    if (!data) return null;
    const session = decryptSensitive(data);
    if (!session) return null;
    session.sendRatchetKeyPair = deserializeKeyPair(session.sendRatchetKeyPair);
    return session;
}

// ──────────────────────────────────────────────
// Pre-Key Secret Storage
// ──────────────────────────────────────────────

export async function storePreKeySecrets(preKeys) {
    for (const pk of preKeys) {
        const encrypted = encryptSensitive({ secretKey: pk.secretKey });
        await preKeySecretStore.setItem(`pk_${pk.id}`, encrypted);
    }
}

export async function consumePreKeySecret(keyId) {
    const key = `pk_${keyId}`;
    const data = await preKeySecretStore.getItem(key);
    if (data) {
        await preKeySecretStore.removeItem(key);
        const decrypted = decryptSensitive(data);
        return decrypted ? decrypted.secretKey : null;
    }
    return null;
}

// ──────────────────────────────────────────────
// Session Creation
// ──────────────────────────────────────────────

export async function createSession(peerAddress, initialSharedSecret, peerRatchetPublicKey, x3dhParams = null) {
    const sharedSecretBytes = typeof initialSharedSecret === 'string' ? decodeBase64(initialSharedSecret) : initialSharedSecret;
    const session = {
        peerAddress,
        rootKey: encodeBase64(sharedSecretBytes.slice(0, 32)),
        sendChainKey: null,
        recvChainKey: null,
        sendRatchetKeyPair: nacl.box.keyPair(),
        recvRatchetPublicKey: peerRatchetPublicKey,
        sendIndex: 0,
        recvIndex: 0,
        previousCounter: 0,
        skippedMessageKeys: {},
        acknowledged: false,
        x3dhParams
    };
    const peerPub = decodeBase64(session.recvRatchetPublicKey);
    const dhOutput = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const { rootKey, chainKey } = await kdfRootChain(session.rootKey, dhOutput);
    session.rootKey = rootKey;
    session.sendChainKey = chainKey;
    await saveSession(peerAddress, session);
    console.log(`🔐 DR session created (initiator) with ${peerAddress.slice(0, 10)}`);
    return session;
}

export async function createSessionResponder(peerAddress, initialSharedSecret, peerRatchetPublicKey, myRatchetSecretKey) {
    const sharedSecretBytes = typeof initialSharedSecret === 'string' ? decodeBase64(initialSharedSecret) : initialSharedSecret;
    const session = {
        peerAddress,
        rootKey: encodeBase64(sharedSecretBytes.slice(0, 32)),
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
    const peerPub = decodeBase64(peerRatchetPublicKey);
    const mySec = decodeBase64(myRatchetSecretKey);
    const dhRecv = nacl.box.before(peerPub, mySec);
    const recvResult = await kdfRootChain(session.rootKey, dhRecv);
    session.rootKey = recvResult.rootKey;
    session.recvChainKey = recvResult.chainKey;
    
    // Step 2: Initialize sending chain
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

export async function encryptRatchet(peerAddress, plaintext) {
    let session = await loadSession(peerAddress);
    if (!session || !session.sendChainKey) return null;
    const { messageKey, nextChainKey } = await kdfChainKey(session.sendChainKey);
    session.sendChainKey = nextChainKey;
    const index = session.sendIndex++;
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(decodeUTF8(plaintext), nonce, messageKey);
    await saveSession(peerAddress, session);
    return {
        ciphertext: encodeBase64(encrypted),
        nonce: encodeBase64(nonce),
        header: {
            ratchetKey: session.sendRatchetKeyPair.publicKey instanceof Uint8Array ? encodeBase64(session.sendRatchetKeyPair.publicKey) : session.sendRatchetKeyPair.publicKey,
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

function trySkippedMessageKeys(session, header, ciphertext, nonce) {
    const skipKey = `${header.ratchetKey}:${header.index}`;
    const storedKey = session.skippedMessageKeys[skipKey];
    if (storedKey) {
        const messageKey = decodeBase64(storedKey);
        delete session.skippedMessageKeys[skipKey];
        const decrypted = nacl.secretbox.open(decodeBase64(ciphertext), decodeBase64(nonce), messageKey);
        if (decrypted) {
            session.acknowledged = true;
            return encodeUTF8(decrypted);
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
    const peerPub = decodeBase64(newPeerRatchetKey);
    const dhRecv = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const recvResult = await kdfRootChain(session.rootKey, dhRecv);
    session.rootKey = recvResult.rootKey;
    session.recvChainKey = recvResult.chainKey;
    session.sendRatchetKeyPair = nacl.box.keyPair();
    const dhSend = nacl.box.before(peerPub, session.sendRatchetKeyPair.secretKey);
    const sendResult = await kdfRootChain(session.rootKey, dhSend);
    session.rootKey = sendResult.rootKey;
    session.sendChainKey = sendResult.chainKey;
    console.log(`🔐 DH ratchet step performed.`);
}

export async function decryptRatchet(peerAddress, { ciphertext, nonce, header }) {
    let session = await loadSession(peerAddress);
    if (!session) return null;
    const skippedResult = trySkippedMessageKeys(session, header, ciphertext, nonce);
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
        const decrypted = nacl.secretbox.open(decodeBase64(ciphertext), decodeBase64(nonce), messageKey);
        if (!decrypted) return null;
        session.acknowledged = true;
        await saveSession(peerAddress, session);
        return encodeUTF8(decrypted);
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
