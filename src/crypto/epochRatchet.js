/**
 * Epoch HMAC-SHA256 Ratchet (Layer 3)
 * Provides offline-friendly, block-level key derivation.
 * Each Epoch is valid for 100 messages, improving performance and reliability
 * over per-message DH ratchets.
 */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';
import localforage from 'localforage';

const EPOCH_MAX_MESSAGES = 100;

const epochSessionStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'epoch_sessions',
});

/**
 * HMAC-SHA256 based KDF.
 */
async function hmacSha256(key, data) {
    const keyBuffer = typeof key === 'string' ? decodeBase64(key) : key;
    const dataBuffer = typeof data === 'string' ? decodeUTF8(data) : data;

    const importedKey = await window.crypto.subtle.importKey(
        'raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const signature = await window.crypto.subtle.sign('HMAC', importedKey, dataBuffer);
    return new Uint8Array(signature);
}

/**
 * Derive a 32-byte Epoch Key from a Root Key and Epoch Index.
 */
export async function deriveEpochKey(rootKey, epochIndex) {
    const label = `epoch_derivation_${epochIndex}`;
    return await hmacSha256(rootKey, label);
}

/**
 * Derive the next message key within the current epoch.
 */
export async function ratchetMessageKey(chainKey) {
    const messageKey = await hmacSha256(chainKey, 'message_key');
    const nextChainKey = await hmacSha256(chainKey, 'next_chain_key');
    
    return {
        messageKey: messageKey.slice(0, 32),
        nextChainKey: encodeBase64(nextChainKey)
    };
}

/**
 * Initialize an Epoch Ratchet session.
 */
export async function initEpochSession(peerAddress, rootKey) {
    const epochKey = await deriveEpochKey(rootKey, 0);
    const session = {
        peerAddress,
        rootKey: typeof rootKey === 'string' ? rootKey : encodeBase64(rootKey),
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

    // Perform encryption (XSalsa20-Poly1305)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(decodeUTF8(plaintext), nonce, messageKey);

    await epochSessionStore.setItem(peerAddress.toLowerCase(), session);

    return {
        ciphertext: encodeBase64(encrypted),
        nonce: encodeBase64(nonce),
        header: {
            epochIndex: session.epochIndex,
            messageIndex: index
        }
    };
}

/**
 * Decrypt using the Epoch Ratchet.
 */
export async function decryptEpoch(peerAddress, { ciphertext, nonce, header }) {
    console.log(`[DEBUG] decryptEpoch called for ${peerAddress}`);
    console.log(`[DEBUG] Payload header:`, header);
    
    let originalSession = await epochSessionStore.getItem(peerAddress.toLowerCase());
    if (!originalSession) {
        console.error(`[DEBUG] No epoch session found for ${peerAddress}`);
        return null;
    }

    // Deep clone to prevent mutation on failed decryption (DoS protection)
    let session = JSON.parse(JSON.stringify(originalSession));

    const { epochIndex, messageIndex } = header;

    // 1. Handle Epoch Skips
    if (epochIndex > session.epochIndex) {
        console.log(`[DEBUG] Rolling forward to epoch ${epochIndex}`);
        const newEpochKey = await deriveEpochKey(session.rootKey, epochIndex);
        session.epochIndex = epochIndex;
        session.chainKey = encodeBase64(newEpochKey);
        session.messageIndex = 0;
    }

    // 2. Handle Message Skips within Epoch
    if (messageIndex < session.messageIndex) {
        console.log(`[DEBUG] Handling out-of-order message: ${messageIndex} < ${session.messageIndex}`);
        const keyMapId = `${epochIndex}:${messageIndex}`;
        const key = session.skippedKeys[keyMapId];
        if (key) {
            try {
                const decrypted = nacl.secretbox.open(decodeBase64(ciphertext), decodeBase64(nonce), decodeBase64(key));
                if (decrypted) {
                    // Prevent replay attacks by deleting the used skipped key
                    delete session.skippedKeys[keyMapId];
                    await epochSessionStore.setItem(peerAddress.toLowerCase(), session);
                    return encodeUTF8(decrypted);
                }
            } catch (err) {
                return null;
            }
        }
        return null; // Old message, no key or decryption failed
    }

    // Skip ahead if needed
    while (session.messageIndex < messageIndex) {
        console.log(`[DEBUG] Skipping message index ${session.messageIndex}`);
        const { messageKey, nextChainKey } = await ratchetMessageKey(session.chainKey);
        session.skippedKeys[`${epochIndex}:${session.messageIndex}`] = encodeBase64(messageKey);
        session.chainKey = nextChainKey;
        session.messageIndex++;
    }

    // Derive current key
    const { messageKey, nextChainKey } = await ratchetMessageKey(session.chainKey);
    console.log(`[DEBUG] Derived messageKey (first 4 bytes): ${messageKey.slice(0,4)}`);
    session.chainKey = nextChainKey;
    session.messageIndex++;

    try {
        const decrypted = nacl.secretbox.open(decodeBase64(ciphertext), decodeBase64(nonce), messageKey);
        console.log(`[DEBUG] Decryption result: ${!!decrypted}`);
        
        if (decrypted) {
            // Only save advanced state if decryption actually succeeds
            await epochSessionStore.setItem(peerAddress.toLowerCase(), session);
            return encodeUTF8(decrypted);
        } else {
            return null; // Bad MAC, do not save session
        }
    } catch (err) {
        console.error(`[DEBUG] nacl.secretbox.open threw an error:`, err);
        return null;
    }
}
