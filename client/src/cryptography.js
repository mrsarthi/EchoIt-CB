const crypto = require('crypto');

// Helpers for converting X25519 key formats to DER format for Node crypto
function toPrivateKey(hex) {
  return crypto.createPrivateKey({
    key: Buffer.from(hex, 'hex'),
    format: 'der',
    type: 'pkcs8'
  });
}

function toPublicKey(hex) {
  return crypto.createPublicKey({
    key: Buffer.from(hex, 'hex'),
    format: 'der',
    type: 'spki'
  });
}

// Derive public key from private key hex
function getPublicKeyFromPrivateKey(privateKeyHex) {
  const priv = toPrivateKey(privateKeyHex);
  const pub = crypto.createPublicKey(priv);
  return pub.export({ type: 'spki', format: 'der' }).toString('hex');
}

// Generate X25519 key pair as hex strings
function generateX25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex')
  };
}

// HKDF-SHA256 derivation
function hkdf(secret, salt, info, length) {
  const saltBuf = salt ? Buffer.from(salt) : Buffer.alloc(32, 0);
  const infoBuf = Buffer.from(info);
  return Buffer.from(crypto.hkdfSync('sha256', secret, saltBuf, infoBuf, length));
}

// HMAC-SHA256
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

// Compute DH shared secret
function computeDH(privateKeyHex, publicKeyHex) {
  const priv = toPrivateKey(privateKeyHex);
  const pub = toPublicKey(publicKeyHex);
  return crypto.diffieHellman({ privateKey: priv, publicKey: pub });
}

// AES-256-GCM authenticated encryption (tag appended to ciphertext)
function encryptAES_GCM(plaintext, key, iv) {
  const ivBuf = typeof iv === 'string' ? Buffer.from(iv, 'hex') : iv;
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, ivBuf);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]).toString('base64');
}

