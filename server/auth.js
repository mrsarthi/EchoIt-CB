const { verifyMessage } = require('ethers');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const argon2 = require('argon2');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is missing.");
  process.exit(1);
}

// AES encryption key for stateless puzzles (must be 32 bytes)
const SERVER_SECRET_KEY = process.env.SERVER_SECRET_KEY 
  ? Buffer.from(process.env.SERVER_SECRET_KEY, 'hex')
  : crypto.randomBytes(32);

// Puzzle parameters (must match client configurations)
const PUZZLE_ITERATIONS = 2;
const PUZZLE_MEMORY = 16384; // 16MB
const PUZZLE_PARALLELISM = 1;
const PUZZLE_LENGTH = 32;

/**
 * Computes Argon2id hash for the puzzle.
 */
async function computePuzzleHash(challenge, secretNumber) {
  const password = `${challenge}:${secretNumber}`;
  const salt = Buffer.from(challenge, 'hex');
  return await argon2.hash(password, {
    type: argon2.argon2id,
    raw: true,
    salt,
    timeCost: PUZZLE_ITERATIONS,
    memoryCost: PUZZLE_MEMORY,
    parallelism: PUZZLE_PARALLELISM,
    hashLength: PUZZLE_LENGTH
  });
}

/**
 * Generates a challenge, targetHash, and ProofToken.
 */
async function generateStatelessPuzzle() {
  const challenge = crypto.randomBytes(32).toString('hex');
  const secretNumber = Math.floor(Math.random() * 100) + 1; // 1 to 100
  
  const rawHash = await computePuzzleHash(challenge, secretNumber);
  const targetHash = rawHash.toString('hex');
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_SECRET_KEY, iv);
  const payload = `${challenge}:${secretNumber}`;
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  const proofToken = Buffer.concat([iv, tag, encrypted]).toString('base64');
  
  return { challenge, targetHash, proofToken };
}

/**
 * Verifies if the client's submitted secretNumber matches the encrypted proofToken.
 */
function verifyStatelessPuzzle(proofToken, challenge, secretNumber) {
  try {
    const data = Buffer.from(proofToken, 'base64');
    if (data.length < 28) return false;
    
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', SERVER_SECRET_KEY, iv);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const [decryptedChallenge, decryptedSecret] = decrypted.split(':');
    
    return decryptedChallenge === challenge && parseInt(decryptedSecret, 10) === parseInt(secretNumber, 10);
  } catch (err) {
    console.error("[Auth] verifyStatelessPuzzle error:", err.message);
    return false;
  }
}

/**
 * Generates a cryptographically secure random challenge string.
 */
function generateChallenge() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verifies a wallet signature against a challenge.
 * @param {string} address Ethereum address (0x...)
 * @param {string} challenge Nonce string
 * @param {string} signature Signature hex
 * @param {string} type 'registration' or 'session'
 * @returns {boolean} True if signature is valid
 */
function verifyWalletSignature(address, challenge, signature, publicKeyHex = null, type = 'session') {
  try {
    const prefix = type === 'registration' 
      ? "Authorize EchoIt Registration: " 
      : "Authorize EchoIt Session: ";
    
    const expectedMessage = `${prefix}${challenge}`;
    console.log(`[DEBUG verifyWalletSignature] address: ${address}`);
    console.log(`[DEBUG verifyWalletSignature] challenge: ${challenge}`);
    console.log(`[DEBUG verifyWalletSignature] signature: ${signature}`);
    console.log(`[DEBUG verifyWalletSignature] publicKeyHex: ${publicKeyHex}`);
    console.log(`[DEBUG verifyWalletSignature] type: ${type}`);
    console.log(`[DEBUG verifyWalletSignature] expectedMessage: "${expectedMessage}"`);

    if (publicKeyHex) {
      const { keccak256 } = require('ethers');
      const rawPubBytes = Buffer.from(publicKeyHex, 'hex').slice(-32);
      const derivedAddress = '0x' + keccak256(rawPubBytes).slice(-40).toLowerCase();
      console.log(`[DEBUG verifyWalletSignature] derivedAddress: ${derivedAddress}`);
      
      if (derivedAddress !== address.toLowerCase()) {
        console.warn(`[Auth] Address mismatch: expected ${address.toLowerCase()}, got ${derivedAddress}`);
        return false;
      }

      const publicKey = crypto.createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        format: 'der',
        type: 'spki'
      });
      
      const isVerified = crypto.verify(null, Buffer.from(expectedMessage), publicKey, Buffer.from(signature, 'hex'));
      console.log(`[DEBUG verifyWalletSignature] crypto.verify result: ${isVerified}`);
      return isVerified;
    } else {
      // Legacy secp256k1 fallback
      const recoveredAddress = verifyMessage(expectedMessage, signature);
      const isVerified = recoveredAddress.toLowerCase() === address.toLowerCase();
      console.log(`[DEBUG verifyWalletSignature] Legacy verify result: ${isVerified} (recovered: ${recoveredAddress})`);
      return isVerified;
    }
  } catch (err) {
    console.error("Signature verification error:", err.message);
    return false;
  }
}

/**
 * Generates a short-lived Access JWT.
 */
function generateAccessToken(address) {
  return jwt.sign({ address: address.toLowerCase() }, JWT_SECRET, { expiresIn: '3d' });
}

/**
 * Verifies an Access JWT.
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Generates a cryptographically secure random refresh token.
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes the SHA-256 hash of a string.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generateChallenge,
  generateStatelessPuzzle,
  verifyStatelessPuzzle,
  verifyWalletSignature,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken
};

