import nacl from 'tweetnacl';
import forge from 'node-forge';
import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';

// Key Object representation for Ed25519 and X25519
class KeyObject {
  constructor(rawKey, type, algorithm = 'x25519') {
    this.rawKey = rawKey; // Buffer (32 bytes)
    this.type = type; // 'private' or 'public'
    this.algorithm = algorithm; // 'ed25519' or 'x25519'
  }

  export({ type, format }) {
    if (this.type === 'private') {
      // Return PKCS#8 DER representation (48 bytes: 16 bytes header + 32 bytes raw)
      const oidHex = this.algorithm === 'ed25519' ? '2b6570' : '2b656e';
      const header = Buffer.from(`302e02010030050603${oidHex}04220420`, 'hex');
      return Buffer.concat([header, this.rawKey]);
    } else {
      // Return SPKI DER representation (44 bytes: 12 bytes header + 32 bytes raw)
      const oidHex = this.algorithm === 'ed25519' ? '2b6570' : '2b656e';
      const header = Buffer.from(`302a30050603${oidHex}032100`, 'hex');
      return Buffer.concat([header, this.rawKey]);
    }
  }
}

// 1. generateKeyPairSync
function generateKeyPairSync(algorithm) {
  if (algorithm !== 'x25519') throw new Error('Unsupported algorithm in shim: ' + algorithm);
  const pair = nacl.box.keyPair();
  return {
    publicKey: new KeyObject(Buffer.from(pair.publicKey), 'public', 'x25519'),
    privateKey: new KeyObject(Buffer.from(pair.secretKey), 'private', 'x25519')
  };
}

function hasEd25519Oid(key) {
  if (!key) return false;
  const bytes = key.subarray ? key : Buffer.from(key);
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x2b && bytes[i+1] === 0x65 && bytes[i+2] === 0x70) {
      return true;
    }
  }
  return false;
}

// 2. createPrivateKey
function createPrivateKey({ key, format, type }) {
  const rawKey = key.subarray(key.length - 32);
  const algorithm = hasEd25519Oid(key) ? 'ed25519' : 'x25519';
  return new KeyObject(rawKey, 'private', algorithm);
}

// 3. createPublicKey
function createPublicKey(source) {
  if (source instanceof KeyObject) {
    if (source.type === 'private') {
      const pubKeyBytes = source.algorithm === 'ed25519'
        ? nacl.sign.keyPair.fromSeed(source.rawKey).publicKey
        : nacl.scalarMult.base(source.rawKey);
      return new KeyObject(Buffer.from(pubKeyBytes), 'public', source.algorithm);
    }
    return source;
  }
  
  // Direct public key DER buffer
  const key = source.key || source;
  const rawKey = key.subarray(key.length - 32);
  const algorithm = hasEd25519Oid(key) ? 'ed25519' : 'x25519';
  return new KeyObject(rawKey, 'public', algorithm);
}

// 4. diffieHellman
function diffieHellman({ privateKey, publicKey }) {
  // tweetnacl scalarMult calculates privateKey * publicKey
  const shared = nacl.scalarMult(privateKey.rawKey, publicKey.rawKey);
  return Buffer.from(shared);
}

// 5. randomBytes
function randomBytes(size) {
  if (typeof window === 'undefined' || !window.crypto?.getRandomValues) {
    throw new Error('[FATAL] Secure randomness (window.crypto.getRandomValues) is required but unavailable. Cannot run in this environment.');
  }
  const bytes = new Uint8Array(size);
  window.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

// 6. randomUUID
function randomUUID() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  // Fallback: build UUID v4 from CSPRNG bytes
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// 7. hkdfSync
function hkdfSync(algorithm, secret, salt, info, length) {
  const secretBuf = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);
  const saltBuf = salt && salt.length > 0 ? (Buffer.isBuffer(salt) ? salt : Buffer.from(salt)) : Buffer.alloc(32, 0);
  const infoBuf = Buffer.isBuffer(info) ? info : Buffer.from(info);

  // HMAC-SHA256 Helper
  const hmacSha256 = (key, data) => {
    const keyWA = CryptoJS.lib.WordArray.create(new Uint8Array(key));
    const dataWA = CryptoJS.lib.WordArray.create(new Uint8Array(data));
    const hash = CryptoJS.HmacSHA256(dataWA, keyWA);
    return Buffer.from(CryptoJS.enc.Hex.stringify(hash), 'hex');
  };

  // 1. Extract PRK
  const prk = hmacSha256(saltBuf, secretBuf);

  // 2. Expand
  let okm = Buffer.alloc(0);
  let t = Buffer.alloc(0);
  let counter = 1;

  while (okm.length < length) {
    t = hmacSha256(prk, Buffer.concat([t, infoBuf, Buffer.from([counter++])]));
    okm = Buffer.concat([okm, t]);
  }

  return okm.subarray(0, length);
}

// 8. createHmac
function createHmac(algorithm, key) {
  if (algorithm !== 'sha256') throw new Error('Unsupported HMAC algorithm: ' + algorithm);
  let dataBuf = Buffer.alloc(0);
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  return {
    update(data) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      dataBuf = Buffer.concat([dataBuf, buf]);
      return this;
    },
    digest() {
      const keyWA = CryptoJS.lib.WordArray.create(new Uint8Array(keyBuf));
      const dataWA = CryptoJS.lib.WordArray.create(new Uint8Array(dataBuf));
      const hash = CryptoJS.HmacSHA256(dataWA, keyWA);
      return Buffer.from(CryptoJS.enc.Hex.stringify(hash), 'hex');
    }
  };
}

