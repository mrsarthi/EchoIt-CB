/**
 * Epoch HMAC-SHA256 Ratchet (Layer 3)
 * Provides offline-friendly, block-level key derivation.
 * Each Epoch is valid for 100 messages, improving performance and reliability
 * over per-message DH ratchets.
 */
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';
import localforage from 'localforage';
import { cryptoWorker } from './cryptoWorkerClient';

// Mutex for sequential ratchet operations per peer
const peerLocks = new Map();

async function withLock(peerAddress, asyncFn) {
    const key = peerAddress.toLowerCase();
    if (!peerLocks.has(key)) {
        peerLocks.set(key, Promise.resolve());
    }
    
    let release;
    const lockPromise = new Promise(resolve => release = resolve);
    
    const previous = peerLocks.get(key);
    peerLocks.set(key, previous.then(() => lockPromise));
    
    await previous;
    try {
        return await asyncFn();
    } finally {
        release();
    }
}

const EPOCH_MAX_MESSAGES = 100;

const epochSessionStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'epoch_sessions',
});

/**
 * Derive a 32-byte Epoch Key from a Root Key and Epoch Index.
 */
export async function deriveEpochKey(rootKey, epochIndex) {
    const label = `epoch_derivation_${epochIndex}`;
    const key = typeof rootKey === 'string' ? rootKey : encodeBase64(rootKey);
    const signature = await cryptoWorker.hmacSha256(key, label);
    return decodeBase64(signature);
}

/**
 * Derive the next message key within the current epoch.
 */
export async function ratchetMessageKey(chainKeyBase64) {
    const messageKeyBase64 = await cryptoWorker.hmacSha256(chainKeyBase64, 'message_key');
    const nextChainKeyBase64 = await cryptoWorker.hmacSha256(chainKeyBase64, 'next_chain_key');
    
    return {
        messageKey: decodeBase64(messageKeyBase64).slice(0, 32),
        nextChainKey: nextChainKeyBase64
    };
}

/**
 * Initialize an Epoch Ratchet session.
 */
export async function initEpochSession(peerAddress, rootKey) {
    const rootKeyBase64 = typeof rootKey === 'string' ? rootKey : encodeBase64(rootKey);
    const epochKey = await deriveEpochKey(rootKeyBase64, 0);
    const session = {
        peerAddress,
        rootKey: rootKeyBase64,
        epochIndex: 0,
        chainKey: encodeBase64(epochKey),
        messageIndex: 0,
        skippedKeys: {} // { "epoch:index": base64Key }
    };
    await epochSessionStore.setItem(peerAddress.toLowerCase(), session);
    return session;
}

/**
 * Encrypt using the Epoch Ratchet.
 */
export async function encryptEpoch(peerAddress, plaintext) {
    return await withLock(peerAddress, async () => {
        let session = await epochSessionStore.getItem(peerAddress.toLowerCase());
        if (!session) return null;

        // Check if we need to roll over to a new epoch
        if (session.messageIndex >= EPOCH_MAX_MESSAGES) {
            session.epochIndex += 1;
            const newEpochKey = await deriveEpochKey(session.rootKey, session.epochIndex);
            session.chainKey = encodeBase64(newEpochKey);
            session.messageIndex = 0;
        }

        const { messageKey, nextChainKey } = await ratchetMessageKey(session.chainKey);
        const index = session.messageIndex++;
        session.chainKey = nextChainKey;

        // Perform encryption via worker
        const { ciphertext, nonce } = await cryptoWorker.encryptSymmetric(plaintext, encodeBase64(messageKey));

        await epochSessionStore.setItem(peerAddress.toLowerCase(), session);

        return {
            ciphertext,
            nonce,
            header: {
                epochIndex: session.epochIndex,
                messageIndex: index
            }
        };
    });
}

/**
 * Decrypt using the Epoch Ratchet.
 */
export async function decryptEpoch(peerAddress, { ciphertext, nonce, header }) {
    return await withLock(peerAddress, async () => {
        let originalSession = await epochSessionStore.getItem(peerAddress.toLowerCase());
        if (!originalSession) return null;

        // Deep clone to prevent mutation on failed decryption
        let session = JSON.parse(JSON.stringify(originalSession));

        const { epochIndex, messageIndex } = header;

        // 1. Handle Epoch Skips
        if (epochIndex > session.epochIndex) {
            const newEpochKey = await deriveEpochKey(session.rootKey, epochIndex);
            session.epochIndex = epochIndex;
            session.chainKey = encodeBase64(newEpochKey);
            session.messageIndex = 0;
        }

        // 2. Handle Message Skips within Epoch
        if (messageIndex < session.messageIndex) {
            const keyMapId = `${epochIndex}:${messageIndex}`;
            const key = session.skippedKeys[keyMapId];
            if (key) {
                try {
                    const decrypted = await cryptoWorker.decryptSymmetric(ciphertext, nonce, key);
                    if (decrypted) {
                        delete session.skippedKeys[keyMapId];
                        await epochSessionStore.setItem(peerAddress.toLowerCase(), session);
                        return decrypted;
                    }
                } catch (err) {
                    return null;
                }
            }
            return null;
        }

        // Skip ahead if needed
        while (session.messageIndex < messageIndex) {
            const { messageKey, nextChainKey } = await ratchetMessageKey(session.chainKey);
            session.skippedKeys[`${epochIndex}:${session.messageIndex}`] = encodeBase64(messageKey);
            session.chainKey = nextChainKey;
            session.messageIndex++;
        }

        // Derive current key
        const { messageKey, nextChainKey } = await ratchetMessageKey(session.chainKey);
        session.chainKey = nextChainKey;
        session.messageIndex++;

        try {
            const decrypted = await cryptoWorker.decryptSymmetric(ciphertext, nonce, encodeBase64(messageKey));
            if (decrypted) {
                await epochSessionStore.setItem(peerAddress.toLowerCase(), session);
                return decrypted;
            } else {
                return null;
            }
        } catch (err) {
            return null;
        }
    });
}