// AES-256-GCM authenticated decryption (tag extracted from end of ciphertext)
function decryptAES_GCM(ciphertextBase64, key, iv) {
  const ivBuf = typeof iv === 'string' ? Buffer.from(iv, 'hex') : iv;
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  const ciphertextBuffer = Buffer.from(ciphertextBase64, 'base64');
  const tagLength = 16;
  if (ciphertextBuffer.length < tagLength) {
    throw new Error("Ciphertext too short.");
  }
  const encrypted = ciphertextBuffer.subarray(0, ciphertextBuffer.length - tagLength);
  const tag = ciphertextBuffer.subarray(ciphertextBuffer.length - tagLength);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// X3DH handshakes
function x3dhInitiate(aliceIdentityPrivate, aliceIdentityPublic, bobIdentityPublic, bobSignedPrePublic, bobOneTimePublic) {
  const ek = generateX25519();
  
  const dh1 = computeDH(aliceIdentityPrivate, bobSignedPrePublic);
  const dh2 = computeDH(ek.privateKey, bobIdentityPublic);
  const dh3 = computeDH(ek.privateKey, bobSignedPrePublic);
  
  let sharedSecret = Buffer.concat([dh1, dh2, dh3]);
  
  if (bobOneTimePublic) {
    const dh4 = computeDH(ek.privateKey, bobOneTimePublic);
    sharedSecret = Buffer.concat([sharedSecret, dh4]);
  }
  
  const derivedBytes = hkdf(sharedSecret, null, "DecentraChatX3DH", 64);
  const rootKey = derivedBytes.subarray(0, 32).toString('hex');
  const initialChainKey = derivedBytes.subarray(32, 64).toString('hex');
  
  return {
    rootKey,
    initialChainKey,
    ephemeralPublicKey: ek.publicKey
  };
}

function x3dhReceive(bobIdentityPrivate, bobSignedPrePrivate, bobOneTimePrivate, aliceIdentityPublic, aliceEphemeralPublic, usedOneTime) {
  const dh1 = computeDH(bobSignedPrePrivate, aliceIdentityPublic);
  const dh2 = computeDH(bobIdentityPrivate, aliceEphemeralPublic);
  const dh3 = computeDH(bobSignedPrePrivate, aliceEphemeralPublic);
  
  let sharedSecret = Buffer.concat([dh1, dh2, dh3]);
  
  if (usedOneTime && bobOneTimePrivate) {
    const dh4 = computeDH(bobOneTimePrivate, aliceEphemeralPublic);
    sharedSecret = Buffer.concat([sharedSecret, dh4]);
  }
  
  const derivedBytes = hkdf(sharedSecret, null, "DecentraChatX3DH", 64);
  const rootKey = derivedBytes.subarray(0, 32).toString('hex');
  const initialChainKey = derivedBytes.subarray(32, 64).toString('hex');
  
  return {
    rootKey,
    initialChainKey
  };
}

// KDF for Root Key (Root KDF)
function kdfRK(rkHex, dhOutBuf) {
  const rkBuf = Buffer.from(rkHex, 'hex');
  const derivedBytes = hkdf(dhOutBuf, rkBuf, "RootKeyKDF", 64);
  return {
    rootKey: derivedBytes.subarray(0, 32).toString('hex'),
    chainKey: derivedBytes.subarray(32, 64).toString('hex')
  };
}

// KDF for Chain Key (Symmetric KDF step)
function kdfCK(ckHex) {
  const ckBuf = Buffer.from(ckHex, 'hex');
  const messageKey = hmac(ckBuf, Buffer.from([0x01]));
  const nextChainKey = hmac(ckBuf, Buffer.from([0x02]));
  return {
    messageKey: messageKey.toString('hex'),
    nextChainKey: nextChainKey.toString('hex')
  };
}

// Double Ratchet Session State & Flow Manager
class DoubleRatchetSession {
  constructor(peerAddress, fields) {
    this.peer_address = peerAddress;
    this.root_key = fields.root_key;
    this.sending_chain_key = fields.sending_chain_key;
    this.receiving_chain_key = fields.receiving_chain_key;
    this.dh_local_private = fields.dh_local_private;
    this.dh_local_public = fields.dh_local_public;
    this.dh_remote_public = fields.dh_remote_public;
    this.previous_chain_length = fields.previous_chain_length || 0;
    this.sequence_send = fields.sequence_send || 0;
    this.sequence_receive = fields.sequence_receive || 0;
  }

  static async load(dbClient, peerAddress) {
    const row = await dbClient.read((db) => {
      return db.prepare('SELECT * FROM ratchet_sessions WHERE peer_address = ?').get(peerAddress);
    });
    if (!row) return null;
    return new DoubleRatchetSession(peerAddress, row);
  }

  async save(dbClient) {
    await dbClient.write((db) => {
      db.prepare(`
        INSERT OR REPLACE INTO ratchet_sessions (
          peer_address, root_key, sending_chain_key, receiving_chain_key,
          dh_local_private, dh_local_public, dh_remote_public,
          previous_chain_length, sequence_send, sequence_receive
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.peer_address, this.root_key, this.sending_chain_key, this.receiving_chain_key,
        this.dh_local_private, this.dh_local_public, this.dh_remote_public,
        this.previous_chain_length, this.sequence_send, this.sequence_receive
      );
    });
  }

  static async initiate(dbClient, peerAddress, myIdentityPrivate, myIdentityPublic, bobBundle) {
    // bobBundle: { identityKey, signedPreKey, oneTimeKey }
    const x3dhRes = x3dhInitiate(
      myIdentityPrivate,
      myIdentityPublic,
      bobBundle.identityKey,
      bobBundle.signedPreKey,
      bobBundle.oneTimeKey
    );

    // Initial DH step using Bob's signedPreKey
    const dhLocal = generateX25519();
    const dhOut = computeDH(dhLocal.privateKey, bobBundle.signedPreKey);
    const { rootKey: nextRootKey, chainKey: sendingChainKey } = kdfRK(x3dhRes.rootKey, dhOut);

    const session = new DoubleRatchetSession(peerAddress, {
      root_key: nextRootKey,
      sending_chain_key: sendingChainKey,
      receiving_chain_key: "", // Setup on first receive response
      dh_local_private: dhLocal.privateKey,
      dh_local_public: dhLocal.publicKey,
      dh_remote_public: bobBundle.signedPreKey,
      previous_chain_length: 0,
      sequence_send: 0,
      sequence_receive: 0
    });

    await session.save(dbClient);
    return {
      session,
      ephemeralPublicKey: x3dhRes.ephemeralPublicKey
    };
  }

  static async receiveInit(dbClient, peerAddress, myIdentityPrivate, mySignedPrePrivate, aliceIK, aliceEK, aliceOPK_id) {
    let bobOPKPrivate = null;
    if (aliceOPK_id !== undefined && aliceOPK_id !== null) {
      const opkRow = await dbClient.read((db) => {
        return db.prepare('SELECT private_key FROM one_time_keys WHERE key_id = ?').get(aliceOPK_id);
      });
      if (opkRow) {
        bobOPKPrivate = opkRow.private_key;
        await dbClient.write((db) => {
          db.prepare('DELETE FROM one_time_keys WHERE key_id = ?').run(aliceOPK_id);
        });
      }
    }

    const x3dhRes = x3dhReceive(
      myIdentityPrivate,
      mySignedPrePrivate,
      bobOPKPrivate,
      aliceIK,
      aliceEK,
      bobOPKPrivate !== null
    );

    const mySignedPrePublic = getPublicKeyFromPrivateKey(mySignedPrePrivate);

    // Initial receiving session setup
    const session = new DoubleRatchetSession(peerAddress, {
      root_key: x3dhRes.rootKey,
      sending_chain_key: "",
      receiving_chain_key: x3dhRes.initialChainKey,
      dh_local_private: mySignedPrePrivate,
      dh_local_public: mySignedPrePublic,
      dh_remote_public: aliceEK,
      previous_chain_length: 0,
      sequence_send: 0,
      sequence_receive: 0
    });

    await session.save(dbClient);
    return session;
  }

  // Encrypt plaintext under current sending chain key
  async encrypt(dbClient, plaintext) {
    if (!this.sending_chain_key) {
      throw new Error("Sending chain key not initialized.");
    }
    const { messageKey, nextChainKey } = kdfCK(this.sending_chain_key);
    this.sending_chain_key = nextChainKey;
    
    const seq = this.sequence_send;
    this.sequence_send++;

    // Generate random IV
    const iv = crypto.randomBytes(12).toString('hex');
    const ciphertext = encryptAES_GCM(plaintext, messageKey, iv);

    await this.save(dbClient);

    return {
      ciphertext,
      iv,
      dhPublic: this.dh_local_public,
      sequenceNumber: seq
    };
  }

  // Decrypt ciphertext under receiving chain key, handling DH rotations and skipped keys
  async decrypt(dbClient, payload) {
    const { ciphertext, iv, dhPublic, sequenceNumber } = payload;

    // Check if new DH key is received
    if (dhPublic !== this.dh_remote_public) {
      // 1. Skip remaining keys on old receiving chain
      await this.skipMessageKeys(dbClient, this.previous_chain_length);

      // 2. Perform DH Ratchet step
      const dhOut = computeDH(this.dh_local_private, dhPublic);
      const { rootKey: nextRootKey, chainKey: nextReceivingChainKey } = kdfRK(this.root_key, dhOut);

      // 3. Generate our new local DH keypair
      const newDHLocal = generateX25519();
      const dhOutNew = computeDH(newDHLocal.privateKey, dhPublic);
      const { rootKey: finalRootKey, chainKey: nextSendingChainKey } = kdfRK(nextRootKey, dhOutNew);

      this.previous_chain_length = this.sequence_send;
      this.sequence_send = 0;
      this.sequence_receive = 0;
      this.root_key = finalRootKey;
      this.receiving_chain_key = nextReceivingChainKey;
      this.sending_chain_key = nextSendingChainKey;
      this.dh_local_private = newDHLocal.privateKey;
      this.dh_local_public = newDHLocal.publicKey;
      this.dh_remote_public = dhPublic;
    }

    // Skip keys on current receiving chain up to incoming sequenceNumber
    await this.skipMessageKeys(dbClient, sequenceNumber);

    // Retrieve key from skipped keys if present, otherwise calculate new key
    const skippedKey = await dbClient.read((db) => {
      return db.prepare(`
        SELECT message_key FROM skipped_message_keys 
        WHERE peer_address = ? AND dh_remote_public = ? AND sequence_number = ?
      `).get(this.peer_address, dhPublic, sequenceNumber);
    });

    let messageKey;
    if (skippedKey) {
      messageKey = skippedKey.message_key;
      await dbClient.write((db) => {
        db.prepare(`
          DELETE FROM skipped_message_keys 
          WHERE peer_address = ? AND dh_remote_public = ? AND sequence_number = ?
        `).run(this.peer_address, dhPublic, sequenceNumber);
      });
    } else {
      const { messageKey: derivedKey, nextChainKey } = kdfCK(this.receiving_chain_key);
      messageKey = derivedKey;
      this.receiving_chain_key = nextChainKey;
      this.sequence_receive++;
    }

    const plaintext = decryptAES_GCM(ciphertext, messageKey, iv);
    await this.save(dbClient);
    return plaintext;
  }

  // Derive skipped keys and insert them into DB
  async skipMessageKeys(dbClient, untilSequence) {
    // Clean up skipped keys older than 7 days to preserve forward secrecy
    try {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      await dbClient.write((db) => {
        db.prepare('DELETE FROM skipped_message_keys WHERE created_at < ?').run(sevenDaysAgo);
      });
    } catch (e) {
      console.error("Skipped keys cleanup failed:", e.message);
    }

    if (this.sequence_receive + 100 < untilSequence) {
      throw new Error("Too many skipped messages.");
    }
    while (this.sequence_receive < untilSequence) {
      if (!this.receiving_chain_key) {
        break; // Can't skip if chain not setup yet
      }
      const { messageKey, nextChainKey } = kdfCK(this.receiving_chain_key);
      await dbClient.write((db) => {
        db.prepare(`
          INSERT OR REPLACE INTO skipped_message_keys (peer_address, dh_remote_public, sequence_number, message_key, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(this.peer_address, this.dh_remote_public, this.sequence_receive, messageKey, Date.now());
      });
      this.receiving_chain_key = nextChainKey;
      this.sequence_receive++;
    }
  }
}

module.exports = {
  generateX25519,
  hkdf,
  hmac,
  computeDH,
  encryptAES_GCM,
  decryptAES_GCM,
  x3dhInitiate,
  x3dhReceive,
  kdfRK,
  kdfCK,
  DoubleRatchetSession
};