// 9. scryptSync
function scryptSync(passphrase, salt, keylen) {
  const passStr = Buffer.isBuffer(passphrase) ? passphrase.toString() : passphrase;
  const saltStr = Buffer.isBuffer(salt) ? salt.toString('hex') : Buffer.from(salt).toString('hex');
  
  // Use node-forge pbkdf2 as backup derivation function with OWASP-compliant iterations
  const derivedBytes = forge.pkcs5.pbkdf2(
    passStr,
    forge.util.hexToBytes(saltStr),
    600000, // iterations
    keylen,
    'sha256'
  );
  return Buffer.from(derivedBytes, 'binary');
}

// 9b. pbkdf2Sync
function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  const passStr = Buffer.isBuffer(password) ? password.toString() : password;
  const saltStr = Buffer.isBuffer(salt) ? salt.toString('hex') : Buffer.from(salt).toString('hex');
  
  const derivedBytes = forge.pkcs5.pbkdf2(
    passStr,
    forge.util.hexToBytes(saltStr),
    iterations,
    keylen,
    digest
  );
  return Buffer.from(derivedBytes, 'binary');
}

function bufferToBinaryString(buf) {
  if (typeof buf === 'string') {
    buf = Buffer.from(buf, 'utf8');
  }
  const len = buf.length;
  let str = '';
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(buf[i]);
  }
  return str;
}

function binaryStringToBuffer(str) {
  const len = str.length;
  const buf = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    buf[i] = str.charCodeAt(i);
  }
  return buf;
}

// 10. createCipheriv & createDecipheriv for AES-GCM
function createCipheriv(algorithm, key, iv) {
  if (algorithm !== 'aes-256-gcm') throw new Error('Unsupported cipher: ' + algorithm);
  
  const keyBytes = forge.util.createBuffer(bufferToBinaryString(key));
  const ivBytes = forge.util.createBuffer(bufferToBinaryString(iv));
  
  const cipher = forge.cipher.createCipher('AES-GCM', keyBytes);
  cipher.start({ iv: ivBytes, tagLength: 128 });
  
  let outputBuf = Buffer.alloc(0);
  
  return {
    update(data, encoding) {
      const buf = typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : data;
      const dataStr = forge.util.createBuffer(bufferToBinaryString(buf));
      cipher.update(dataStr);
      return Buffer.alloc(0);
    },
    final() {
      cipher.finish();
      const outBytes = cipher.output.getBytes();
      outputBuf = binaryStringToBuffer(outBytes);
      return outputBuf;
    },
    getAuthTag() {
      const tagBytes = cipher.mode.tag.getBytes();
      return binaryStringToBuffer(tagBytes);
    }
  };
}

function createDecipheriv(algorithm, key, iv) {
  if (algorithm !== 'aes-256-gcm') throw new Error('Unsupported cipher: ' + algorithm);
  
  const keyBytes = forge.util.createBuffer(bufferToBinaryString(key));
  const ivBytes = forge.util.createBuffer(bufferToBinaryString(iv));
  
  const decipher = forge.cipher.createDecipher('AES-GCM', keyBytes);
  let tagBuf = null;
  let inputBuf = Buffer.alloc(0);
 
  return {
    setAuthTag(tag) {
      tagBuf = tag;
    },
    update(data) {
      const buf = typeof data === 'string' ? Buffer.from(data, 'binary') : data;
      inputBuf = Buffer.concat([inputBuf, buf]);
      return Buffer.alloc(0);
    },
    final() {
      const tagForge = forge.util.createBuffer(bufferToBinaryString(tagBuf));
      decipher.start({
        iv: ivBytes,
        tagLength: 128,
        tag: tagForge
      });
      const inputForge = forge.util.createBuffer(bufferToBinaryString(inputBuf));
      decipher.update(inputForge);
      const success = decipher.finish();
      if (!success) {
        throw new Error('AEAD decryption failed: auth tag mismatch');
      }
      const outBytes = decipher.output.getBytes();
      return binaryStringToBuffer(outBytes);
    }
  };
}

async function scryptAsync(passphrase, salt, keylen) {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const saltBytes = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 600000,
        hash: 'SHA-256'
      },
      passwordKey,
      keylen * 8
    );
    return Buffer.from(derivedBits);
  }
  return scryptSync(passphrase, salt, keylen);
}

// 11. sign
function sign(algorithm, message, privateKey) {
  const pair = nacl.sign.keyPair.fromSeed(privateKey.rawKey);
  const signature = nacl.sign.detached(message, pair.secretKey);
  return Buffer.from(signature);
}

// 12. verify
function verify(algorithm, message, publicKey, signature) {
  return nacl.sign.detached.verify(message, signature, publicKey.rawKey);
}

const _exports = {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  randomBytes,
  randomUUID,
  hkdfSync,
  createHmac,
  scryptSync,
  scryptAsync,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  sign,
  verify
};

export {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  randomBytes,
  randomUUID,
  hkdfSync,
  createHmac,
  scryptSync,
  scryptAsync,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  sign,
  verify
};

export default _exports;

if (typeof module !== 'undefined') {
  module.exports = _exports;
}
