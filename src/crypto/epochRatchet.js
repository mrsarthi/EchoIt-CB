/**
 * Epoch HMAC-SHA256 Ratchet (Layer 3)
 * Provides offline-friendly, block-level key derivation.
 * Each Epoch is valid for 100 messages, improving performance and reliability
 * over per-message DH ratchets.
 */
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';
import localforage from 'localforage';
import { cryptoWorker } from './cryptoWorkerClient';
import { encryptContent, decryptContent } from '../services/storageEncryption';

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
 * Helper to save a session with at-rest encryption.
 */
async function saveEpochSession(id, session) {
    const encrypted = await encryptContent(JSON.stringify(session));
    if (!encrypted) {
        // Fallback to plain only if session key isn't set (graceful fail for dev)
        return await epochSessionStore.setItem(id, session);
    }
    return await epochSessionStore.setItem(id, { _encrypted: encrypted });
}

/**
 * Helper to load a session with at-rest decryption.
 */
async function getEpochSession(id) {
    const data = await epochSessionStore.getItem(id);
    if (!data) return null;
    if (data._encrypted) {
        const decrypted = await decryptContent(data._encrypted);
        return JSON.parse(decrypted);
    }
    return data; // Legacy or dev fallback
}

/**
 * Initialize an Epoch Ratchet session.
 */
export async function initEpochSession(peerAddress, rootKey) {
    const rootKeyBase64 = typeof rootKey === 'string' ? rootKey : encodeBase64(rootKey);
    const epochKey = await cryptoWorker.deriveEpochKey(rootKeyBase64, 0);
    const session = {
        peerAddress,
        rootKey: rootKeyBase64,
        epochIndex: 0,
        chainKey: epochKey, // Already base64 from worker
        messageIndex: 0,
        skippedKeys: {} // { "epoch:index": base64Key }
    };
    await saveEpochSession(peerAddress.toLowerCase(), session);
    return session;
}

/**
 * Encrypt using the Epoch Ratchet.
 */
export async function encryptEpoch(peerAddress, plaintext) {
    return await withLock(peerAddress, async () => {
        let session = await getEpochSession(peerAddress.toLowerCase());
        if (!session) return null;

        // Check if we need to roll over to a new epoch
        if (session.messageIndex >= EPOCH_MAX_MESSAGES) {
            session.epochIndex += 1;
            const newEpochKey = await cryptoWorker.deriveEpochKey(session.rootKey, session.epochIndex);
            session.chainKey = newEpochKey;
            session.messageIndex = 0;
        }

        const { messageKey, nextChainKey } = await cryptoWorker.ratchetMessageKey(session.chainKey);
        const index = session.messageIndex++;
        session.chainKey = nextChainKey;

        // Perform encryption via worker
        const { ciphertext, nonce } = await cryptoWorker.encryptSymmetric(plaintext, messageKey);

        await saveEpochSession(peerAddress.toLowerCase(), session);

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
        let originalSession = await getEpochSession(peerAddress.toLowerCase());
        if (!originalSession) return null;

        // Deep clone to prevent mutation on failed decryption
        let session = JSON.parse(JSON.stringify(originalSession));

        const { epochIndex, messageIndex } = header;

        // 1. Handle Epoch Skips
        if (epochIndex > session.epochIndex) {
            const newEpochKey = await cryptoWorker.deriveEpochKey(session.rootKey, epochIndex);
            session.epochIndex = epochIndex;
            session.chainKey = newEpochKey;
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
                        await saveEpochSession(peerAddress.toLowerCase(), session);
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
            const { messageKey, nextChainKey } = await cryptoWorker.ratchetMessageKey(session.chainKey);
            session.skippedKeys[`${epochIndex}:${session.messageIndex}`] = messageKey;
            session.chainKey = nextChainKey;
            session.messageIndex++;
        }

        // Derive current key
        const { messageKey, nextChainKey } = await cryptoWorker.ratchetMessageKey(session.chainKey);
        session.chainKey = nextChainKey;
        session.messageIndex++;

        try {
            const decrypted = await cryptoWorker.decryptSymmetric(ciphertext, nonce, messageKey);
            if (decrypted) {
                await saveEpochSession(peerAddress.toLowerCase(), session);
                return decrypted;
            } else {
                return null;
            }
        } catch (err) {
            return null;
        }
    });
}
