import { encryptSymmetric, decryptSymmetric } from '../crypto/crypto';
import { hashArgon2 } from '../crypto/argon2Client';

// In-memory session key for local storage encryption (volatile)
let storageSessionKey = null;

/**
 * Set the session key for local storage encryption (derived from PIN)
 * @param {string} pin 
 * @param {string} address
 */
export async function setStorageSessionKey(pin, address = null) {
    if (!pin) {
        storageSessionKey = null;
        return;
    }

    // Derive a strong 32-byte key from the PIN using Argon2
    // Use the user's wallet address as salt for the hash
    const saltAddress = address || localStorage.getItem('decentrachat_address') || 'default_salt';
    
    const hash = await hashArgon2(pin, saltAddress.slice(0, 16));
    storageSessionKey = hash; 
    console.debug('🔐 Storage session key derived via Argon2 and cached');
}

/**
 * Internal helper to encrypt message content before saving
 */
export function encryptContent(message) {
    if (!storageSessionKey || !message.content || message._isEncrypted) return message;
    
    const { encrypted, nonce } = encryptSymmetric(message.content, storageSessionKey);
    return {
        ...message,
        content: encrypted,
        storageNonce: nonce,
        _isEncrypted: true
    };
}

/**
 * Internal helper to decrypt message content after loading
 */
export function decryptContent(message) {
    if (!storageSessionKey || !message._isEncrypted || !message.storageNonce) return message;
    
    try {
        const decrypted = decryptSymmetric(message.content, message.storageNonce, storageSessionKey);
        if (decrypted) {
            return {
                ...message,
                content: decrypted,
                _isEncrypted: false
            };
        }
    } catch (err) {
        console.error('Failed to decrypt local message:', err);
    }
    return { ...message, content: '[Decryption Failed]' };
}

/**
 * Get the current storage session key (for other services that need at-rest encryption)
 */
export function getStorageSessionKey() {
    return storageSessionKey;
}
