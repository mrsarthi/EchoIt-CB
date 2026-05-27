import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { cryptoWorker } from './cryptoWorkerClient';

/**
 * Generate a random 32-byte Symmetric Epoch Key for O(1) group messaging.
 * @returns {string} base64 encoded symmetric key
 */
export function generateEpochKey() {
    const key = nacl.randomBytes(nacl.secretbox.keyLength); // 32 bytes
    return encodeBase64(key);
}

/**
 * Deterministically ratchet the key forward using SHA-512 (truncated to 32 bytes).
 * Offloaded to Web Worker to prevent UI jank.
 * @param {string} currentKeyBase64 
 * @returns {Promise<string>} next key in the chain (base64)
 */
export async function ratchetEpochKey(currentKeyBase64) {
    return cryptoWorker.ratchetEpochKey(currentKeyBase64);
}

/**
 * Encrypt a message using the Symmetric Epoch Key and sign it for Sender Authentication.
 * Offloaded to Web Worker to prevent UI jank.
 * @param {string} epochKeyBase64 
 * @param {string} plaintext 
 * @param {string} myEd25519SecretBase64 
 * @param {string} messageId
 * @param {number} timestamp
 * @returns {Promise<Object>} { ciphertext, nonce, signature } as base64 strings
 */
export async function encryptGroupMessage(epochKeyBase64, plaintext, myEd25519SecretBase64, messageId, timestamp) {
    return cryptoWorker.encryptGroupMessage(epochKeyBase64, plaintext, myEd25519SecretBase64, messageId, timestamp);
}

/**
 * Verify a sender's signature and decrypt the group message.
 * Offloaded to Web Worker to prevent UI jank.
 * @param {string} epochKeyBase64 
 * @param {string} ciphertextBase64 
 * @param {string} nonceBase64 
 * @param {string} signatureBase64 
 * @param {string} senderPublicSignKeyBase64 
 * @param {string} messageId
 * @param {number} timestamp
 * @returns {Promise<string|null>} Decrypted string, or null if signature/MAC fails
 */
export async function decryptGroupMessage(epochKeyBase64, ciphertextBase64, nonceBase64, signatureBase64, senderPublicSignKeyBase64, messageId, timestamp) {
    try {
        return await cryptoWorker.decryptGroupMessage(epochKeyBase64, ciphertextBase64, nonceBase64, signatureBase64, senderPublicSignKeyBase64, messageId, timestamp);
    } catch (e) {
        console.error('Group Message Decryption Error (Worker):', e);
        return null;
    }
}
