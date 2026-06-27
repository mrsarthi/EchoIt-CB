require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const { pool, runMigrations } = require('./db');
runMigrations().catch(err => {
  console.error("Migration error at startup:", err);
});
const {
  generateChallenge,
  verifyWalletSignature,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken
} = require('./auth');
const { sendSilentPushNotification } = require('./push');

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) 
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, '../dist')));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 512 * 1024, // 512KB max buffer size to allow compressed PFP uploads
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Port configuration
const PORT = process.env.PORT || 3000;

// Temporary active socket challenges mapping
const socketChallenges = new Map();

// Rate limiting Map: sender_address -> array of timestamps of messages sent in the last 1 second
const rateLimiter = new Map();
const bundleRateLimiter = new Map();

// Periodic rate limiter memory leak cleanup
setInterval(() => {
  const now = Date.now();
  for (const [addr, timestamps] of rateLimiter) {
    const recent = timestamps.filter(ts => now - ts < 1000);
    if (recent.length === 0) rateLimiter.delete(addr);
    else rateLimiter.set(addr, recent);
  }
  for (const [key, timestamps] of bundleRateLimiter) {
    const recent = timestamps.filter(ts => now - ts < 60000);
    if (recent.length === 0) bundleRateLimiter.delete(key);
    else bundleRateLimiter.set(key, recent);
  }
}, 60000);

function isRateLimited(address) {
  const now = Date.now();
  const timestamps = rateLimiter.get(address) || [];
  
  // Filter out timestamps older than 1 second
  const recentTimestamps = timestamps.filter(ts => now - ts < 1000);
  
  if (recentTimestamps.length >= 20) {
    return true;
  }
  
  recentTimestamps.push(now);
  rateLimiter.set(address, recentTimestamps);
  return false;
}

