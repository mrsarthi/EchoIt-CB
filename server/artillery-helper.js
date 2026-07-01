const crypto = require('crypto');

function generateTestData(userContext, events, done) {
  // Generate random Ethereum address
  const randomHex = crypto.randomBytes(20).toString('hex');
  const address = `0x${randomHex}`;
  
  // Generate unique username (letters/numbers/underscores, 3-20 chars)
  const randomString = crypto.randomBytes(6).toString('hex'); // 12 characters
  const username = `user_${randomString}`;

  // Generate random keys for cryptographic inputs
  const identityKey = crypto.randomBytes(32).toString('base64');
  const signedPreKey = crypto.randomBytes(32).toString('base64');
  const preKeySignature = crypto.randomBytes(64).toString('base64');
  const challenge = crypto.randomBytes(32).toString('hex');
  const signature = crypto.randomBytes(65).toString('hex');
  const publicKey = crypto.randomBytes(32).toString('hex');

  // Generate unique message ID (UUID v4)
  const messageId = crypto.randomUUID();

  // Inject these variables into the Artillery virtual user context
  userContext.vars.address = address;
  userContext.vars.username = username;
  userContext.vars.identityKey = identityKey;
  userContext.vars.signedPreKey = signedPreKey;
  userContext.vars.preKeySignature = preKeySignature;
  userContext.vars.challenge = challenge;
  userContext.vars.signature = signature;
  userContext.vars.publicKey = publicKey;
  userContext.vars.messageId = messageId;

  return done();
}

module.exports = {
  generateTestData
};
