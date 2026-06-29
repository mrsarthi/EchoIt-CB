const io = require('socket.io-client');
const { Wallet, verifyMessage, keccak256 } = require('ethers');
const crypto = require('crypto');
const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const DBClient = require('./dbClient');
const { uploadMediaInChunks, downloadMediaAndDecrypt } = require('./media');
const {
  generateX25519,
  DoubleRatchetSession,
  encryptAES_GCM,
  decryptAES_GCM
} = require('./cryptography');

function verifyEd25519Signature(message, signatureHex, publicKeyHex) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki'
    });
    return crypto.verify(null, Buffer.from(message), publicKey, Buffer.from(signatureHex, 'hex'));
  } catch (e) {
    console.error("[SDK verifyEd25519Signature] error:", e.message);
    return false;
  }
}

const { argon2id } = require('hash-wasm');

async function solvePuzzle(challenge, targetHash) {
  const saltBytes = Buffer.from(challenge, 'hex');
  
  for (let i = 1; i <= 100; i++) {
    const password = `${challenge}:${i}`;
    const hashBytes = await argon2id({
      password: password,
      salt: saltBytes,
      iterations: 2,
      memorySize: 16384, // 16MB
      parallelism: 1,
      hashLength: 32,
      outputType: 'hex'
    });
    
    if (hashBytes === targetHash) {
      return i;
    }
  }
  
  throw new Error("Failed to solve puzzle: target hash match not found.");
}


