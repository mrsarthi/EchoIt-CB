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
 * Derive encryption and signing keys from an Ethereum wallet signature.
 * This creates deterministic keys from the wallet's signature.
 * @param {string} signature - The signature from wallet (hex string)
 * @returns {Object} { publicKey, secretKey, signingPublicKey, signingSecretKey } as base64 strings
 */
export function deriveKeysFromSignature(signature) {
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
  const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  
  const encryptionSeed = sigBytes.slice(0, 32);
  const encryptionKeyPair = nacl.box.keyPair.fromSecretKey(encryptionSeed);

  const signingSeed = sigBytes.length >= 64 ? sigBytes.slice(32, 64) : nacl.hash(encryptionSeed).slice(0, 32);
  const signingKeyPair = nacl.sign.keyPair.fromSeed(signingSeed);
  
  return {
    publicKey: encodeBase64(encryptionKeyPair.publicKey),
    secretKey: encodeBase64(encryptionKeyPair.secretKey),
    signingPublicKey: encodeBase64(signingKeyPair.publicKey),
    signingSecretKey: encodeBase64(signingKeyPair.secretKey),
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
  const key = decodeBase64(secretKey);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = typeof payload === 'string' ? decodeUTF8(payload) : payload;
  
  const encrypted = nacl.secretbox(message, nonce, key);
  
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

/**
 * Decrypt a payload symmetrically
 * @param {string} encrypted - Encrypted data (base64)
 * @param {string} nonce - Nonce (base64)
 * @param {string} secretKey - Symmetric key (base64)
 * @param {boolean} returnString - Whether to return UTF8 string or Uint8Array
 * @returns {string|Uint8Array|null} Decrypted data or null if failed
 */
export function decryptSymmetric(encrypted, nonce, secretKey, returnString = true) {
  try {
    const key = decodeBase64(secretKey);
    const decodedNonce = decodeBase64(nonce);
    const decodedEncrypted = decodeBase64(encrypted);
    
    const decrypted = nacl.secretbox.open(decodedEncrypted, decodedNonce, key);
    
    if (!decrypted) {
      return null;
    }

    return returnString ? encodeUTF8(decrypted) : decrypted;
  } catch (error) {
    console.error('Symmetric decryption failed:', error);
    return null;
  }
}

/**
 * Encrypt a message using asymmetric encryption (static box)
 * @param {string} message - Plaintext message
 * @param {string} recipientPublicKey - Recipient's public key (base64)
 * @param {string} senderSecretKey - Sender's secret key (base64)
 * @returns {Object} { encrypted, nonce }
 */
export function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(
    decodeUTF8(message),
    nonce,
    decodeBase64(recipientPublicKey),
    decodeBase64(senderSecretKey)
  );
  
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a message using asymmetric encryption (static box)
 * @param {string} encryptedMessage - Encrypted message (base64)
 * @param {string} nonce - Nonce (base64)
 * @param {string} senderPublicKey - Sender's public key (base64)
 * @param {string} recipientSecretKey - Recipient's secret key (base64)
 * @returns {string|null} Decrypted message or null
 */
export function decryptMessage(encryptedMessage, nonce, senderPublicKey, recipientSecretKey) {
  try {
    const decrypted = nacl.box.open(
      decodeBase64(encryptedMessage),
      decodeBase64(nonce),
      decodeBase64(senderPublicKey),
      decodeBase64(recipientSecretKey)
    );
    
    return decrypted ? encodeUTF8(decrypted) : null;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

/**
 * --- TASK 12: X3DH / Double Ratchet Primitives ---
 */

/**
 * Generate a bundle of ephemeral pre-keys for X3DH
 * Now includes signatures for MITM protection.
 */
export function generatePreKeyBundle(signingSecretKey, count = 30) {
    const spk = nacl.box.keyPair();
    const secretKey = decodeBase64(signingSecretKey);

    // Sign the Signed Pre-Key (SPK) with our Identity Signing Key
    const spkSignature = nacl.sign.detached(spk.publicKey, secretKey);

    const oneTimePreKeys = [];
    for (let i = 0; i < count; i++) {
        const key = nacl.box.keyPair();
        // Sign each OPK for maximum security
        const signature = nacl.sign.detached(key.publicKey, secretKey);
        oneTimePreKeys.push({
            id: i,
            publicKey: encodeBase64(key.publicKey),
            secretKey: encodeBase64(key.secretKey),
            signature: encodeBase64(signature)
        });
    }

    return {
        signedPreKey: {
            publicKey: encodeBase64(spk.publicKey),
            secretKey: encodeBase64(spk.secretKey),
            signature: encodeBase64(spkSignature)
        },
        oneTimePreKeys
    };
}

/**
 * Verify a pre-key signature
 */
export function verifyPreKeySignature(publicKeyBase64, signatureBase64, identitySigningKeyBase64) {
    try {
        const pub = decodeBase64(publicKeyBase64);
        const sig = decodeBase64(signatureBase64);
        const idKey = decodeBase64(identitySigningKeyBase64);
        return nacl.sign.detached.verify(pub, sig, idKey);
    } catch {
        return false;
    }
}

/**
 * X3DH Initial Shared Secret Derivation
 */
export function deriveX3DHSecret(myIK, myEK, peerIK, peerSPK, peerOPK = null) {
    const dh1 = nacl.box.before(decodeBase64(peerSPK), decodeBase64(myIK.secretKey));
    const dh2 = nacl.box.before(decodeBase64(peerIK), decodeBase64(myEK.secretKey));
    const dh3 = nacl.box.before(decodeBase64(peerSPK), decodeBase64(myEK.secretKey));
    
    let combined = new Uint8Array([...dh1, ...dh2, ...dh3]);

    if (peerOPK) {
        const dh4 = nacl.box.before(decodeBase64(peerOPK), decodeBase64(myEK.secretKey));
        combined = new Uint8Array([...combined, ...dh4]);
    }

    return combined; 
}

/**
 * X3DH Shared Secret Derivation for the Responder
 */
export function deriveX3DHResponderSecret(myIK, mySPK, myOPKSecret, peerIK, peerEK) {
    const dh1 = nacl.box.before(decodeBase64(peerIK), decodeBase64(mySPK.secretKey));
    const dh2 = nacl.box.before(decodeBase64(peerEK), decodeBase64(myIK.secretKey));
    const dh3 = nacl.box.before(decodeBase64(peerEK), decodeBase64(mySPK.secretKey));
    
    let combined = new Uint8Array([...dh1, ...dh2, ...dh3]);

    if (myOPKSecret) {
        const opkSecretString = typeof myOPKSecret === 'string' ? myOPKSecret : myOPKSecret.secretKey;
        const dh4 = nacl.box.before(decodeBase64(peerEK), decodeBase64(opkSecretString));
        combined = new Uint8Array([...combined, ...dh4]);
    }

    return combined;
}

/**
 * Generate a fingerprint (60-digit numeric string) from a public key
 */
export async function getFingerprint(publicKeyBase64) {
  try {
    const pubKey = decodeBase64(publicKeyBase64);
    const hashBuffer = await window.crypto.subtle.digest('SHA-512', pubKey);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    let numericString = '';
    for (let i = 0; i < hashArray.length; i++) {
      numericString += hashArray[i].toString().padStart(3, '0');
    }
    
    const finalDigits = numericString.substring(0, 60);
    const blocks = finalDigits.match(/.{1,5}/g);
    return blocks.join('-');
  } catch (err) {
    console.error('Failed to generate fingerprint:', err);
    return 'Error generating fingerprint';
  }
}
