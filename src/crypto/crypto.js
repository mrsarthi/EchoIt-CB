// Crypto utilities for end-to-end encryption using TweetNaCl
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

/**
 * Generate a new encryption key pair
 * @returns {Object} { publicKey, secretKey } both as base64 strings
 */
export function generateKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

/**
 * Generate a signing key pair for message authentication
 * @returns {Object} { publicKey, secretKey } both as base64 strings
 */
export function generateSigningKeyPair() {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

/**
 * Encrypt a message for a recipient
 * @param {string} message - The plaintext message
 * @param {string} recipientPublicKey - Recipient's public key (base64)
 * @param {string} senderSecretKey - Sender's secret key (base64)
 * @returns {Object} { encrypted, nonce } both as base64 strings
 */
export function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = decodeUTF8(message);
  const recipientPubKey = decodeBase64(recipientPublicKey);
  const senderSecKey = decodeBase64(senderSecretKey);

  const encrypted = nacl.box(messageUint8, nonce, recipientPubKey, senderSecKey);

  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a message from a sender
 * @param {string} encryptedMessage - The encrypted message (base64)
 * @param {string} nonce - The nonce used for encryption (base64)
 * @param {string} senderPublicKey - Sender's public key (base64)
 * @param {string} recipientSecretKey - Recipient's secret key (base64)
 * @returns {string|null} The decrypted message or null if failed
 */
export function decryptMessage(encryptedMessage, nonce, senderPublicKey, recipientSecretKey) {
  try {
    const encryptedUint8 = decodeBase64(encryptedMessage);
    const nonceUint8 = decodeBase64(nonce);
    const senderPubKey = decodeBase64(senderPublicKey);
    const recipientSecKey = decodeBase64(recipientSecretKey);

    const decrypted = nacl.box.open(encryptedUint8, nonceUint8, senderPubKey, recipientSecKey);

    if (!decrypted) {
      return null;
    }

    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

/**
 * Sign a message
 * @param {string} message - The message to sign
 * @param {string} secretKey - The signing secret key (base64)
 * @returns {string} The signature (base64)
 */
export function signMessage(message, secretKey) {
  const messageUint8 = decodeUTF8(message);
  const secKey = decodeBase64(secretKey);
  const signature = nacl.sign.detached(messageUint8, secKey);
  return encodeBase64(signature);
}

/**
 * Verify a message signature
 * @param {string} message - The original message
 * @param {string} signature - The signature (base64)
 * @param {string} publicKey - The signer's public key (base64)
 * @returns {boolean} True if valid
 */
export function verifySignature(message, signature, publicKey) {
  try {
    const messageUint8 = decodeUTF8(message);
    const signatureUint8 = decodeBase64(signature);
    const pubKey = decodeBase64(publicKey);
    return nacl.sign.detached.verify(messageUint8, signatureUint8, pubKey);
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Derive encryption keys from an Ethereum wallet signature
 * This creates deterministic keys from the wallet's signature
 * @param {string} signature - The signature from wallet (hex string)
 * @returns {Object} { publicKey, secretKey } both as base64 strings
 */
export function deriveKeysFromSignature(signature) {
  // Remove '0x' prefix if present and convert to Uint8Array
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
  const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  
  // Use first 32 bytes of signature as seed
  const seed = sigBytes.slice(0, 32);
  
  // Generate key pair from seed
  const keyPair = nacl.box.keyPair.fromSecretKey(seed);
  
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

/**
 * Generate a symmetric key for media chunk encryption
 * @returns {string} The symmetric key (base64)
 */
export function generateSymmetricKey() {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

/**
 * Encrypt a payload symmetrically
 * @param {string|Uint8Array} payload - Data to encrypt (string or Uint8Array)
 * @param {string} secretKey - Symmetric key (base64)
 * @returns {Object} { encrypted, nonce } both as base64 strings
 */
export function encryptSymmetric(payload, secretKey) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const payloadUint8 = typeof payload === 'string' ? decodeUTF8(payload) : payload;
  const secKey = decodeBase64(secretKey);

  const encrypted = nacl.secretbox(payloadUint8, nonce, secKey);

  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a symmetrically encrypted payload
 * @param {string} encryptedPayload - Encrypted data (base64)
 * @param {string} nonce - The nonce (base64)
 * @param {string} secretKey - Symmetric key (base64)
 * @param {boolean} returnString - If true, returns decoded string. If false, returns Uint8Array.
 * @returns {string|Uint8Array|null} Decrypted payload or null if failed
 */
export function decryptSymmetric(encryptedPayload, nonce, secretKey, returnString = true) {
  try {
    const encryptedUint8 = decodeBase64(encryptedPayload);
    const nonceUint8 = decodeBase64(nonce);
    const secKey = decodeBase64(secretKey);

    const decrypted = nacl.secretbox.open(encryptedUint8, nonceUint8, secKey);

    if (!decrypted) {
      return null;
    }

    return returnString ? encodeUTF8(decrypted) : decrypted;
  } catch (error) {
    console.error('Symmetric decryption failed:', error);
    return null;
  }
}
