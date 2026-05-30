// Key Manager - Secure storage and management of encryption keys
import localforage from 'localforage';
import { generateKeyPair, deriveKeysFromSignature } from './crypto';

// Initialize local storage
const keyStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'keys',
});

const KEY_STORAGE_KEY = 'encryption_keys_v2'; // Task 8 uses v2 (encrypted)
const WALLET_ADDRESS_KEY = 'wallet_address';

// In-memory cache for decrypted keys to avoid PIN prompts during active session
let sessionKeys = null;

// --- Task 8: Local Encryption Helpers (Web Crypto API) ---

async function deriveMasterKey(pin, salt) {
    const encoder = new TextEncoder();
    const pinData = encoder.encode(pin);
    const baseKey = await window.crypto.subtle.importKey(
        'raw', pinData, 'PBKDF2', false, ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt keys with a PIN
 */
async function encryptWithPin(keys, pin) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const masterKey = await deriveMasterKey(pin, salt);

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(keys));
    const encryptedBlob = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        masterKey,
        data
    );

    return {
        encryptedBlob,
        salt: Array.from(salt),
        iv: Array.from(iv)
    };
}

/**
 * Decrypt keys with a PIN
 */
async function decryptWithPin(encryptedData, pin) {
    try {
        const salt = new Uint8Array(encryptedData.salt);
        const iv = new Uint8Array(encryptedData.iv);
        const masterKey = await deriveMasterKey(pin, salt);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            masterKey,
            encryptedData.encryptedBlob
        );

        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(decrypted));
    } catch (err) {
        throw new Error('Incorrect PIN or corrupted data');
    }
}

/**
 * Get or create encryption keys for a wallet
 * @param {string} walletAddress - The Ethereum wallet address
 * @param {Function} signMessageFn - Function to sign a message with wallet
 * @param {string} pin - Mandatory PIN for encryption
 * @returns {Promise<Object>} { publicKey, secretKey }
 */
export async function getOrCreateKeys(walletAddress, signMessageFn, pin) {
    if (!pin) throw new Error('PIN_REQUIRED');

    // If we have them in memory, return them
    if (sessionKeys && sessionKeys.address === walletAddress) {
        return sessionKeys;
    }

    // Check if we have stored keys for this wallet
    const storedAddress = await keyStore.getItem(WALLET_ADDRESS_KEY);

    if (storedAddress === walletAddress) {
        const encryptedData = await keyStore.getItem(KEY_STORAGE_KEY);
        if (encryptedData) {
            const keys = await decryptWithPin(encryptedData, pin);
            sessionKeys = keys;
            return keys;
        }
    }

    // Need to create new keys
    const message = `DecentraChat Key Generation\n\nThis signature will logically prove you own this wallet and generate your static end-to-end encryption keys.\nWallet: ${walletAddress.toLowerCase()}`;

    const signature = await signMessageFn(message);
    const keys = deriveKeysFromSignature(signature);

    const keysWithAddress = {
        ...keys,
        address: walletAddress,
    };

    // Store keys locally with mandatory PIN encryption
    await keyStore.setItem(WALLET_ADDRESS_KEY, walletAddress);
    const encrypted = await encryptWithPin(keysWithAddress, pin);
    await keyStore.setItem(KEY_STORAGE_KEY, encrypted);

    sessionKeys = keysWithAddress;
    return keysWithAddress;
}

/**
 * Unlock stored keys using a PIN
 */
export async function unlockKeys(pin) {
    if (!pin) throw new Error('PIN_REQUIRED');
    const encryptedData = await keyStore.getItem(KEY_STORAGE_KEY);
    if (!encryptedData) return null;

    const keys = await decryptWithPin(encryptedData, pin);
    sessionKeys = keys;
    return keys;
}

/**
 * Get stored keys (session cache first)
 * @returns {Promise<Object|null>}
 */
export async function getStoredKeys() {
    return sessionKeys;
}

/**
 * Get stored wallet address
 * @returns {Promise<string|null>}
 */
export async function getStoredWalletAddress() {
    return await keyStore.getItem(WALLET_ADDRESS_KEY);
}

/**
 * Clear all stored keys (for logout)
 */
export async function clearKeys() {
    await keyStore.removeItem(KEY_STORAGE_KEY);
    await keyStore.removeItem(WALLET_ADDRESS_KEY);
    sessionKeys = null;
}

/**
 * Check if keys exist for current session
 * @returns {Promise<boolean>}
 */
export async function hasStoredKeys() {
    if (sessionKeys) return true;
    const keys = await keyStore.getItem(KEY_STORAGE_KEY);
    return keys !== null;
}

/**
 * Store keys derived from a signature (for Electron hybrid auth)
 * @param {string} walletAddress - The Ethereum wallet address
 * @param {string} signature - The signature from browser auth
 * @param {string} pin - Mandatory PIN for encryption
 * @returns {Promise<Object>} { publicKey, secretKey, address }
 */
export async function storeKeysFromSignature(walletAddress, signature, pin) {
    if (!pin) throw new Error('PIN_REQUIRED');
    const keys = deriveKeysFromSignature(signature);

    const keysWithAddress = {
        ...keys,
        address: walletAddress,
    };

    // Store keys locally with mandatory PIN encryption
    await keyStore.setItem(WALLET_ADDRESS_KEY, walletAddress);
    const encrypted = await encryptWithPin(keysWithAddress, pin);
    await keyStore.setItem(KEY_STORAGE_KEY, encrypted);

    sessionKeys = keysWithAddress;
    return keysWithAddress;
}
