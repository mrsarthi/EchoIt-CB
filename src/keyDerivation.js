import { Mnemonic, keccak256 } from 'ethers';
import crypto from 'crypto';
import { Buffer } from 'buffer';

// PKCS#8 DER prefixes for Ed25519 and X25519 private keys
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function getEd25519FromSeed(seed32Bytes) {
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed32Bytes]);
  const privKey = crypto.createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8'
  });
  const pubKey = crypto.createPublicKey(privKey);
  return {
    privateKey: privKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
    publicKey: pubKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    rawPublicKey: pubKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('hex')
  };
}

function getX25519FromSeed(seed32Bytes) {
  const der = Buffer.concat([X25519_PKCS8_PREFIX, seed32Bytes]);
  const privKey = crypto.createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8'
  });
  const pubKey = crypto.createPublicKey(privKey);
  return {
    privateKey: privKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
    publicKey: pubKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    rawPublicKey: pubKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('hex')
  };
}

export function generateMnemonic() {
  const entropy = window.crypto.getRandomValues(new Uint8Array(16));
  return Mnemonic.fromEntropy(entropy).phrase;
}

export function validateMnemonic(phrase) {
  return Mnemonic.isValidMnemonic(phrase);
}

export function deriveKeysFromMnemonic(phrase) {
  if (!validateMnemonic(phrase)) {
    throw new Error('Invalid mnemonic phrase');
  }
  
  const seedHex = Mnemonic.fromPhrase(phrase).computeSeed();
  const seedBytes = Buffer.from(seedHex.slice(2), 'hex');
  
  // Use HKDF to derive distinct seeds for Ed25519 and X25519
  const edSeed = crypto.hkdfSync('sha256', seedBytes, Buffer.from('echo-identity-salt'), Buffer.from('ed25519-identity-key'), 32);
  const xSeed = crypto.hkdfSync('sha256', seedBytes, Buffer.from('echo-encryption-salt'), Buffer.from('x25519-encryption-key'), 32);
  
  const edKeyPair = getEd25519FromSeed(Buffer.from(edSeed));
  const xKeyPair = getX25519FromSeed(Buffer.from(xSeed));
  
  // Calculate address: last 20 bytes of keccak256 hash of raw Ed25519 public key
  const rawPubBytes = Buffer.from(edKeyPair.rawPublicKey, 'hex');
  const address = '0x' + keccak256(rawPubBytes).slice(-40).toLowerCase();
  
  return {
    address,
    mnemonic: phrase,
    identityKeyPair: edKeyPair,
    encryptionKeyPair: xKeyPair
  };
}

export function signMessageWithEd25519(messageStr, privateKeyHex) {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8'
  });
  return crypto.sign(null, Buffer.from(messageStr), privateKey).toString('hex');
}

export function verifyEd25519Signature(messageStr, signatureHex, publicKeyHex) {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, 'hex'),
    format: 'der',
    type: 'spki'
  });
  return crypto.verify(null, Buffer.from(messageStr), publicKey, Buffer.from(signatureHex, 'hex'));
}