// Helper to make JSON POST requests using native node HTTP modules or browser fetch
function postJSON(urlStr, data) {
  if (typeof window !== 'undefined' && window.fetch) {
    return window.fetch(urlStr, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }).then(res => {
      if (!res.ok) {
        return res.text().then(text => { throw new Error(`HTTP status ${res.status}: ${text}`); });
      }
      return res.json();
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const postData = JSON.stringify(data);
      const clientModule = url.protocol === 'https:' ? https : http;

      const req = clientModule.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error("Failed to parse JSON response."));
            }
          } else {
            reject(new Error(`HTTP status ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(postData);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

class DecentraChatClient extends EventEmitter {
  constructor(serverUrl, wallet, dbPath = ':memory:') {
    super();
    this.serverUrl = serverUrl;
    this.wallet = wallet;
    this.address = wallet.address.toLowerCase();
    this.db = new DBClient(dbPath);
    this.socket = null;
    this.connected = false;
  }

  async init() {
    await this.db.init();
  }

  // Key-value metadata helpers
  async getMetadata(key) {
    return this.db.read((db) => {
      const row = db.prepare('SELECT value FROM key_metadata WHERE key = ?').get(key);
      return row ? row.value : null;
    });
  }

  async setMetadata(key, value) {
    await this.db.write((db) => {
      db.prepare('INSERT OR REPLACE INTO key_metadata (key, value) VALUES (?, ?)')
        .run(key, value);
    });
  }

  // Generate and store local one-time keys
  async generateOneTimeKeys(startId, count) {
    const keys = [];
    await this.db.write((db) => {
      for (let i = 0; i < count; i++) {
        const keyId = startId + i;
        const keypair = generateX25519();
        db.prepare('INSERT INTO one_time_keys (key_id, private_key, public_key, registered) VALUES (?, ?, ?, 0)')
          .run(keyId, keypair.privateKey, keypair.publicKey);
        keys.push({ keyId, publicKey: keypair.publicKey });
      }
    });
    return keys;
  }

  // Register a new user profile on the server
  async register(username) {
    const usernameRegex = /^[a-z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      throw new Error("Username must be 3-20 characters, lowercase alphanumeric/underscores only.");
    }

    // 1. Generate local pre-key bundle
    const identityKeypair = (this.wallet.encryptionPrivate && this.wallet.encryptionPublic) 
      ? { privateKey: this.wallet.encryptionPrivate, publicKey: this.wallet.encryptionPublic }
      : generateX25519();
    const signedPreKeypair = generateX25519();
    const preKeySignature = await this.wallet.signMessage(signedPreKeypair.publicKey);

    // 2. Generate local session signing key
    const localWallet = Wallet.createRandom();
    const delegationSignature = await this.wallet.signMessage(`Authorize Echo Session Key: ${localWallet.address}`);
    await this.setMetadata('session_signing_private', localWallet.privateKey);
    await this.setMetadata('session_signing_public', localWallet.address);
    await this.setMetadata('session_signing_delegation', delegationSignature);

    // Generate initial one-time pre-keys (batch of 50)
    const opks = await this.generateOneTimeKeys(1, 50);

    // 2. Request signature challenge from relay server over temporary socket
    const tempSocket = io(this.serverUrl);
    
    const registrationResult = await new Promise((resolve, reject) => {
      tempSocket.on('connect', () => {
        tempSocket.emit('requestChallenge', async (puzzle) => {
          if (!puzzle || !puzzle.challenge || !puzzle.targetHash || !puzzle.proofToken) {
            tempSocket.close();
            return reject(new Error("Relay server returned an empty or invalid challenge puzzle."));
          }

          const { challenge, targetHash, proofToken } = puzzle;

          // Solve the puzzle to find the secret number
          let secretNumber;
          try {
            secretNumber = await solvePuzzle(challenge, targetHash);
          } catch (err) {
            tempSocket.close();
            return reject(new Error("Failed to solve cryptographic puzzle: " + err.message));
          }

          // Sign the registration authorization challenge
          const signature = await this.wallet.signMessage(`Authorize Echo Registration: ${challenge}`);

          tempSocket.emit('register', {
            address: this.address,
            username,
            identityKey: identityKeypair.publicKey,
            signedPreKey: signedPreKeypair.publicKey,
            preKeySignature,
            challenge,
            signature,
            publicKey: this.wallet.identityPublic,
            secretNumber,
            proofToken
          }, async (res) => {
            tempSocket.close();
            if (res.success) {
              resolve(res);
            } else {
              reject(new Error(res.error));
            }
          });
        });
      });
      tempSocket.on('connect_error', (err) => {
        reject(new Error("Connection error during registration: " + err.message));
      });
    });

    // 3. Save registered keys and tokens in local database
    await this.setMetadata('address', this.address);
    await this.setMetadata('username', username);
    await this.setMetadata('access_token', registrationResult.token);
    await this.setMetadata('refresh_token', registrationResult.refreshToken);
    await this.setMetadata('identity_private', identityKeypair.privateKey);
    await this.setMetadata('identity_public', identityKeypair.publicKey);
    await this.setMetadata('signed_pre_private', signedPreKeypair.privateKey);
    await this.setMetadata('signed_pre_public', signedPreKeypair.publicKey);
    await this.setMetadata('registered', 'true');

    // 4. Log in and upload our batch of one-time keys
    await this.connect();
    await this.uploadOneTimeKeys(opks);
    await this.disconnect();

    return {
      username,
      address: this.address
    };
  }

  // Sign-in an existing user using their wallet signature
  async loginWithSignature() {
    // Request challenge from relay server
    const tempSocket = io(this.serverUrl);

    const loginResult = await new Promise((resolve, reject) => {
      tempSocket.on('connect', () => {
        tempSocket.emit('requestChallenge', async (puzzle) => {
          if (!puzzle || !puzzle.challenge || !puzzle.targetHash || !puzzle.proofToken) {
            tempSocket.close();
            return reject(new Error("Relay server returned an empty or invalid challenge puzzle."));
          }

          const { challenge, targetHash, proofToken } = puzzle;

          // Solve the puzzle to find the secret number
          let secretNumber;
          try {
            secretNumber = await solvePuzzle(challenge, targetHash);
          } catch (err) {
            tempSocket.close();
            return reject(new Error("Failed to solve cryptographic puzzle: " + err.message));
          }

          // Sign the login challenge using session prefix
          const signature = await this.wallet.signMessage(`Authorize Echo Session: ${challenge}`);

          tempSocket.emit('loginWithSignature', {
            address: this.address,
            challenge,
            signature,
            publicKey: this.wallet.identityPublic,
            secretNumber,
            proofToken
          }, async (res) => {
            tempSocket.close();
            if (res.success) {
              resolve(res);
            } else {
              reject(new Error(res.error));
            }
          });
        });
      });
      tempSocket.on('connect_error', (err) => {
        reject(new Error("Connection error during login: " + err.message));
      });
    });

    // Save tokens and metadata in local database
    await this.setMetadata('address', this.address);
    await this.setMetadata('username', loginResult.username);
    await this.setMetadata('access_token', loginResult.token);
    await this.setMetadata('refresh_token', loginResult.refreshToken);
    await this.setMetadata('registered', 'true');
    await this.setMetadata('stealth_mode', loginResult.stealthMode ? 'true' : 'false');
    await this.setMetadata('hide_wallet', loginResult.hideWallet ? 'true' : 'false');
    await this.setMetadata('bio', loginResult.bio || '');
    await this.setMetadata('pfp', loginResult.pfp || '');

    // Ensure delegated session signing key is generated
    let signingPrivate = await this.getMetadata('session_signing_private');
    let delegationSignature = await this.getMetadata('session_signing_delegation');
    if (!signingPrivate || !delegationSignature) {
      const localWallet = Wallet.createRandom();
      const newSig = await this.wallet.signMessage(`Authorize Echo Session Key: ${localWallet.address}`);
      await this.setMetadata('session_signing_private', localWallet.privateKey);
      await this.setMetadata('session_signing_public', localWallet.address);
      await this.setMetadata('session_signing_delegation', newSig);
    }

    // Automatically connect
    await this.connect();
    // Re-verify/upload one-time keys if count is low
    if (loginResult.opkCount < 10) {
      const opks = await this.generateOneTimeKeys(1, 50);
      await this.uploadOneTimeKeys(opks);
    }
    await this.disconnect();

    return {
      username: loginResult.username,
      address: this.address,
      stealthMode: !!loginResult.stealthMode,
      hideWallet: !!loginResult.hideWallet,
      bio: loginResult.bio || '',
      pfp: loginResult.pfp || null
    };
  }

  // Renew access and refresh tokens via Web3 wallet signature without modifying local key pairs
  async reauthenticateWithSignature() {
    // Request challenge from relay server
    const tempSocket = io(this.serverUrl);

    const loginResult = await new Promise((resolve, reject) => {
      tempSocket.on('connect', () => {
        tempSocket.emit('requestChallenge', async (puzzle) => {
          if (!puzzle || !puzzle.challenge || !puzzle.targetHash || !puzzle.proofToken) {
            tempSocket.close();
            return reject(new Error("Relay server returned an empty or invalid challenge puzzle."));
          }

          const { challenge, targetHash, proofToken } = puzzle;

          // Solve the puzzle to find the secret number
          let secretNumber;
          try {
            secretNumber = await solvePuzzle(challenge, targetHash);
          } catch (err) {
            tempSocket.close();
            return reject(new Error("Failed to solve cryptographic puzzle: " + err.message));
          }

          // Sign the login challenge using session prefix
          const signature = await this.wallet.signMessage(`Authorize Echo Session: ${challenge}`);

          tempSocket.emit('loginWithSignature', {
            address: this.address,
            challenge,
            signature,
            publicKey: this.wallet.identityPublic,
            secretNumber,
            proofToken
          }, async (res) => {
            tempSocket.close();
            if (res.success) {
              resolve(res);
            } else {
              reject(new Error(res.error));
            }
          });
        });
      });
      tempSocket.on('connect_error', (err) => {
        reject(new Error("Connection error during re-authentication: " + err.message));
      });
    });

    // Save only tokens and address in local database, keeping cryptographic keys untouched
    await this.setMetadata('address', this.address);
    await this.setMetadata('username', loginResult.username);
    await this.setMetadata('access_token', loginResult.token);
    await this.setMetadata('refresh_token', loginResult.refreshToken);
    await this.setMetadata('registered', 'true');
    await this.setMetadata('stealth_mode', loginResult.stealthMode ? 'true' : 'false');
    await this.setMetadata('hide_wallet', loginResult.hideWallet ? 'true' : 'false');
    await this.setMetadata('bio', loginResult.bio || '');
    await this.setMetadata('pfp', loginResult.pfp || '');

    return {
      username: loginResult.username,
      address: this.address,
      stealthMode: !!loginResult.stealthMode,
      hideWallet: !!loginResult.hideWallet,
      bio: loginResult.bio || '',
      pfp: loginResult.pfp || null
    };
  }

  // Upload/replenish one-time keys on the relay server
  async uploadOneTimeKeys(keys) {
    if (!this.connected || !this.socket) {
      throw new Error("Client is not connected.");
    }
    console.log(`[SDK] uploadOneTimeKeys emitting for ${keys.length} keys...`);
    return new Promise((resolve, reject) => {
      this.socket.emit('uploadOneTimeKeys', { keys }, (res) => {
        console.log(`[SDK] uploadOneTimeKeys server response received: success = ${res.success}`);
        if (res.success) {
          // Mark keys as registered in local DB
          this.db.write((db) => {
            const keyIds = keys.map(k => k.keyId);
            const stmt = db.prepare('UPDATE one_time_keys SET registered = 1 WHERE key_id = ?');
            for (const keyId of keyIds) {
              stmt.run(keyId);
            }
          }).then(() => {
            console.log(`[SDK] uploadOneTimeKeys database mark complete for ${keys.length} keys.`);
            resolve(true);
          }).catch(reject);
        } else {
          reject(new Error(res.error));
        }
      });
    });
  }

  // Automatically refresh access token using the HTTP refresh endpoint
  async refreshToken() {
    const refreshTokenVal = await this.getMetadata('refresh_token');
    if (!refreshTokenVal) {
      throw new Error("No refresh token found. User must re-authenticate.");
    }

    try {
      const refreshUrl = `${this.serverUrl}/refresh`;
      const res = await postJSON(refreshUrl, {
        address: this.address,
        refreshToken: refreshTokenVal
      });

      if (res.success && res.token && res.refreshToken) {
        await this.setMetadata('access_token', res.token);
        await this.setMetadata('refresh_token', res.refreshToken);
        console.log("[SDK] Session tokens rotated successfully.");
        return res.token;
      } else {
        throw new Error(res.error || "Token rotation rejected.");
      }
    } catch (err) {
      console.error("[SDK] Silent refresh failed:", err.message);
      throw err;
    }
  }

  // Connect client socket to the relay server and perform login
  async connect() {
    if (this.connected) return;

    const token = await this.getMetadata('access_token');
    if (!token) {
      throw new Error("No access token found. Register first.");
    }

    this.socket = io(this.serverUrl, {
      auth: {
        token,
        address: this.address
      }
    });

    return new Promise((resolve, reject) => {
      this.socket.on('connect', () => {
        // Authenticate via 'login' event
        this.socket.emit('login', { address: this.address, token }, async (res) => {
          if (res.success) {
            this.connected = true;
            this.emit('status', 'connected');
            if (res.token) {
              await this.setMetadata('access_token', res.token);
              console.log("[SDK] Access token rotated successfully on login connection.");
            }
            if (res.username) await this.setMetadata('username', res.username);
            await this.setMetadata('stealth_mode', res.stealthMode ? 'true' : 'false');
            await this.setMetadata('hide_wallet', res.hideWallet ? 'true' : 'false');
            if (res.bio !== undefined) await this.setMetadata('bio', res.bio || '');
            if (res.pfp !== undefined) await this.setMetadata('pfp', res.pfp || '');
            
            await this.onLoginSuccess(res.opkCount);
            resolve(true);
          } else {
            // Check if login failed due to expired access token
            if (res.error && res.error.includes("Invalid session token")) {
              console.log("[SDK] Access token expired. Triggering silent refresh...");
              try {
                const newToken = await this.refreshToken();
                // Reconnect socket with new auth token
                this.socket.auth.token = newToken;
                this.socket.disconnect().connect();
                
                // Retry login
                this.socket.emit('login', { address: this.address, token: newToken }, async (retryRes) => {
                  if (retryRes.success) {
                    this.connected = true;
                    this.emit('status', 'connected');
                    if (retryRes.username) await this.setMetadata('username', retryRes.username);
                    await this.setMetadata('stealth_mode', retryRes.stealthMode ? 'true' : 'false');
                    await this.setMetadata('hide_wallet', retryRes.hideWallet ? 'true' : 'false');
                    if (retryRes.bio !== undefined) await this.setMetadata('bio', retryRes.bio || '');
                    if (retryRes.pfp !== undefined) await this.setMetadata('pfp', retryRes.pfp || '');
                    
                    await this.onLoginSuccess(retryRes.opkCount);
                    resolve(true);
                  } else {
                    reject(new Error("Login failed after token refresh: " + retryRes.error));
                  }
                });
              } catch (refreshErr) {
                this.socket.close();
                reject(new Error("Silent token refresh failed: " + refreshErr.message));
              }
            } else {
              this.socket.close();
              reject(new Error("Login failed: " + res.error));
            }
          }
        });
      });

      // Handle real-time incoming messages
      this.socket.on('message', async (payload) => {
        try {
          const decrypted = await this.decryptAndStoreMessage(payload);
          // Acknowledge receipt to purge message from the relay
          this.socket.emit('messageAck', { messageIds: [payload.id] }, (ack) => {
            if (!ack.success) console.error("[SDK] Failed to send message ACK to server.");
          });
          this.emit('message', decrypted);
        } catch (err) {
          console.error("[SDK] Failed to process real-time message:", err.message);
        }
      });

      this.socket.on('readReceipt', async (payload) => {
        const fromAddress = payload.from.toLowerCase();
        await this.db.write((db) => {
          for (const mid of payload.messageIds) {
            if (payload.groupId) {
              db.prepare(`
                INSERT OR REPLACE INTO group_message_status (message_id, user_address, status, timestamp)
                VALUES (?, ?, ?, ?)
              `).run(mid, fromAddress, 'read', Date.now());
            } else {
              db.prepare('UPDATE messages SET status = ? WHERE id = ?')
                .run('read', mid);
            }
          }
        });
        this.emit('readReceipt', {
          from: fromAddress,
          messageIds: payload.messageIds,
          groupId: payload.groupId
        });
      });

      this.socket.on('messageStatus', async (payload) => {
        const { messageId, status, recipient, groupId } = payload;
        await this.db.write((db) => {
          db.prepare('UPDATE messages SET status = ? WHERE id = ?')
            .run(status, messageId);
        });
        this.emit('messageStatus', {
          messageId,
          status,
          recipient: recipient.toLowerCase(),
          groupId
        });
      });

      this.socket.on('connect_error', (err) => {
        this.connected = false;
        this.emit('status', 'disconnected');
        reject(new Error("Connection error: " + err.message));
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        this.emit('status', 'disconnected');
      });
    });
  }

  // Handle post-login actions (OPK replenishment and offline sync)
  async onLoginSuccess(opkCount) {
    console.log(`[SDK] Logged in successfully. Current server OPKs: ${opkCount}`);

    // Replenish one-time pre-keys if count falls below 20
    if (opkCount < 20) {
      console.log("[SDK] Server one-time keys running low. Generating new batch...");
      try {
        const lastKeyRow = await this.db.read((db) => {
          return db.prepare('SELECT MAX(key_id) as maxId FROM one_time_keys').get();
        });
        const startId = (lastKeyRow && lastKeyRow.maxId ? lastKeyRow.maxId : 0) + 1;
        const newKeys = await this.generateOneTimeKeys(startId, 50);
        await this.uploadOneTimeKeys(newKeys);
        console.log("[SDK] Successfully replenished 50 one-time keys on server.");
      } catch (err) {
        console.error("[SDK] Failed to replenish one-time keys:", err.message);
      }
    }

    // Automatically sync offline queue
    await this.syncOfflineMessages();
  }

  // Pull, decrypt, persist, and acknowledge pending offline messages
  async syncOfflineMessages() {
    if (!this.connected || !this.socket) return;

    return new Promise((resolve) => {
      this.socket.emit('fetchOfflineQueue', async (queue) => {
        console.log(`[SDK] Synced offline queue. Found ${queue.length} buffered messages.`);
        if (queue.length === 0) {
          return resolve(true);
        }

        const acknowledgedIds = [];

        for (const payload of queue) {
          try {
            const decrypted = await this.decryptAndStoreMessage(payload);
            acknowledgedIds.push(payload.id);
            this.emit('message', decrypted);
          } catch (err) {
            console.error(`[SDK] Error processing offline message ${payload.id}:`, err.message);
          }
        }

        if (acknowledgedIds.length > 0) {
          this.socket.emit('messageAck', { messageIds: acknowledgedIds }, (ack) => {
            if (ack.success) {
              console.log(`[SDK] Purged ${acknowledgedIds.length} synced messages from server.`);
            } else {
              console.error("[SDK] Failed to acknowledge offline message sync.");
            }
            resolve(true);
          });
        } else {
          resolve(true);
        }
      });
    });
  }

  // Decrypts message envelope and stores plaintext in the local SQLite database
  async decryptAndStoreMessage(payload) {
    // 1. Message ID duplicate replay check
    const exists = await this.db.read((db) => {
      return db.prepare('SELECT id FROM messages WHERE id = ?').get(payload.id);
    });
    if (exists) {
      console.warn(`[Security] Duplicate message ID ${payload.id} received. Rejecting to prevent replay.`);
      throw new Error(`Duplicate message ID ${payload.id} received.`);
    }

    // 2. Message timestamp drift check (max 5 minutes)
    if (Math.abs(Date.now() - payload.timestamp) > 5 * 60 * 1000) {
      console.warn(`[Security] Stale message timestamp (${payload.timestamp}) received. Rejecting to prevent replay.`);
      throw new Error(`Message timestamp drift too large (${payload.timestamp}).`);
    }

    const fromAddress = payload.from.toLowerCase();
    
    if (payload.dhPublic === 'read_receipt') {
      const { messageIds, groupId } = JSON.parse(payload.ciphertext);
      await this.db.write((db) => {
        for (const mid of messageIds) {
          if (groupId) {
            db.prepare(`
              INSERT OR REPLACE INTO group_message_status (message_id, user_address, status, timestamp)
              VALUES (?, ?, ?, ?)
            `).run(mid, fromAddress, 'read', payload.timestamp);
          } else {
            db.prepare('UPDATE messages SET status = ? WHERE id = ?')
              .run('read', mid);
          }
        }
      });
      this.emit('readReceipt', {
        from: fromAddress,
        messageIds,
        groupId
      });
      return {
        id: payload.id,
        from: fromAddress,
        type: 'read_receipt',
        system: true,
        timestamp: payload.timestamp
      };
    }

    // 1. Check if this is a group message payload (encrypted under a group key)
    if (payload.groupId && payload.dhPublic === 'group') {
      const group = await this.db.read((db) => {
        return db.prepare('SELECT group_key, name FROM groups WHERE id = ?').get(payload.groupId);
      });
      if (!group) {
        throw new Error(`Group key not found locally for group ${payload.groupId}`);
      }

      const decryptedPlaintext = decryptAES_GCM(payload.ciphertext, group.group_key, payload.iv);

      let bodyText = decryptedPlaintext;
      let signatureVerified = true;

      let resolvedFromAddress = fromAddress.toLowerCase();
      if (!resolvedFromAddress.startsWith('0x')) {
        const row = db.prepare('SELECT id FROM conversations WHERE LOWER(username) = ? AND is_group = 0').get(resolvedFromAddress);
        if (row) {
          resolvedFromAddress = row.id.toLowerCase();
        }
      }

      try {
        const payloadObj = JSON.parse(decryptedPlaintext);
        if (payloadObj && payloadObj.plaintext && payloadObj.signature) {
          if (payloadObj.sessionSigner && payloadObj.sessionDelegation) {
            // Verify delegated session key signature (1. Check delegation, 2. Check message)
            let isDelegationValid = false;
            if (payloadObj.sessionIdentityKey) {
              const rawPubBytes = Buffer.from(payloadObj.sessionIdentityKey, 'hex').slice(-32);
              const derivedAddr = '0x' + keccak256(rawPubBytes).slice(-40).toLowerCase();
              if (derivedAddr === resolvedFromAddress) {
                isDelegationValid = verifyEd25519Signature(
                  `Authorize Echo Session Key: ${payloadObj.sessionSigner}`,
                  payloadObj.sessionDelegation,
                  payloadObj.sessionIdentityKey
                );
              }
            } else {
              // Legacy secp256k1 fallback
              try {
                const recoveredMain = verifyMessage(`Authorize Echo Session Key: ${payloadObj.sessionSigner}`, payloadObj.sessionDelegation);
                isDelegationValid = recoveredMain.toLowerCase() === resolvedFromAddress;
              } catch (e) {
                isDelegationValid = false;
              }
            }

            const recoveredMsg = verifyMessage(payloadObj.plaintext, payloadObj.signature);
            if (
              !isDelegationValid ||
              recoveredMsg.toLowerCase() !== payloadObj.sessionSigner.toLowerCase()
            ) {
              signatureVerified = false;
            }
          } else {
            // Standard direct signature (legacy/direct format)
            let isDirectSigValid = false;
            // Try Ed25519 first if identity key is provided in a field
            if (payloadObj.sessionIdentityKey) {
              const rawPubBytes = Buffer.from(payloadObj.sessionIdentityKey, 'hex').slice(-32);
              const derivedAddr = '0x' + keccak256(rawPubBytes).slice(-40).toLowerCase();
              if (derivedAddr === resolvedFromAddress) {
                isDirectSigValid = verifyEd25519Signature(payloadObj.plaintext, payloadObj.signature, payloadObj.sessionIdentityKey);
              }
            } else {
              try {
                const recovered = verifyMessage(payloadObj.plaintext, payloadObj.signature);
                isDirectSigValid = recovered.toLowerCase() === resolvedFromAddress;
              } catch (e) {
                isDirectSigValid = false;
              }
            }
            if (!isDirectSigValid) {
              signatureVerified = false;
            }
          }
          bodyText = payloadObj.plaintext;
        }
      } catch (e) {
        // Not a JSON payload, probably legacy message. Allow it for backward compatibility.
      }

      if (!signatureVerified) {
        bodyText = `⚠️ [UNVERIFIED SENDER] ${bodyText}`;
      }

      if (bodyText && bodyText.startsWith('__READ_RECEIPT__:')) {
        try {
          const parts = bodyText.substring(17);
          const { messageIds, groupId } = JSON.parse(parts);

          await this.db.write((db) => {
            for (const mid of messageIds) {
              db.prepare(`
                INSERT OR REPLACE INTO group_message_status (message_id, user_address, status, timestamp)
                VALUES (?, ?, ?, ?)
              `).run(mid, fromAddress, 'read', payload.timestamp);
            }
          });

          this.emit('readReceipt', {
            from: fromAddress,
            messageIds,
            groupId
          });

          return {
            id: payload.id,
            from: fromAddress,
            type: 'read_receipt',
            system: true,
            timestamp: payload.timestamp
          };
        } catch (err) {
          console.error("[SDK] Failed to parse group read receipt:", err.message);
        }
      }

      let mediaMetadata = null;
      if (bodyText.startsWith('__MEDIA__:')) {
        try {
          const parts = bodyText.substring(10);
          mediaMetadata = JSON.parse(parts);
          bodyText = "[Attachment]";
        } catch (err) {
          console.error("[SDK] Failed to parse media metadata:", err.message);
        }
      }

      await this.db.write((db) => {
        db.prepare(`
          INSERT OR IGNORE INTO conversations (id, username, is_group, last_message_at, created_at)
          VALUES (?, ?, 1, ?, ?)
        `).run(payload.groupId, group.name, payload.timestamp, payload.timestamp);

        db.prepare(`
          UPDATE conversations SET last_message_at = ? WHERE id = ?
        `).run(payload.timestamp, payload.groupId);

        db.prepare(`
          INSERT OR REPLACE INTO messages (id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          payload.id,
          payload.groupId,
          fromAddress,
          payload.groupId,
          null, // Ciphertext is cleared after successful decryption
          bodyText,
          mediaMetadata ? JSON.stringify(mediaMetadata) : null,
          payload.timestamp,
          'unread'
        );
      });

      return {
        id: payload.id,
        from: fromAddress,
        groupId: payload.groupId,
        text: bodyText,
        media: mediaMetadata,
        timestamp: payload.timestamp,
        senderUsername: payload.senderUsername,
        senderHideWallet: payload.senderHideWallet,
        senderBio: payload.senderBio,
        senderPfp: payload.senderPfp
      };
    }

    let session = await DoubleRatchetSession.load(this.db, fromAddress);

    // If no session exists, try to initialize it using X3DH header information
    if (!session) {
      if (payload.x3dhInfo) {
        console.log(`[SDK] Initializing new E2EE Double Ratchet session for ${fromAddress} via X3DH...`);
        const myIdentityPrivate = await this.getMetadata('identity_private');
        const mySignedPrePrivate = await this.getMetadata('signed_pre_private');

        session = await DoubleRatchetSession.receiveInit(
          this.db,
          fromAddress,
          myIdentityPrivate,
          mySignedPrePrivate,
          payload.x3dhInfo.aliceIdentityPublic,
          payload.x3dhInfo.aliceEphemeralPublic,
          payload.x3dhInfo.usedOneTimeKeyId
        );
      } else {
        throw new Error(`No active session or X3DH metadata found for contact ${fromAddress}`);
      }
    }

    // Decrypt the ciphertext payload
    const plaintext = await session.decrypt(this.db, payload);

    // Check if this is a remote peer data wipe request
    if (plaintext && plaintext.startsWith('__WIPE_USER_DATA__:')) {
      const peerAddress = plaintext.substring(20).toLowerCase();
      if (peerAddress !== fromAddress.toLowerCase()) {
        console.error('[Security] Wipe command rejected: sender address mismatch');
        throw new Error('SECURITY: Wipe command address mismatch.');
      }
      
      await this.db.write((db) => {
        db.prepare('DELETE FROM messages WHERE conversation_id = ? OR sender_address = ? OR recipient_address = ?')
          .run(peerAddress, peerAddress, peerAddress);
        db.prepare('DELETE FROM conversations WHERE id = ?')
          .run(peerAddress);
      });
      return {
        id: payload.id,
        from: fromAddress,
        text: `[Account deleted by peer]`,
        system: true,
        timestamp: payload.timestamp,
        senderUsername: payload.senderUsername,
        senderHideWallet: payload.senderHideWallet
      };
    }

    // Check if this is a group key distribution system message
    if (plaintext.startsWith('__GROUP_KEY__:')) {
      try {
        const parts = plaintext.substring(14);
        const groupData = JSON.parse(parts);

        // Schema validation
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!groupData.groupId || !uuidRegex.test(groupData.groupId)) {
          throw new Error("Invalid group UUID");
        }
        const hexRegex = /^[0-9a-f]{64}$/i;
        if (!groupData.groupKey || !hexRegex.test(groupData.groupKey)) {
          throw new Error("Invalid group key format");
        }
        if (typeof groupData.name !== 'string' || groupData.name.trim().length === 0 || groupData.name.length > 100) {
          throw new Error("Invalid group name");
        }
        if (!Array.isArray(groupData.members) || groupData.members.length === 0) {
          throw new Error("Invalid group members");
        }

        // Membership validation
        const lowerFrom = fromAddress.toLowerCase();
        const lowerMe = this.address.toLowerCase();
        const lowerMembers = groupData.members.map(m => m.toLowerCase());
        
        if (!lowerMembers.includes(lowerMe)) {
          throw new Error("Self not in group members list");
        }
        if (!lowerMembers.includes(lowerFrom)) {
          throw new Error("Sender not in group members list");
        }

        await this.db.write((db) => {
          db.prepare('INSERT OR REPLACE INTO groups (id, name, group_key, members) VALUES (?, ?, ?, ?)')
            .run(groupData.groupId, groupData.name, groupData.groupKey, JSON.stringify(groupData.members));

          db.prepare(`
            INSERT OR IGNORE INTO conversations (id, username, is_group, last_message_at, created_at)
            VALUES (?, ?, 1, ?, ?)
          `).run(groupData.groupId, groupData.name, payload.timestamp, payload.timestamp);
        });

        return {
          id: payload.id,
          from: fromAddress,
          groupId: groupData.groupId,
          text: `[Joined Group: ${groupData.name}]`,
          system: true,
          timestamp: payload.timestamp,
          senderUsername: payload.senderUsername,
          senderHideWallet: payload.senderHideWallet
        };
      } catch (err) {
        console.error("[Security] Group key processing failed:", err.message);
        throw new Error(`Group key processing failed: ${err.message}`);
      }
    }

    // Extract media metadata if it exists
    let bodyText = plaintext;

    // Check if this is an encrypted read receipt in 1-1 chat
    if (bodyText && bodyText.startsWith('__READ_RECEIPT__:')) {
      try {
        const parts = bodyText.substring(17);
        const { messageIds, groupId } = JSON.parse(parts);

        await this.db.write((db) => {
          for (const mid of messageIds) {
            db.prepare('UPDATE messages SET status = ? WHERE id = ?')
              .run('read', mid);
          }
        });

        this.emit('readReceipt', {
          from: fromAddress,
          messageIds,
          groupId
        });

        return {
          id: payload.id,
          from: fromAddress,
          type: 'read_receipt',
          system: true,
          timestamp: payload.timestamp
        };
      } catch (err) {
        console.error("[SDK] Failed to parse 1-1 read receipt:", err.message);
      }
    }

    let mediaMetadata = null;
    if (plaintext.startsWith('__MEDIA__:')) {
      try {
        const parts = plaintext.substring(10);
        mediaMetadata = JSON.parse(parts);
        bodyText = "[Attachment]";
      } catch (err) {
        console.error("[SDK] Failed to parse media metadata:", err.message);
      }
    }

    // Create a local conversation record if it does not exist
    await this.db.write((db) => {
      db.prepare(`
        INSERT OR IGNORE INTO conversations (id, username, last_message_at, created_at, hide_wallet, bio, pfp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        fromAddress,
        payload.senderUsername || fromAddress.substring(0, 10),
        payload.timestamp,
        payload.timestamp,
        payload.senderHideWallet ? 1 : 0,
        payload.senderBio !== undefined ? payload.senderBio : null,
        payload.senderPfp !== undefined ? payload.senderPfp : null
      );

      if (payload.senderUsername) {
        db.prepare(`
          UPDATE conversations SET username = ?, hide_wallet = ?, bio = ?, pfp = ? WHERE id = ?
        `).run(
          payload.senderUsername,
          payload.senderHideWallet ? 1 : 0,
          payload.senderBio !== undefined ? payload.senderBio : null,
          payload.senderPfp !== undefined ? payload.senderPfp : null,
          fromAddress
        );
      }

      db.prepare(`
        UPDATE conversations SET last_message_at = ? WHERE id = ?
      `).run(payload.timestamp, fromAddress);

      // Insert message into messages history
      db.prepare(`
        INSERT OR REPLACE INTO messages (id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        payload.id,
        fromAddress,
        fromAddress,
        this.address,
        null, // Ciphertext is cleared after successful decryption
        bodyText,
        mediaMetadata ? JSON.stringify(mediaMetadata) : null,
        payload.timestamp,
        'unread'
      );
    });

    return {
      id: payload.id,
      from: fromAddress,
      text: bodyText,
      media: mediaMetadata,
      timestamp: payload.timestamp,
      senderUsername: payload.senderUsername,
      senderHideWallet: payload.senderHideWallet,
      senderBio: payload.senderBio,
      senderPfp: payload.senderPfp
    };
  }

  // Encrypts and transmits a text message (or media metadata envelope) to a recipient
  async sendMessage(recipientAddress, bodyText, mediaMetadata = null, recipientUsername = null, recipientHideWallet = null, recipientBio = null, recipientPfp = null) {
    const toAddress = recipientAddress.toLowerCase();
    
    let session = await DoubleRatchetSession.load(this.db, toAddress);
    let x3dhInfo = null;
    let localUsername = recipientUsername;
    let localHideWallet = recipientHideWallet;
    let localBio = recipientBio;
    let localPfp = recipientPfp;

    // If no session exists or the sending chain key is uninitialized/corrupted, initiate a new X3DH session
    if (!session || !session.sending_chain_key) {
      if (!this.connected || !this.socket) {
        throw new Error("Cannot negotiate new session while offline.");
      }

      console.log(`[SDK] Fetching pre-key bundle for ${toAddress} to negotiate session...`);
      const bundleResult = await new Promise((resolve, reject) => {
        this.socket.emit('getKeyBundle', { address: toAddress }, (res) => {
          if (res.success) resolve(res.bundle);
          else reject(new Error("Failed to fetch pre-key bundle: " + res.error));
        });
      });

      if (bundleResult.username) {
        localUsername = bundleResult.username;
        localHideWallet = bundleResult.hideWallet;
        localBio = bundleResult.bio;
        localPfp = bundleResult.pfp;
      }

      try {
        const signingKey = bundleResult.identitySigningKey || bundleResult.identityKey;
        const rawPubBytes = Buffer.from(signingKey, 'hex').slice(-32);
        const derivedAddr = '0x' + keccak256(rawPubBytes).slice(-40).toLowerCase();
        const isWalletAddress = toAddress.startsWith('0x') && toAddress.length === 42;
        if (isWalletAddress && derivedAddr !== toAddress.toLowerCase()) {
          throw new Error('Identity key does not hash to recipient address.');
        }
        const isPreKeySigValid = verifyEd25519Signature(bundleResult.signedPreKey, bundleResult.preKeySignature, signingKey);
        if (!isPreKeySigValid) {
          throw new Error('Pre-key signature verification failed.');
        }
      } catch (err) {
        throw new Error(`SECURITY: Pre-key signature verification failed for ${toAddress}: ${err.message}. Possible relay MITM.`);
      }

      const myIdentityPrivate = await this.getMetadata('identity_private');
      const myIdentityPublic = await this.getMetadata('identity_public');

      const initRes = await DoubleRatchetSession.initiate(
        this.db,
        toAddress,
        myIdentityPrivate,
        myIdentityPublic,
        bundleResult
      );

      session = initRes.session;
      x3dhInfo = {
        aliceIdentityPublic: myIdentityPublic,
        aliceEphemeralPublic: initRes.ephemeralPublicKey,
        usedOneTimeKeyId: bundleResult.oneTimeKeyId
      };
      console.log(`[SDK] Initiated E2EE session with ${toAddress} successfully.`);
    }

    // Determine payload to encrypt
    let plaintext = bodyText;
    if (mediaMetadata) {
      plaintext = `__MEDIA__:${JSON.stringify(mediaMetadata)}`;
    }

    // Encrypt the plaintext using the session KDF chain
    const encResult = await session.encrypt(this.db, plaintext);
    const messageId = crypto.randomUUID();
    const timestamp = Date.now();

    // Store in local database as 'sending' (only if not a protocol message)
    const isProtocolMessage = bodyText && (bodyText.startsWith('__GROUP_KEY__:') || bodyText.startsWith('__READ_RECEIPT__:') || bodyText.startsWith('__WIPE_USER_DATA__:'));
    if (!isProtocolMessage) {
      await this.db.write((db) => {
        db.prepare(`
          INSERT OR IGNORE INTO conversations (id, username, last_message_at, created_at, hide_wallet, bio, pfp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          toAddress,
          localUsername || toAddress.substring(0, 10),
          timestamp,
          timestamp,
          localHideWallet ? 1 : 0,
          localBio !== undefined ? localBio : null,
          localPfp !== undefined ? localPfp : null
        );

        if (localUsername) {
          db.prepare(`
            UPDATE conversations SET username = ?, hide_wallet = ?, bio = ?, pfp = ? WHERE id = ?
          `).run(
            localUsername,
            localHideWallet ? 1 : 0,
            localBio !== undefined ? localBio : null,
            localPfp !== undefined ? localPfp : null,
            toAddress
          );
        }

        db.prepare(`
          UPDATE conversations SET last_message_at = ? WHERE id = ?
        `).run(timestamp, toAddress);

        db.prepare(`
          INSERT OR REPLACE INTO messages (id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId,
          toAddress,
          this.address,
          toAddress,
          encResult.ciphertext,
          mediaMetadata ? "[Attachment]" : bodyText,
          mediaMetadata ? JSON.stringify(mediaMetadata) : null,
          timestamp,
          'sending'
        );
      });
    }

    // Transmit to relay server
    return new Promise((resolve, reject) => {
      this.socket.emit('sendMessage', {
        id: messageId,
        to: toAddress,
        ciphertext: encResult.ciphertext,
        iv: encResult.iv,
        dhPublic: encResult.dhPublic,
        sequenceNumber: encResult.sequenceNumber,
        timestamp,
        x3dhInfo,
        groupId: null
      }, async (res) => {
        if (res.success) {
          const finalStatus = res.delivered ? 'delivered' : 'sent';
          if (!isProtocolMessage) {
            await this.db.write((db) => {
              db.prepare('UPDATE messages SET status = ? WHERE id = ?')
                .run(finalStatus, messageId);
            });
          }
          resolve({
            id: messageId,
            to: toAddress,
            text: bodyText,
            status: finalStatus,
            timestamp
          });
        } else {
          reject(new Error(res.error));
        }
      });
    });
  }

  // Creates a group chat, generates an epoch key, and distributes it over 1-to-1 ratchets
  async createGroup(name, memberAddresses) {
    const groupId = crypto.randomUUID();
    const groupKey = crypto.randomBytes(32).toString('hex');
    const allMembers = [this.address, ...memberAddresses.map(addr => addr.toLowerCase())];
    const membersJSON = JSON.stringify(allMembers);

    await this.db.write((db) => {
      db.prepare('INSERT OR REPLACE INTO groups (id, name, group_key, members) VALUES (?, ?, ?, ?)')
        .run(groupId, name, groupKey, membersJSON);
      db.prepare(`
        INSERT OR IGNORE INTO conversations (id, username, is_group, last_message_at, created_at)
        VALUES (?, ?, 1, ?, ?)
      `).run(groupId, name, Date.now(), Date.now());
    });

    console.log(`[SDK] Group ${name} created locally. Distributing keys to ${memberAddresses.length} members...`);

    // Distribute key to each member via E2EE 1-to-1 ratchets
    const distributionPayload = `__GROUP_KEY__:${JSON.stringify({
      groupId,
      groupKey,
      name,
      members: allMembers
    })}`;

    for (const member of memberAddresses) {
      if (member.toLowerCase() !== this.address) {
        await this.sendMessage(member, distributionPayload);
      }
    }

    console.log(`[SDK] Group key distribution completed for group ${name}.`);
    return { groupId };
  }

  // Encrypts and sends a group message using client-side multicast
  async sendGroupMessage(groupId, bodyText, mediaMetadata = null) {
    const group = await this.db.read((db) => {
      return db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    });
    if (!group) throw new Error("Group not found in local database.");

    const members = JSON.parse(group.members);
    const iv = crypto.randomBytes(12).toString('hex');
    
    let plaintext = bodyText;
    if (mediaMetadata) {
      plaintext = `__MEDIA__:${JSON.stringify(mediaMetadata)}`;
    }

    // Sign the group message payload using delegated session key to prevent repeated user popups
    let authenticatedPayload;
    try {
      const { privateKey, delegationSignature } = await this.getOrCreateSessionSigningKey();
      const localWallet = new Wallet(privateKey);
      const signature = await localWallet.signMessage(plaintext);
      const identityPublic = this.wallet.identityPublic || await this.getMetadata('identity_public');
      authenticatedPayload = JSON.stringify({
        plaintext,
        signature,
        sessionSigner: localWallet.address,
        sessionDelegation: delegationSignature,
        sessionIdentityKey: identityPublic
      });
    } catch (err) {
      console.warn("[Security] Delegated signing failed, falling back to plaintext:", err.message);
      authenticatedPayload = plaintext;
    }

    // Encrypt under the group key
    const ciphertext = encryptAES_GCM(authenticatedPayload, group.group_key, iv);
    const messageId = crypto.randomUUID();
    const timestamp = Date.now();

    // Store locally as sent (only if not a protocol message)
    const isProtocolMessage = bodyText && (bodyText.startsWith('__GROUP_KEY__:') || bodyText.startsWith('__READ_RECEIPT__:') || bodyText.startsWith('__WIPE_USER_DATA__:'));
    if (!isProtocolMessage) {
      await this.db.write((db) => {
        db.prepare(`
          INSERT OR REPLACE INTO messages (id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId,
          groupId,
          this.address,
          groupId,
          null,
          mediaMetadata ? "[Attachment]" : bodyText,
          mediaMetadata ? JSON.stringify(mediaMetadata) : null,
          timestamp,
          'sent'
        );

        db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?')
          .run(timestamp, groupId);
      });
    }

    // Multicast: send envelope to each group member
    const promises = [];
    for (const member of members) {
      if (member.toLowerCase() !== this.address) {
        if (!this.connected || !this.socket) continue;

        promises.push(new Promise((resolve, reject) => {
          this.socket.emit('sendMessage', {
            id: crypto.randomUUID(), // Unique id per outbox packet
            to: member,
            ciphertext,
            iv,
            dhPublic: 'group',
            sequenceNumber: 0,
            timestamp,
            groupId
          }, (res) => {
            if (res.success) resolve(res);
            else reject(new Error(res.error));
          });
        }));
      }
    }

    await Promise.all(promises);

    return {
      id: messageId,
      groupId,
      text: bodyText,
      timestamp
    };
  }

  // Upload media using Render homing relays
  async uploadMedia(fileBuffer, mimeType, onProgress = null, signal = null) {
    return uploadMediaInChunks(fileBuffer, mimeType, onProgress, signal);
  }

  // Download and decrypt media manifest
  async downloadMedia(manifest, onProgress = null, signal = null) {
    return downloadMediaAndDecrypt(manifest, onProgress, signal);
  }

  // Upload file, and send a message containing the media manifest envelope
  async sendMediaMessage(recipientAddress, fileBuffer, mimeType, onProgress = null, signal = null) {
    const manifest = await this.uploadMedia(fileBuffer, mimeType, onProgress, signal);
    const isGroup = await this.db.read((db) => {
      return db.prepare('SELECT id FROM groups WHERE id = ?').get(recipientAddress);
    });

    if (isGroup) {
      return this.sendGroupMessage(recipientAddress, "[Attachment]", manifest);
    } else {
      return this.sendMessage(recipientAddress, "[Attachment]", manifest);
    }
  }

  // Derive a backup key from passphrase using scrypt
  async deriveBackupKeyAsync(passphrase, salt) {
    const saltBuf = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(16);
    let key;
    if (crypto.scryptAsync) {
      key = await crypto.scryptAsync(passphrase, saltBuf, 32);
    } else {
      key = crypto.scryptSync(passphrase, saltBuf, 32);
    }
    return {
      key,
      salt: saltBuf.toString('hex')
    };
  }

  // Encrypts and exports all database data (metadata, conversations, messages, groups)
  async exportBackup(passphrase) {
    const metadata = await this.db.read((db) => {
      return db.prepare('SELECT * FROM key_metadata').all();
    });
    const conversations = await this.db.read((db) => {
      return db.prepare('SELECT * FROM conversations').all();
    });
    const messages = await this.db.read((db) => {
      return db.prepare('SELECT * FROM messages').all();
    });
    const groups = await this.db.read((db) => {
      return db.prepare('SELECT * FROM groups').all();
    });

    const bundle = {
      metadata,
      conversations,
      messages,
      groups
    };

    const { key, salt } = await this.deriveBackupKeyAsync(passphrase);
    const iv = crypto.randomBytes(12);

    const plaintext = JSON.stringify(bundle);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const ciphertext = Buffer.concat([encrypted, tag]).toString('base64');

    return JSON.stringify({
      salt,
      iv: iv.toString('hex'),
      ciphertext
    });
  }

  // Decrypts and restores all database data from a backup JSON string
  async importBackup(passphrase, backupJSON) {
    const { salt, iv, ciphertext } = JSON.parse(backupJSON);
    
    let key;
    if (crypto.scryptAsync) {
      key = await crypto.scryptAsync(passphrase, Buffer.from(salt, 'hex'), 32);
    } else {
      key = crypto.scryptSync(passphrase, Buffer.from(salt, 'hex'), 32);
    }
    const combined = Buffer.from(ciphertext, 'base64');

    const tagLength = 16;
    const encrypted = combined.subarray(0, combined.length - tagLength);
    const tag = combined.subarray(combined.length - tagLength);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');

    const bundle = JSON.parse(decrypted);

    await this.db.write((db) => {
      // Clear current data
      db.prepare('DELETE FROM key_metadata').run();
      db.prepare('DELETE FROM conversations').run();
      db.prepare('DELETE FROM messages').run();
      db.prepare('DELETE FROM groups').run();

      // Insert metadata
      const insertMeta = db.prepare('INSERT OR REPLACE INTO key_metadata (key, value) VALUES (?, ?)');
      for (const row of bundle.metadata) {
        insertMeta.run(row.key, row.value);
      }

      // Insert conversations
      const insertConv = db.prepare('INSERT OR REPLACE INTO conversations (id, username, is_group, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const row of bundle.conversations) {
        insertConv.run(row.id, row.username, row.is_group, row.last_message_at, row.created_at);
      }

      // Insert messages
      const insertMsg = db.prepare('INSERT OR REPLACE INTO messages (id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of bundle.messages) {
        insertMsg.run(row.id, row.conversation_id, row.sender_address, row.recipient_address, row.ciphertext, row.body_text, row.media_metadata, row.timestamp, row.status);
      }

      // Insert groups
      const insertGroup = db.prepare('INSERT OR REPLACE INTO groups (id, name, group_key, members) VALUES (?, ?, ?, ?)');
      for (const row of bundle.groups) {
        insertGroup.run(row.id, row.name, row.group_key, row.members);
      }
    });

    // Reload wallet address from the imported metadata
    const addr = await this.getMetadata('address');
    if (addr) {
      this.address = addr.toLowerCase();
    }

    console.log("[SDK] Database backup imported successfully.");
    return true;
  }

  async updateMessageStatus(messageId, status, peerAddress = null, groupId = null) {
    await this.db.write((db) => {
      if (groupId && peerAddress) {
        db.prepare(`
          INSERT OR REPLACE INTO group_message_status (message_id, user_address, status, timestamp)
          VALUES (?, ?, ?, ?)
        `).run(messageId, peerAddress, status, Date.now());
      } else {
        db.prepare('UPDATE messages SET status = ? WHERE id = ?')
          .run(status, messageId);
      }
    });
  }

  async markConversationAsRead(conversationId) {
    await this.db.write((db) => {
      db.prepare('UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_address != ? AND status = ?')
        .run('read', conversationId, this.address, 'unread');
    });
  }

  async sendReadReceipt(recipientAddress, messageIds, groupId = null) {
    const payloadText = `__READ_RECEIPT__:${JSON.stringify({ messageIds, groupId })}`;
    if (groupId) {
      return this.sendGroupMessage(groupId, payloadText);
    } else {
      return this.sendMessage(recipientAddress, payloadText);
    }
  }

  async sendGroupReadReceipt(groupId, messageIds) {
    const group = await this.db.read((db) => {
      return db.prepare('SELECT members FROM groups WHERE id = ?').get(groupId);
    });
    if (!group) return;
    const members = JSON.parse(group.members);
    const promises = [];
    for (const member of members) {
      if (member.toLowerCase() !== this.address) {
        promises.push(this.sendReadReceipt(member, messageIds, groupId).catch(err => {
          console.error(`Failed to send read receipt to group member ${member}:`, err.message);
        }));
      }
    }
    await Promise.all(promises);
  }

  async deleteAccount() {
    if (!this.connected || !this.socket) {
      throw new Error("Cannot delete account while offline.");
    }
    return new Promise((resolve, reject) => {
      this.socket.emit('deleteAccount', (res) => {
        if (res && res.success) {
          resolve(true);
        } else {
          reject(new Error(res ? res.error : "Failed to delete account from server"));
        }
      });
    });
  }

  async wipeAccountFromPeers() {
    const peers = await this.db.read((db) => {
      const rows = db.prepare('SELECT id FROM conversations WHERE is_group = 0').all();
      return rows.map(r => r.id);
    });

    console.log(`[SDK] Wiping account from ${peers.length} peers...`);

    const promises = [];
    for (const peer of peers) {
      promises.push(
        this.sendMessage(peer, `__WIPE_USER_DATA__:${this.address}`)
          .catch(err => console.error(`Failed to send wipe message to peer ${peer}:`, err.message))
      );
    }
    await Promise.all(promises);

    await this.deleteAccount();

    await this.db.write((db) => {
      db.prepare('DELETE FROM key_metadata').run();
      db.prepare('DELETE FROM conversations').run();
      db.prepare('DELETE FROM messages').run();
      db.prepare('DELETE FROM groups').run();
      db.prepare('DELETE FROM group_message_status').run();
      db.prepare('DELETE FROM ratchet_sessions').run();
      db.prepare('DELETE FROM skipped_message_keys').run();
      db.prepare('DELETE FROM one_time_keys').run();
    });

    console.log(`[SDK] Account wipe complete.`);
  }

  // Retrieve or generate a delegated session signing key to prevent repeated user popups
  async getOrCreateSessionSigningKey() {
    let signingPrivate = await this.getMetadata('session_signing_private');
    let delegationSignature = await this.getMetadata('session_signing_delegation');

    if (!signingPrivate || !delegationSignature) {
      const localWallet = Wallet.createRandom();
      signingPrivate = localWallet.privateKey;
      
      // Request delegation signature once from user wallet
      delegationSignature = await this.wallet.signMessage(`Authorize Echo Session Key: ${localWallet.address}`);
      
      await this.setMetadata('session_signing_private', signingPrivate);
      await this.setMetadata('session_signing_public', localWallet.address);
      await this.setMetadata('session_signing_delegation', delegationSignature);
    }

    return {
      privateKey: signingPrivate,
      delegationSignature
    };
  }

  // Close databases and disconnect sockets
  async disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.emit('status', 'disconnected');
  }

  async close() {
    await this.disconnect();
    this.db.close();
  }
}

module.exports = DecentraChatClient;
