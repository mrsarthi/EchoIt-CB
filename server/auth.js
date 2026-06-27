const { verifyMessage } = require('ethers');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is missing.");
  process.exit(1);
}

/**
 * Generates a cryptographically secure random challenge string.
 */
function generateChallenge() {
  const crypto = require('crypto');
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
function verifyWalletSignature(address, challenge, signature, type = 'session') {
  try {
    const prefix = type === 'registration' 
      ? "Authorize Echo Registration: " 
      : "Authorize Echo Session: ";
    
    const expectedMessage = `${prefix}${challenge}`;
    const recoveredAddress = verifyMessage(expectedMessage, signature);
    
    return recoveredAddress.toLowerCase() === address.toLowerCase();
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
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes the SHA-256 hash of a string.
 */
function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generateChallenge,
  verifyWalletSignature,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken
};