async function limitRefreshTokens(address) {
  try {
    const countRes = await pool.query('SELECT count(*) FROM refresh_tokens WHERE address = $1', [address.toLowerCase()]);
    const count = parseInt(countRes.rows[0].count, 10);
    if (count >= 5) {
      await pool.query(
        `DELETE FROM refresh_tokens 
         WHERE token_hash IN (
           SELECT token_hash FROM refresh_tokens 
           WHERE address = $1 
           ORDER BY created_at ASC 
           LIMIT $2
         )`,
        [address.toLowerCase(), count - 4]
      );
    }
  } catch (err) {
    console.error("Error limiting refresh tokens:", err.message);
  }
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Handle connection-time auth token if passed
  const token = socket.handshake.auth?.token;
  const address = socket.handshake.auth?.address;
  if (token && address) {
    const decoded = verifyAccessToken(token);
    if (decoded && decoded.address === address.toLowerCase()) {
      socket.address = address.toLowerCase();
      socket.join(socket.address);
      console.log(`Socket ${socket.id} pre-authenticated as ${socket.address}`);
    }
  }

  // 1. Request Challenge Event
  socket.on('requestChallenge', (callback) => {
    try {
      // Limit to 1 active challenge per socket
      if (socketChallenges.has(socket.id)) {
        return callback(socketChallenges.get(socket.id));
      }

      // Track request timestamps per socket to prevent challenge flooding
      if (!socket.challengeAttempts) socket.challengeAttempts = [];
      const now = Date.now();
      socket.challengeAttempts = socket.challengeAttempts.filter(ts => now - ts < 60000);
      if (socket.challengeAttempts.length >= 3) {
        return callback(null);
      }
      socket.challengeAttempts.push(now);

      const challenge = generateChallenge();
      socketChallenges.set(socket.id, challenge);
      
      // Automatic challenge cleanup after 5 minutes
      setTimeout(() => {
        if (socketChallenges.get(socket.id) === challenge) {
          socketChallenges.delete(socket.id);
        }
      }, 5 * 60 * 1000);

      callback(challenge);
    } catch (err) {
      console.error("Error in requestChallenge:", err.message);
      callback(null);
    }
  });

  // 2. Registration Event
  socket.on('register', async (payload, callback) => {
    try {
      const {
        address,
        username,
        identityKey,
        signedPreKey,
        preKeySignature,
        challenge,
        signature
      } = payload;

      // Validate required inputs
      if (!address || !username || !identityKey || !signedPreKey || !preKeySignature || !challenge || !signature) {
        return callback({ success: false, error: "Missing required fields in registration payload." });
      }

      // Check stored challenge
      const activeChallenge = socketChallenges.get(socket.id);
      if (!activeChallenge || activeChallenge !== challenge) {
        return callback({ success: false, error: "Invalid or expired challenge nonce." });
      }

      // Verify wallet signature
      const isSignatureValid = verifyWalletSignature(address, challenge, signature, 'registration');
      if (!isSignatureValid) {
        return callback({ success: false, error: "Wallet signature verification failed." });
      }

      // Format check username (3-20 characters, lowercase alphanumeric and underscores)
      const usernameRegex = /^[a-z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        return callback({ success: false, error: "Username must be 3-20 characters, lowercase letters, numbers, and underscores only." });
      }

      // Query database for username uniqueness
      const usernameCheck = await pool.query('SELECT address FROM users WHERE username = $1', [username]);
      if (usernameCheck.rows.length > 0) {
        return callback({ success: false, error: "Username is already registered." });
      }

      // Query database for address uniqueness
      const addressCheck = await pool.query('SELECT address FROM users WHERE address = $1', [address.toLowerCase()]);
      if (addressCheck.rows.length > 0) {
        return callback({ success: false, error: "Wallet address is already registered." });
      }

      // Insert new user into database
      const registeredAt = Date.now();
      await pool.query(
        `INSERT INTO users (address, username, identity_key, signed_pre_key, pre_key_signature, registered_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          address.toLowerCase(),
          username,
          identityKey,
          signedPreKey,
          preKeySignature,
          registeredAt
        ]
      );

      // Limit refresh tokens count before inserting
      await limitRefreshTokens(address);

      // Generate Refresh Token
      const refreshToken = generateRefreshToken();
      const refreshTokenHash = hashToken(refreshToken);
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Store hashed refresh token in db
      await pool.query(
        `INSERT INTO refresh_tokens (token_hash, address, expires_at)
         VALUES ($1, $2, $3)`,
        [
          refreshTokenHash,
          address.toLowerCase(),
          refreshExpiresAt
        ]
      );

      // Clean challenge
      socketChallenges.delete(socket.id);

      // Generate session token
      const token = generateAccessToken(address);

      callback({
        success: true,
        token,
        refreshToken,
        user: {
          address: address.toLowerCase(),
          username,
          registeredAt
        }
      });
    } catch (err) {
      console.error("Registration error:", err.stack || err);
      callback({ success: false, error: "Internal server error during registration." });
    }
  });

  // 3. Login Event
  socket.on('login', async (payload, callback) => {
    try {
      const { address, token } = payload;
      if (!address || !token) {
        return callback({ success: false, error: "Missing address or token." });
      }

      const decoded = verifyAccessToken(token);
      if (!decoded || decoded.address !== address.toLowerCase()) {
        return callback({ success: false, error: "Invalid session token." });
      }

      socket.address = address.toLowerCase();
      socket.join(socket.address);
      console.log(`Socket ${socket.id} authenticated as ${socket.address}`);

      // Retrieve username and privacy settings
      const userRes = await pool.query('SELECT username, stealth_mode, hide_wallet, bio, pfp, username_changes_count, last_username_change_at FROM users WHERE address = $1', [socket.address]);
      let bio = '';
      let pfp = null;
      let usernameChangesCount = 0;
      let lastUsernameChangeAt = null;

      if (userRes.rows.length > 0) {
        socket.username = userRes.rows[0].username;
        socket.stealthMode = userRes.rows[0].stealth_mode;
        socket.hideWallet = userRes.rows[0].hide_wallet;
        socket.bio = userRes.rows[0].bio || '';
        socket.pfp = userRes.rows[0].pfp || null;
        bio = userRes.rows[0].bio || '';
        pfp = userRes.rows[0].pfp || null;
        usernameChangesCount = userRes.rows[0].username_changes_count || 0;
        lastUsernameChangeAt = userRes.rows[0].last_username_change_at;
        
        socket.join(socket.username.toLowerCase());
        console.log(`Socket ${socket.id} joined username room: ${socket.username.toLowerCase()}`);
      }

      // Count remaining one-time pre-keys for this user
      const opkRes = await pool.query('SELECT COUNT(*) FROM one_time_keys WHERE address = $1', [socket.address]);
      const count = parseInt(opkRes.rows[0].count, 10);
      const newToken = generateAccessToken(socket.address);

      callback({
        success: true,
        opkCount: count,
        token: newToken,
        username: socket.username,
        stealthMode: !!socket.stealthMode,
        hideWallet: !!socket.hideWallet,
        bio,
        pfp,
        usernameChangesCount,
        lastUsernameChangeAt
      });
    } catch (err) {
      console.error("Login error:", err.stack || err);
      callback({ success: false, error: "Internal server error during login." });
    }
  });

  // 3b. Login with Signature Event (Restoring credentials via Web3 signature)
  socket.on('loginWithSignature', async (payload, callback) => {
    try {
      const { address, challenge, signature } = payload;
      if (!address || !challenge || !signature) {
        return callback({ success: false, error: "Missing required fields for signature login." });
      }

      // Check stored challenge
      const activeChallenge = socketChallenges.get(socket.id);
      if (!activeChallenge || activeChallenge !== challenge) {
        return callback({ success: false, error: "Invalid or expired challenge nonce." });
      }

      // Verify wallet signature using the session prefix
      const isSignatureValid = verifyWalletSignature(address, challenge, signature, 'session');
      if (!isSignatureValid) {
        return callback({ success: false, error: "Wallet signature verification failed." });
      }

      // Check if user exists in the database
      const userResult = await pool.query('SELECT address, username, stealth_mode, hide_wallet, bio, pfp, username_changes_count, last_username_change_at FROM users WHERE address = $1', [address.toLowerCase()]);
      if (userResult.rows.length === 0) {
        return callback({ success: false, error: "Wallet address is not registered yet." });
      }
      
      const user = userResult.rows[0];

      // Limit refresh tokens count before inserting
      await limitRefreshTokens(address);

      // Generate Access and Refresh Tokens
      const token = generateAccessToken(address);
      const refreshToken = generateRefreshToken();
      const refreshTokenHash = hashToken(refreshToken);
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Store hashed refresh token in db
      await pool.query(
        `INSERT INTO refresh_tokens (token_hash, address, expires_at)
         VALUES ($1, $2, $3)`,
        [
          refreshTokenHash,
          address.toLowerCase(),
          refreshExpiresAt
        ]
      );

      // Authenticate socket session
      socket.address = address.toLowerCase();
      socket.join(socket.address);
      socket.username = user.username;
      socket.stealthMode = user.stealth_mode;
      socket.hideWallet = user.hide_wallet;
      socket.bio = user.bio || '';
      socket.pfp = user.pfp || null;
      socket.join(user.username.toLowerCase());
      console.log(`Socket ${socket.id} signature-authenticated as ${socket.address} and joined username room: ${user.username.toLowerCase()}`);

      // Clean challenge
      socketChallenges.delete(socket.id);

      // Count remaining one-time pre-keys for this user
      const opkRes = await pool.query('SELECT COUNT(*) FROM one_time_keys WHERE address = $1', [socket.address]);
      const count = parseInt(opkRes.rows[0].count, 10);

      callback({
        success: true,
        token,
        refreshToken,
        username: user.username,
        opkCount: count,
        stealthMode: !!user.stealth_mode,
        hideWallet: !!user.hide_wallet,
        bio: user.bio || '',
        pfp: user.pfp || null,
        usernameChangesCount: user.username_changes_count || 0,
        lastUsernameChangeAt: user.last_username_change_at
      });
    } catch (err) {
      console.error("Login with signature error:", err.stack || err);
      callback({ success: false, error: "Internal server error during login." });
    }
  });

  // 4. Send Message Event (Milestones 4 and 5)
  socket.on('sendMessage', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }

      // Enforce rate limiting (Milestone 5 throttling)
      if (isRateLimited(socket.address)) {
        return callback({ success: false, error: "Rate limit exceeded. Maximum 20 messages per second." });
      }

      const { id, to, ciphertext, iv, dhPublic, sequenceNumber, timestamp, x3dhInfo, groupId } = payload;

      if (!id || !to || !ciphertext || !iv || !dhPublic || sequenceNumber === undefined || !timestamp) {
        return callback({ success: false, error: "Missing fields in message payload." });
      }

      // Validate ID is a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return callback({ success: false, error: "Invalid message ID format." });
      }

      // Validate timestamp is a number and is desynchronized by at most 5 minutes
      if (typeof timestamp !== 'number' || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
        return callback({ success: false, error: "Message timestamp is desynchronized." });
      }

      const recipient = to.toLowerCase();

      // Retrieve sender username, hide_wallet, bio, and pfp settings
      let senderUsername = socket.username;
      let senderHideWallet = socket.hideWallet;
      let senderBio = socket.bio;
      let senderPfp = socket.pfp;
      if (senderUsername === undefined || senderBio === undefined || senderPfp === undefined) {
        const userRes = await pool.query('SELECT username, hide_wallet, bio, pfp FROM users WHERE address = $1', [socket.address]);
        if (userRes.rows.length > 0) {
          senderUsername = userRes.rows[0].username;
          senderHideWallet = userRes.rows[0].hide_wallet;
          senderBio = userRes.rows[0].bio || '';
          senderPfp = userRes.rows[0].pfp || null;
          socket.username = senderUsername;
          socket.hideWallet = senderHideWallet;
          socket.bio = senderBio;
          socket.pfp = senderPfp;
        }
      }

      // Check if recipient 'to' is a username or address, and resolve recipientAddress
      let recipientAddress = recipient;
      if (!(recipient.startsWith('0x') && recipient.length === 42)) {
        const recRes = await pool.query('SELECT address FROM users WHERE LOWER(username) = $1', [recipient]);
        if (recRes.rows.length === 0) {
          return callback({ success: false, error: "Recipient user not found." });
        }
        recipientAddress = recRes.rows[0].address;
      }

      // Check if recipient is online (users join their username room too, so room name matches 'recipient')
      const recipientSockets = await io.in(recipient).fetchSockets();
      const isOnline = recipientSockets.length > 0;

      if (isOnline) {
        // Milestone 4: Direct Online Routing
        io.to(recipient).emit('message', {
          id,
          from: senderHideWallet ? senderUsername : socket.address,
          senderUsername,
          senderHideWallet: !!senderHideWallet,
          senderBio,
          senderPfp,
          ciphertext,
          iv,
          dhPublic,
          sequenceNumber,
          timestamp,
          x3dhInfo,
          groupId
        });
        callback({ success: true, delivered: true });
      } else {
        // Check recipient outbox quota (Milestone 5 storage quota enforcer)
        const outboxCountResult = await pool.query(
          'SELECT COUNT(*) FROM outbox WHERE recipient_address = $1',
          [recipientAddress]
        );
        const messageCount = parseInt(outboxCountResult.rows[0].count, 10);

        if (messageCount >= 1000) {
          // Enforce FIFO by deleting the oldest message
          await pool.query(
            `DELETE FROM outbox WHERE id = (
              SELECT id FROM outbox WHERE recipient_address = $1 ORDER BY timestamp ASC LIMIT 1
            )`,
            [recipientAddress]
          );
          console.log(`Outbox quota exceeded for ${recipientAddress}. Oldest message pruned (FIFO).`);
        }

        // Milestone 5: Database-First Ephemeral Outbox Commit
        await pool.query(
          `INSERT INTO outbox (id, sender_address, recipient_address, ciphertext, iv, dh_public, sequence_number, timestamp, x3dh_info, group_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            socket.address,
            recipientAddress,
            ciphertext,
            iv,
            dhPublic,
            sequenceNumber,
            timestamp,
            x3dhInfo ? JSON.stringify(x3dhInfo) : null,
            groupId || null
          ]
        );
        
        // Retrieve recipient's push token and trigger silent FCM wakeup notification
        try {
          const userRes = await pool.query(
            'SELECT push_token FROM users WHERE address = $1',
            [recipient]
          );
          if (userRes.rows.length > 0) {
            const pushToken = userRes.rows[0].push_token;
            if (pushToken) {
              // Fire-and-forget push trigger
              sendSilentPushNotification(recipient, pushToken).catch(pushErr => {
                console.error(`[PUSH] Async dispatch error for ${recipient}:`, pushErr.message);
              });
            } else {
              console.log(`[PUSH] Skip: No push token registered for recipient ${recipient}`);
            }
          }
        } catch (dbErr) {
          console.error(`[PUSH] DB query error for recipient ${recipient}:`, dbErr.message);
        }
        
        callback({ success: true, delivered: false });
      }
    } catch (err) {
      console.error("sendMessage error:", err.message);
      callback({ success: false, error: "Internal server error during message delivery." });
    }
  });

  // 5. Fetch Offline Queue Event (Milestone 6)
  socket.on('fetchOfflineQueue', async (callback) => {
    console.log(`[Server Log] fetchOfflineQueue event triggered for socket: ${socket.id}, address: ${socket.address}`);
    try {
      if (!socket.address) {
        console.log(`[Server Log] fetchOfflineQueue: No socket.address found. Returning empty array.`);
        return callback([]);
      }

      // Query database for buffered outbox packets with JOIN on users for username and privacy settings
      console.log(`[Server Log] fetchOfflineQueue: Querying outbox for ${socket.address}`);
      const result = await pool.query(
        `SELECT o.id, 
                o.sender_address AS from,
                u.username AS "senderUsername", 
                u.hide_wallet AS "senderHideWallet",
                u.bio AS "senderBio",
                u.pfp AS "senderPfp",
                o.ciphertext, o.iv, o.dh_public AS "dhPublic", 
                o.sequence_number AS "sequenceNumber", o.timestamp, 
                o.x3dh_info AS "x3dhInfo", o.group_id AS "groupId" 
         FROM outbox o
         LEFT JOIN users u ON o.sender_address = u.address
         WHERE o.recipient_address = $1 
         ORDER BY o.timestamp ASC`,
        [socket.address]
      );
      console.log(`[Server Log] fetchOfflineQueue: Query returned ${result.rows.length} rows.`);

      const rows = result.rows.map(row => {
        if (row.x3dhInfo) {
          try {
            row.x3dhInfo = JSON.parse(row.x3dhInfo);
          } catch (e) {
            console.error("Failed to parse x3dhInfo from database:", e.message);
            row.x3dhInfo = null;
          }
        }
        row.senderHideWallet = !!row.senderHideWallet;
        row.senderBio = row.senderBio || '';
        row.senderPfp = row.senderPfp || null;
        if (row.senderHideWallet) {
          row.from = row.senderUsername;
        }
        return row;
      });

      console.log(`[Server Log] fetchOfflineQueue: Invoking client callback with ${rows.length} rows.`);
      callback(rows);
      console.log(`[Server Log] fetchOfflineQueue: Client callback invoked successfully.`);
    } catch (err) {
      console.error("[Server Log] fetchOfflineQueue error:", err.message);
      callback([]);
    }
  });

  // 6. Message Acknowledgment Event (Milestone 6 Outbox Purge)
  socket.on('messageAck', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }

      const { messageIds } = payload;
      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        return callback({ success: false, error: "Missing or invalid messageIds array." });
      }

      // Query outbox before deletion to retrieve original sender and group_id
      const msgRes = await pool.query(
        'SELECT id, sender_address, group_id FROM outbox WHERE recipient_address = $1 AND id = ANY($2::uuid[])',
        [socket.address, messageIds]
      );

      // Delete acknowledged messages from outbox
      await pool.query(
        `DELETE FROM outbox 
         WHERE recipient_address = $1 AND id = ANY($2::uuid[])`,
        [socket.address, messageIds]
      );

      // Notify original senders that their messages are delivered!
      for (const row of msgRes.rows) {
        io.to(row.sender_address).emit('messageStatus', {
          messageId: row.id,
          status: 'delivered',
          recipient: socket.address,
          groupId: row.group_id
        });
      }

      callback({ success: true });
    } catch (err) {
      console.error("messageAck error:", err.message);
      callback({ success: false, error: "Internal server error during message acknowledgment." });
    }
  });

  // 7. Set Push Token Event (Milestone 10 Push Integration)
  socket.on('setPushToken', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }

      const { pushToken } = payload;
      if (!pushToken) {
        return callback({ success: false, error: "Missing pushToken." });
      }

      await pool.query(
        'UPDATE users SET push_token = $1 WHERE address = $2',
        [pushToken, socket.address]
      );

      console.log(`Push token updated for ${socket.address}: ${pushToken.slice(0, 8)}...`);
      callback({ success: true });
    } catch (err) {
      console.error("setPushToken error:", err.message);
      callback({ success: false, error: "Internal server error during push token registration." });
    }
  });

  // 8. Get Pre-Key Bundle Event (X3DH)
  socket.on('getKeyBundle', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }

      const { address } = payload;
      if (!address) {
        return callback({ success: false, error: "Missing address or username." });
      }

      // Rate limit bundle requests per (requester, target) pair to prevent OPK exhaustion
      const requester = socket.address;
      const target = address.toLowerCase();
      const rateKey = `${requester}:${target}`;
      const now = Date.now();
      const timestamps = bundleRateLimiter.get(rateKey) || [];
      const recentTimestamps = timestamps.filter(ts => now - ts < 60000);
      if (recentTimestamps.length >= 5) {
        return callback({ success: false, error: "Too many key bundle requests. Limit 5 per minute." });
      }
      recentTimestamps.push(now);
      bundleRateLimiter.set(rateKey, recentTimestamps);

      let recipient;
      let userRes;
      if (address.toLowerCase().startsWith('0x') && address.length === 42) {
        recipient = address.toLowerCase();
        userRes = await pool.query(
          `SELECT address, username, identity_key AS "identityKey", signed_pre_key AS "signedPreKey", pre_key_signature AS "preKeySignature", hide_wallet AS "hideWallet", bio, pfp
           FROM users WHERE address = $1`,
          [recipient]
        );
      } else {
        userRes = await pool.query(
          `SELECT address, username, identity_key AS "identityKey", signed_pre_key AS "signedPreKey", pre_key_signature AS "preKeySignature", hide_wallet AS "hideWallet", bio, pfp
           FROM users WHERE LOWER(username) = $1`,
          [address.toLowerCase()]
        );
        if (userRes.rows.length > 0) {
          recipient = userRes.rows[0].address;
        }
      }

      if (!userRes || userRes.rows.length === 0) {
        return callback({ success: false, error: "User not found." });
      }

      const { identityKey, signedPreKey, preKeySignature } = userRes.rows[0];

      // Fetch and consume one OPK if available
      let opk = null;
      const opkRes = await pool.query(
        `SELECT key_id, public_key FROM one_time_keys 
         WHERE address = $1 LIMIT 1`,
        [recipient]
      );

      if (opkRes.rows.length > 0) {
        opk = {
          keyId: opkRes.rows[0].key_id,
          publicKey: opkRes.rows[0].public_key
        };
        // Consume the key immediately
        await pool.query(
          'DELETE FROM one_time_keys WHERE address = $1 AND key_id = $2',
          [recipient, opk.keyId]
        );
      }

      callback({
        success: true,
        bundle: {
          identityKey,
          signedPreKey,
          preKeySignature,
          oneTimeKey: opk ? opk.publicKey : null,
          oneTimeKeyId: opk ? opk.keyId : null,
          username: userRes.rows[0].username,
          hideWallet: !!userRes.rows[0].hideWallet,
          bio: userRes.rows[0].bio || '',
          pfp: userRes.rows[0].pfp || null
        }
      });
    } catch (err) {
      console.error("getKeyBundle error:", err.message);
      callback({ success: false, error: "Internal server error during key bundle retrieval." });
    }
  });

  // 9. Upload One-Time Keys Event (OPK replenishment)
  socket.on('uploadOneTimeKeys', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }

      const { keys } = payload; // Array of { keyId, publicKey }
      if (!keys || !Array.isArray(keys)) {
        return callback({ success: false, error: "Invalid keys format." });
      }

      if (keys.length === 0) {
        return callback({ success: true });
      }

      // Build dynamic placeholders for batch insert
      const placeholders = [];
      const values = [];
      let idx = 1;

      for (const key of keys) {
        placeholders.push(`($${idx}, $${idx+1}, $${idx+2})`);
        values.push(socket.address, key.keyId, key.publicKey);
        idx += 3;
      }

      const queryText = `
        INSERT INTO one_time_keys (address, key_id, public_key)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (address, key_id) DO UPDATE SET public_key = EXCLUDED.public_key
      `;

      await pool.query(queryText, values);
      callback({ success: true });
    } catch (err) {
      console.error("uploadOneTimeKeys error:", err.message);
      callback({ success: false, error: "Internal server error during keys upload." });
    }
  });

  // Settings update event
  socket.on('updateSettings', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }
      const { stealthMode, hideWallet } = payload;
      
      await pool.query(
        'UPDATE users SET stealth_mode = $1, hide_wallet = $2 WHERE address = $3',
        [!!stealthMode, !!hideWallet, socket.address]
      );
      
      socket.stealthMode = !!stealthMode;
      socket.hideWallet = !!hideWallet;
      
      callback({ success: true });
    } catch (err) {
      console.error("Update settings error:", err.stack || err);
      callback({ success: false, error: "Internal server error." });
    }
  });

  // Profile update event (Milestone profile change with constraints)
  socket.on('updateProfile', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }
      const { username, bio, pfp, stealthMode, hideWallet } = payload;

      // Validate inputs
      if (bio !== undefined && typeof bio === 'string' && bio.length > 250) {
        return callback({ success: false, error: "Bio cannot exceed 250 characters." });
      }
      if (pfp !== undefined && pfp !== null && typeof pfp === 'string') {
        if (pfp.startsWith('data:image/')) {
          if (pfp.length > 300000) {
            return callback({ success: false, error: "Profile picture data URI cannot exceed 300KB." });
          }
        } else {
          if (pfp.length > 500) {
            return callback({ success: false, error: "Profile picture URL cannot exceed 500 characters." });
          }
          try {
            const parsed = new URL(pfp);
            if (parsed.protocol !== 'https:') {
              return callback({ success: false, error: "Profile picture must be a secure URL (https)." });
            }
          } catch {
            return callback({ success: false, error: "Invalid profile picture URL." });
          }
        }
      }

      // Fetch current user details to check constraints
      const userRes = await pool.query(
        'SELECT username, username_changes_count, last_username_change_at FROM users WHERE address = $1',
        [socket.address]
      );

      if (userRes.rows.length === 0) {
        return callback({ success: false, error: "User record not found." });
      }

      const user = userRes.rows[0];
      let newUsername = user.username;
      let changesCount = user.username_changes_count || 0;
      let lastChangeAt = user.last_username_change_at;

      // Handle username change validation and constraints
      if (username && username.trim().toLowerCase() !== user.username.toLowerCase()) {
        const trimmedUsername = username.trim().toLowerCase();

        // 1. Check max changes limit (3 total)
        if (changesCount >= 3) {
          return callback({ success: false, error: "Maximum username changes limit reached (3 changes max)." });
        }

        // 2. Check 14-day gap limit
        if (lastChangeAt) {
          const gapMs = Date.now() - Number(lastChangeAt);
          const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
          if (gapMs < fourteenDaysMs) {
            const daysLeft = Math.ceil((fourteenDaysMs - gapMs) / (24 * 60 * 60 * 1000));
            return callback({ success: false, error: `Username can only be changed once every 14 days. Please wait ${daysLeft} more day(s).` });
          }
        }

        // 3. Format check
        const usernameRegex = /^[a-z0-9_]{3,20}$/;
        if (!usernameRegex.test(trimmedUsername)) {
          return callback({ success: false, error: "Username must be 3-20 characters, lowercase alphanumeric/underscores only." });
        }

        // 4. Uniqueness check
        const uniqueCheck = await pool.query('SELECT address FROM users WHERE username = $1 AND address != $2', [trimmedUsername, socket.address]);
        if (uniqueCheck.rows.length > 0) {
          return callback({ success: false, error: "Username is already registered by another user." });
        }

        newUsername = trimmedUsername;
        changesCount += 1;
        lastChangeAt = Date.now();
      }

      // Update users database record
      await pool.query(
        `UPDATE users 
         SET username = $1, bio = $2, pfp = $3, stealth_mode = $4, hide_wallet = $5, 
             username_changes_count = $6, last_username_change_at = $7 
         WHERE address = $8`,
        [
          newUsername,
          bio !== undefined ? bio : '',
          pfp !== undefined ? pfp : null,
          stealthMode !== undefined ? !!stealthMode : !!socket.stealthMode,
          hideWallet !== undefined ? !!hideWallet : !!socket.hideWallet,
          changesCount,
          lastChangeAt,
          socket.address
        ]
      );

      // Leave old username room and join new room
      if (newUsername !== socket.username) {
        socket.leave(socket.username.toLowerCase());
        socket.username = newUsername;
        socket.join(newUsername.toLowerCase());
      }
      
      if (stealthMode !== undefined) socket.stealthMode = !!stealthMode;
      if (hideWallet !== undefined) socket.hideWallet = !!hideWallet;

      callback({
        success: true,
        username: newUsername,
        usernameChangesCount: changesCount,
        lastUsernameChangeAt: lastChangeAt
      });
    } catch (err) {
      console.error("updateProfile error:", err.stack || err);
      callback({ success: false, error: "Internal server error during profile update." });
    }
  });

  // Delete account event (Milestone peer wipe and remote delete)
  socket.on('deleteAccount', async (callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }

      console.log(`[Server] Deleting account registration for ${socket.address}`);

      // Delete from pg databases (cascade constraints will delete refresh tokens, outboxes, OPKs)
      await pool.query('DELETE FROM users WHERE address = $1', [socket.address]);

      callback({ success: true });
    } catch (err) {
      console.error("deleteAccount error:", err.stack || err);
      callback({ success: false, error: "Internal server error during account deletion." });
    }
  });

  // Read receipt socket event
  socket.on('readReceipt', async (payload, callback) => {
    try {
      if (!socket.address) {
        return callback({ success: false, error: "Authentication required." });
      }
      const { to, messageIds, groupId } = payload;
      if (!to || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0 || messageIds.length > 100) {
        return callback({ success: false, error: "Invalid read receipt payload. Limit 100 message IDs." });
      }

      const recipient = to.toLowerCase();

      // Resolve recipient username to address if needed
      let recipientAddress = recipient;
      if (!(recipient.startsWith('0x') && recipient.length === 42)) {
        const recRes = await pool.query('SELECT address FROM users WHERE LOWER(username) = $1', [recipient]);
        if (recRes.rows.length > 0) {
          recipientAddress = recRes.rows[0].address;
        }
      }

      // Check if recipient is online
      const recipientSockets = await io.in(recipient).fetchSockets();
      const isOnline = recipientSockets.length > 0;

      if (isOnline) {
        io.to(recipient).emit('readReceipt', {
          from: socket.address,
          messageIds,
          groupId
        });
      } else {
        // Enqueue read receipt in the outbox queue
        const crypto = require('crypto');
        await pool.query(
          `INSERT INTO outbox (id, sender_address, recipient_address, ciphertext, iv, dh_public, sequence_number, timestamp, x3dh_info, group_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            crypto.randomUUID(),
            socket.address,
            recipientAddress,
            JSON.stringify({ messageIds, groupId }),
            'N/A',
            'read_receipt',
            0,
            Date.now(),
            null,
            groupId || null
          ]
        );
      }

      if (callback) callback({ success: true });
    } catch (err) {
      console.error("readReceipt error:", err.stack || err);
      if (callback) callback({ success: false, error: "Internal server error." });
    }
  });

  socket.on('disconnect', () => {
    socketChallenges.delete(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Check if wallet address is registered
app.get('/users/exists/:address', async (req, res) => {
  console.log(`[Server] GET /users/exists/${req.params.address} received`);
  try {
    const { address } = req.params;
    if (!address) {
      console.log(`[Server] GET /users/exists/ failed: missing address`);
      return res.status(400).json({ error: "Missing address parameter." });
    }

    const addressRegex = /^0x[0-9a-f]{40}$/i;
    if (!addressRegex.test(address)) {
      return res.status(400).json({ error: "Invalid address format." });
    }

    console.log(`[Server] Querying database for address: ${address.toLowerCase()}`);
    const result = await pool.query('SELECT address FROM users WHERE address = $1', [address.toLowerCase()]);
    console.log(`[Server] Database query completed. Result count: ${result.rows ? result.rows.length : 0}`);
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error("Check exists error:", err.stack || err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Search user by username with privacy masking
app.get('/users/search/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      return res.status(400).json({ error: "Missing username parameter." });
    }

    const usernameRegex = /^[a-z0-9_]{3,20}$/i;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: "Invalid username format." });
    }

    const result = await pool.query(
      'SELECT address, username, stealth_mode, hide_wallet, bio, pfp, registered_at FROM users WHERE LOWER(username) = $1',
      [username.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = result.rows[0];

    // If stealth mode is active, completely hide user from directory search
    if (user.stealth_mode) {
      return res.status(404).json({ error: "User not found." });
    }

    // Privacy masking: if hide_wallet is true, do not return actual address
    res.json({
      success: true,
      username: user.username,
      address: user.hide_wallet ? null : user.address,
      hide_wallet: !!user.hide_wallet,
      bio: user.bio || '',
      pfp: user.pfp || null,
      registeredAt: Number(user.registered_at)
    });
  } catch (err) {
    console.error("Search user error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Batch get user profiles
app.post('/users/profiles', async (req, res) => {
  try {
    const { identifiers } = req.body;
    if (!identifiers || !Array.isArray(identifiers)) {
      return res.status(400).json({ error: "Missing or invalid identifiers parameter." });
    }

    if (identifiers.length > 100) {
      return res.status(400).json({ error: "Too many identifiers. Limit is 100." });
    }

    if (identifiers.length === 0) {
      return res.json({ success: true, profiles: {} });
    }

    const addressRegex = /^0x[0-9a-f]{40}$/i;
    const usernameRegex = /^[a-z0-9_]{3,20}$/i;

    const lowerIdentifiers = identifiers.map(id => id.toLowerCase());
    
    // Validate each identifier format
    for (const id of lowerIdentifiers) {
      if (!addressRegex.test(id) && !usernameRegex.test(id)) {
        return res.status(400).json({ error: `Invalid identifier format: ${id}` });
      }
    }

    // Query users by address or username
    const result = await pool.query(
      `SELECT address, username, stealth_mode, hide_wallet, bio, pfp FROM users 
       WHERE LOWER(address) = ANY($1) OR LOWER(username) = ANY($1)`,
      [lowerIdentifiers]
    );

    const profiles = {};
    result.rows.forEach(user => {
      if (!user.stealth_mode) {
        const profile = {
          username: user.username,
          address: user.hide_wallet ? null : user.address,
          hide_wallet: !!user.hide_wallet,
          bio: user.bio || '',
          pfp: user.pfp || null
        };
        // Map by both address and username in lowercase
        profiles[user.address.toLowerCase()] = profile;
        profiles[user.username.toLowerCase()] = profile;
      }
    });

    res.json({
      success: true,
      profiles
    });
  } catch (err) {
    console.error("Batch get user profiles error:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Token refresh endpoint
app.post('/refresh', async (req, res) => {
  try {
    const { address, refreshToken } = req.body;

    if (!address || !refreshToken) {
      return res.status(400).json({ error: "Missing address or refreshToken in request body." });
    }

    const hashedInputToken = hashToken(refreshToken);

    // Query for valid, unexpired refresh tokens for this user
    const tokenQueryResult = await pool.query(
      `SELECT token_hash, expires_at FROM refresh_tokens 
       WHERE address = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [address.toLowerCase()]
    );

    let tokenMatch = false;
    for (const row of tokenQueryResult.rows) {
      try {
        const bufA = Buffer.from(row.token_hash, 'hex');
        const bufB = Buffer.from(hashedInputToken, 'hex');
        if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
          tokenMatch = true;
          break;
        }
      } catch (e) {
        // ignore errors from malformed hashes
      }
    }

    if (!tokenMatch) {
      return res.status(401).json({ error: "Invalid or expired refresh token." });
    }

    // Refresh successful: Rotate refresh tokens
    // 1. Delete the old token
    await pool.query(
      `DELETE FROM refresh_tokens WHERE token_hash = $1`,
      [hashedInputToken]
    );

    // Limit active refresh tokens count before inserting new one
    await limitRefreshTokens(address);

    // 2. Generate a new pair
    const newAccessToken = generateAccessToken(address);
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // 3. Store the new token hash
    await pool.query(
      `INSERT INTO refresh_tokens (token_hash, address, expires_at)
       VALUES ($1, $2, $3)`,
      [newRefreshTokenHash, address.toLowerCase(), newExpiresAt]
    );

    res.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (err) {
    console.error("Refresh error:", err.message);
    res.status(500).json({ error: "Internal server error during token refresh." });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/users/') || req.path.startsWith('/refresh')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = {
  server,
  io
};
