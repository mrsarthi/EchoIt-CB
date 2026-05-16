// DecentraChat Signaling Server
// Handles: WebRTC signaling, presence, offline message store-and-forward
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { ethers } = require('ethers');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const path = require('path');
const admin = require('firebase-admin');
const sqlite3 = require('sqlite3').verbose();

// ===== Registration Challenge Setup =====
const pendingChallenges = new Map(); // socket.id -> { challenge, timestamp }
const CHALLENGE_TIMEOUT = 60000; // 60 seconds
const GRACE_PERIOD_ENABLED = true; // Set to false to force hard-enforcement

// ===== SQLite Database Setup =====
const dbPath = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

// Create users table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        address TEXT PRIMARY KEY,
        username TEXT,
        public_key TEXT,
        avatar TEXT,
        status TEXT,
        registered_at INTEGER
    )`);
    // Create index for fast, case-insensitive username lookups
    db.run(`CREATE INDEX IF NOT EXISTS idx_username ON users (username)`);

    // NEW: Persistent DM history table
    db.run(`CREATE TABLE IF NOT EXISTS history (
        id          TEXT PRIMARY KEY,
        conv_id     TEXT NOT NULL,
        from_addr   TEXT NOT NULL,
        to_addr     TEXT NOT NULL,
        payload     TEXT NOT NULL,
        timestamp   INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_history_conv ON history (conv_id, timestamp)`);

    // --- TASK 6: Server-Side Group Registry Tables ---
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        avatar      TEXT,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id      TEXT NOT NULL,
        user_address  TEXT NOT NULL,
        is_admin      INTEGER DEFAULT 0,
        joined_at     INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_address),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_address)`);

    // --- TASK 11: Unified Group Sync Protocol ---
    db.run(`CREATE TABLE IF NOT EXISTS group_history (
        sequence_no INTEGER PRIMARY KEY AUTOINCREMENT,
        id          TEXT UNIQUE NOT NULL,
        group_id    TEXT NOT NULL,
        from_addr   TEXT NOT NULL,
        payload     TEXT NOT NULL,
        timestamp   INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_group_history_id ON group_history (group_id, sequence_no)`);

    // --- TASK 12: Double Ratchet Pre-Keys ---
    db.run(`CREATE TABLE IF NOT EXISTS pre_keys (
        address     TEXT NOT NULL,
        key_id      INTEGER NOT NULL,
        public_key  TEXT NOT NULL,
        signature   TEXT,
        PRIMARY KEY (address, key_id)
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_pre_keys_addr ON pre_keys (address)`);
});

// Initialize Firebase Admin for Push Notifications
let fcmReady = false;
try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Support for Render/Production environments via Environment Variable
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        // Local development fallback
        serviceAccount = require('./serviceAccountKey.json');
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        fcmReady = true;
        console.log('[Firebase] Push notifications initialized successfully.');
    }
} catch (err) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.error('[Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT environment variable:', err.message);
    } else {
        console.warn('[Firebase] Warning: serviceAccountKey.json not found or invalid. Push notifications are disabled.');
    }
}

// Helper: Send Push Notification
async function pushOfflineNotification(toAddress, payload, type) {
    if (!fcmReady) return;
    const user = users.get(toAddress.toLowerCase());
    if (user && user.pushToken) {
        try {
            let title = 'DecentraChat';
            let body = 'You have a new notification';

            const senderName = users.get(payload.from)?.username || payload.from.slice(0, 6);

            if (type === 'dm') {
                title = `New message from ${senderName}`;
                body = 'Sent you a message'; // Keep content private in notifications
            } else if (type === 'group') {
                title = `New group message`;
                body = `${senderName} sent a message`;
            } else if (type === 'reaction') {
                title = `New reaction`;
                body = `${senderName} reacted to a message`;
            } else if (type === 'groupCreated') {
                title = `Added to a group`;
                body = `${senderName} added you to a group`;
            }

            await admin.messaging().send({
                token: user.pushToken,
                notification: { title, body },
                android: { priority: 'high' }
            });
            console.log(`[Firebase] Push sent to ${toAddress.slice(0, 8)}`);
        } catch (err) {
            console.error('[Firebase] Failed to send push:', err.message);
        }
    }
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static Auth Page for Mobile Deep Linking
app.use(express.static(path.join(__dirname, 'public')));

// Root route for health checks and "waking up" the server
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        service: 'DecentraChat Signaling Server',
        timestamp: Date.now() 
    });
});

// --- TASK 7: WebRTC TURN Infrastructure ---
app.get('/api/turn', async (req, res) => {
    // If TURN_API_KEY is missing, we fallback to public STUN only
    if (!process.env.TURN_API_KEY) {
        return res.json([
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]);
    }

    try {
        // Fetch ephemeral credentials from Metered.ca (or your provider of choice)
        // Note: Using global fetch (Node 18+)
        const response = await fetch(`https://decentrachat.metered.ca/api/v1/turn/credentials?apiKey=${process.env.TURN_API_KEY}`);
        const iceServers = await response.json();
        
        console.log('[📡] Dispatched ephemeral TURN credentials');
        res.json(iceServers);
    } catch (err) {
        console.error('[📡] Failed to fetch TURN credentials:', err.message);
        // Fallback to STUN if provider is down
        res.json([
            { urls: 'stun:stun.l.google.com:19302' }
        ]);
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true, // Dynamically allow the origin
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["*"]
    },
    allowEIO3: true // Support older clients if necessary
});

// In-memory stores (use Redis/SQLite for production persistence)
const users = new Map(); // address -> { socketId, publicKey, online, username }
const fs = require('fs');

const usernames = new Map(); // username -> address (for lookup)



// ===== User Metadata Persistence (registeredAt) =====
const USERS_META_PATH = path.join(__dirname, 'users_meta.json');
let usersMeta = new Map(); // address -> { registeredAt }

try {
    if (fs.existsSync(USERS_META_PATH)) {
        const data = fs.readFileSync(USERS_META_PATH, 'utf8');
        const parsed = JSON.parse(data);
        for (const address in parsed) {
            usersMeta.set(address, parsed[address]);
        }
        console.log(`[🆔] Loaded user metadata for ${Object.keys(parsed).length} users from disk.`);
    }
} catch (err) {
    console.error('[🆔] Error loading users_meta.json:', err);
}

let metaSaveTimeout = null;
function saveUsersMeta() {
    if (metaSaveTimeout) clearTimeout(metaSaveTimeout);
    metaSaveTimeout = setTimeout(() => {
        const obj = {};
        for (const [address, meta] of usersMeta.entries()) {
            obj[address] = meta;
        }
        fs.writeFile(USERS_META_PATH, JSON.stringify(obj), 'utf8', (err) => {
            if (err) console.error('[🆔] Error saving users_meta.json:', err);
        });
    }, 500);
}

// Offline Messages setup with File Persistence
const OFFLINE_DB_PATH = path.join(__dirname, 'offline_messages.json');
let offlineMessages = new Map(); // address -> [messages]

try {
    if (fs.existsSync(OFFLINE_DB_PATH)) {
        const data = fs.readFileSync(OFFLINE_DB_PATH, 'utf8');
        const parsed = JSON.parse(data);
        for (const address in parsed) {
            offlineMessages.set(address, parsed[address]);
        }
        console.log(`[📦] Loaded offline messages for ${Object.keys(parsed).length} users from disk.`);
    }
} catch (err) {
    console.error('[📦] Error loading offline_messages.json:', err);
}

let dbSaveTimeout = null;
function saveOfflineMessagesDb() {
    if (dbSaveTimeout) clearTimeout(dbSaveTimeout);
    dbSaveTimeout = setTimeout(() => {
        const obj = {};
        for (const [address, msgs] of offlineMessages.entries()) {
            if (msgs.length > 0) {
                obj[address] = msgs;
            }
        }
        fs.writeFile(OFFLINE_DB_PATH, JSON.stringify(obj), 'utf8', (err) => {
            if (err) console.error('[📦] Error saving offline_messages.json:', err);
        });
    }, 500); // Debounce saves by 500ms
}
const peerConnections = new Map(); // peerId -> { from, to }
const authResults = new Map(); // sessionId -> { address, signature, timestamp }

// Cleanup expired auth results periodically (every hour)
setInterval(() => {
    const now = Date.now();
    for (const [sid, result] of authResults.entries()) {
        if (now - result.timestamp > 1000 * 60 * 10) { // 10 minute expiry
            authResults.delete(sid);
        }
    }
}, 1000 * 60 * 60);

// Helper: Get conversation ID (consistent ordering)
function getConversationId(addr1, addr2) {
    const sorted = [addr1.toLowerCase(), addr2.toLowerCase()].sort();
    return `${sorted[0]}_${sorted[1]}`;
}

// Helper: Store message in history (DMs only — group messages are handled separately)
function storeMessage(msg) {
    if (msg.groupId) return; // Group messages skip history

    const convId = getConversationId(msg.from, msg.to);
    const payload = JSON.stringify(msg);

    db.run(
        `INSERT OR IGNORE INTO history (id, conv_id, from_addr, to_addr, payload, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [msg.id, convId, msg.from.toLowerCase(), msg.to.toLowerCase(), payload, msg.timestamp || Date.now()],
        (err) => { if (err) console.error('[📜] Failed to store history:', err.message); }
    );

    // Enforce the 100-message cap per conversation by pruning old entries
    db.run(
        `DELETE FROM history WHERE conv_id = ? AND id NOT IN (
            SELECT id FROM history WHERE conv_id = ? ORDER BY timestamp DESC LIMIT 100
        )`,
        [convId, convId]
    );
}

// Health check endpoint
app.get('/', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM history`, [], (err, row) => {
        res.json({
            status: 'ok',
            service: 'DecentraChat Signaling Server',
            users: users.size,
            conversations: row?.count || 0,
            pendingMessages: [...offlineMessages.values()].flat().length
        });
    });
});

// Authentication Callback from Web (used for Mobile Deep-link bypass)
app.post('/api/auth/callback', (req, res) => {
    const { sessionId, address, signature } = req.body;
    if (!sessionId || !address || !signature) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    // 🛡️ TASK 4: Verify the signature matches the address BEFORE relaying it
    try {
        const expectedMessage = `Authorize DecentraChat Auth: ${sessionId}`;
        const recovered = ethers.verifyMessage(expectedMessage, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
            console.warn(`[⚠️] Auth Relay REJECTED: Address mismatch for session ${sessionId}`);
            return res.status(403).json({ error: 'Signature does not match address' });
        }
    } catch (err) {
        console.error(`[❌] Auth Relay ERROR: Invalid signature:`, err.message);
        return res.status(400).json({ error: 'Invalid signature format' });
    }

    console.log(`[🔐] Auth Callback verified for session: ${sessionId}`);

    // Buffer the result so it survives app re-connections
    authResults.set(sessionId, { address, signature, timestamp: Date.now() });

    // Also broadcast to any currently active listeners
    io.to(`auth_${sessionId}`).emit('wallet_auth_result', { address, signature });

    const clients = io.sockets.adapter.rooms.get(`auth_${sessionId}`);
    console.log(`[📡] Relayed to session ${sessionId}. Clients currently in room: ${clients ? clients.size : 0}`);

    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log(`[+] Client connected: ${socket.id}`);

    // For off-band wallet auth relay
    socket.on('join_auth_room', ({ sessionId }) => {
        socket.join(`auth_${sessionId}`);
        console.log(`[+] Socket ${socket.id} joining auth room: ${sessionId}`);

        // If we already have a buffered result, deliver it immediately!
        const bufferedResult = authResults.get(sessionId);
        if (bufferedResult) {
            console.log(`[✅] Delivering buffered auth result for session: ${sessionId}`);
            socket.emit('wallet_auth_result', {
                address: bufferedResult.address,
                signature: bufferedResult.signature
            });
            // Optional: delete after delivery, but keeping it for 10 mins is safer if multiple retries happen
        }
    });

    socket.on('leave_auth_room', ({ sessionId }) => {
        socket.leave(`auth_${sessionId}`);
    });

    // --- TASK 1: Registration Lock Implementation ---
    socket.on('requestChallenge', (callback) => {
        const challenge = crypto.randomBytes(32).toString('hex');
        pendingChallenges.set(socket.id, { challenge, timestamp: Date.now() });

        // Auto-cleanup after timeout
        setTimeout(() => {
            if (pendingChallenges.has(socket.id)) {
                pendingChallenges.delete(socket.id);
            }
        }, CHALLENGE_TIMEOUT);

        callback(challenge);
        console.log(`[🔐] Challenge generated for socket: ${socket.id.slice(0, 8)}`);
    });

    socket.on('register', async ({ address, publicKey, username, avatar, status, registeredAt, challenge, signature }) => {
        const normalizedAddress = address.toLowerCase();

        // 1. Verify Cryptographic Signature (Registration Lock)
        const pending = pendingChallenges.get(socket.id);

        if (challenge && signature) {
            // Case A: Client provided challenge + signature (Modern Flow)
            if (!pending || pending.challenge !== challenge) {
                console.warn(`[❌] Registration REJECTED for ${normalizedAddress.slice(0, 8)}: Invalid or expired challenge.`);
                return socket.emit('registrationError', { error: 'Invalid or expired challenge. Please try again.' });
            }

            try {
                const expectedMessage = `Authorize DecentraChat Registration: ${challenge}`;
                const recoveredAddress = ethers.verifyMessage(expectedMessage, signature);

                if (recoveredAddress.toLowerCase() !== normalizedAddress) {
                    console.error(`[❌] Registration REJECTED: Address mismatch. Claimed: ${normalizedAddress}, Recovered: ${recoveredAddress.toLowerCase()}`);
                    return socket.emit('registrationError', { error: 'Cryptographic verification failed: Address mismatch.' });
                }

                console.log(`[🛡️] Cryptographic verification PASSED for ${normalizedAddress.slice(0, 8)}`);
                pendingChallenges.delete(socket.id); // Success! Consume the challenge.
            } catch (err) {
                console.error(`[❌] Registration REJECTED: Recovery error:`, err.message);
                return socket.emit('registrationError', { error: 'Cryptographic verification failed: Recovery error.' });
            }
        } else if (GRACE_PERIOD_ENABLED) {
            // Case B: Client did NOT provide signature (Legacy Flow - Grace Period)
            console.warn(`[⚠️] Legacy registration for ${normalizedAddress.slice(0, 8)}: No signature provided. ALLOWED (Grace Period).`);
        } else {
            // Case C: Client did NOT provide signature (Hard Enforcement)
            console.error(`[❌] Registration REJECTED: Missing signature (Hard Enforcement).`);
            return socket.emit('registrationError', { error: 'Signature required for registration.' });
        }

        // --- Proceed with standard registration logic ---

        // 2. Get existing info (prefer existing DB data)
        const dbUser = await new Promise(resolve => {
            db.get(`SELECT * FROM users WHERE address = ?`, [normalizedAddress], (err, row) => resolve(row));
        });

        const finalUsername = dbUser?.username || username;
        const finalAvatar = avatar !== undefined ? avatar : dbUser?.avatar;
        const finalStatus = status !== undefined ? status : dbUser?.status;
        const finalRegisteredAt = dbUser?.registered_at || (registeredAt || Date.now());

        // 2. Persist to SQLite
        db.run(`INSERT OR REPLACE INTO users (address, username, public_key, avatar, status, registered_at) 
                VALUES (?, ?, ?, ?, ?, ?)`, 
                [normalizedAddress, finalUsername, publicKey, finalAvatar, finalStatus, finalRegisteredAt]);

        // Store user info in memory for presence
        users.set(normalizedAddress, {
            socketId: socket.id,
            publicKey,
            online: true,
            lastSeen: Date.now(),
            username: finalUsername,
            avatar: finalAvatar,
            status: finalStatus,
            registeredAt: finalRegisteredAt
        });

        // Also add to usernames lookup map if username exists
        if (finalUsername) {
            usernames.set(finalUsername.toLowerCase(), normalizedAddress);
        }

        socket.address = normalizedAddress;
        socket.join(normalizedAddress);

        console.log(`[✓] Registered: ${normalizedAddress.slice(0, 10)}...${finalUsername ? ` (@${finalUsername})` : ''}`);

        // Notify sender about successful registration FIRST
        socket.emit('registered', {
            address: normalizedAddress,
            publicKey,
            username: finalUsername,
            registeredAt: finalRegisteredAt
        });

        // Broadcast online status to everyone else
        socket.broadcast.emit('userStatus', {
            address: normalizedAddress,
            online: true,
            lastSeen: Date.now(),
            avatar: finalAvatar,
            status: finalStatus
        });
    });

    socket.on('fetchOfflineMessages', () => {
        if (!socket.address) return;
        const pending = offlineMessages.get(socket.address) || [];
        if (pending.length > 0) {
            console.log(`[→] Delivering ${pending.length} offline messages to ${socket.address.slice(0, 10)}...`);
            pending.forEach(msg => {
                if (msg._isReaction) {
                    socket.emit('messageReaction', msg);
                } else if (msg._isGroupCreated) {
                    socket.emit('groupCreated', msg);
                } else if (msg._isGroupDeleted) {
                    socket.emit('groupDeleted', msg);
                } else if (msg._isGroupAvatarUpdate) {
                    socket.emit('groupAvatarUpdated', msg);
                } else if (msg._isGroupMessage) {
                    socket.emit('groupMessage', msg);
                } else {
                    socket.emit('message', msg);
                }
            });
            // DO NOT DELETE here. Wait for ACK from client.
        }
    });

    socket.on('ackOfflineMessages', ({ messageIds }) => {
        if (!socket.address || !Array.isArray(messageIds) || messageIds.length === 0) return;

        const pending = offlineMessages.get(socket.address) || [];
        const originalLength = pending.length;

        // Filter out the messages that the client successfully acknowledged
        const remaining = pending.filter(msg => !messageIds.includes(msg.id || msg.messageId));

        if (remaining.length === 0) {
            offlineMessages.delete(socket.address);
        } else {
            offlineMessages.set(socket.address, remaining);
        }

        saveOfflineMessagesDb();
        console.log(`[✔️] Client ${socket.address.slice(0, 6)} ACKed ${originalLength - remaining.length} messages. ${remaining.length} remaining.`);
    });

    socket.on('updateProfile', ({ avatar, status }) => {
        if (!socket.address) return;
        const address = socket.address;
        const user = users.get(address);
        if (user) {
            if (avatar !== undefined) user.avatar = avatar;
            if (status !== undefined) user.status = status;
            users.set(address, user);

            // Broadcast the profile update to everyone
            socket.broadcast.emit('userStatus', {
                address: address,
                online: true,
                lastSeen: user.lastSeen || Date.now(),
                avatar: user.avatar,
                status: user.status
            });
        }
    });

    socket.on('updatePushToken', ({ token }) => {
        if (!socket.address) return;
        const user = users.get(socket.address);
        if (user) {
            user.pushToken = token;
            users.set(socket.address, user);
            console.log(`📱 Push token updated for ${socket.address.slice(0, 8)}: ${token.slice(0, 10)}...`);
        }
    });

    // Set username for a user
    socket.on('setUsername', async ({ username }, callback) => {
        if (!socket.address) {
            callback({ success: false, error: 'Not registered' });
            return;
        }

        const normalizedUsername = username.toLowerCase().trim();

        // Validate username
        if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
            callback({ success: false, error: 'Username must be 3-20 characters' });
            return;
        }
        if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
            callback({ success: false, error: 'Username can only contain letters, numbers, and underscores' });
            return;
        }

        try {
            // 1. Verify database-level uniqueness (critical for accuracy across server reboots)
            const existingOwner = await new Promise((resolve, reject) => {
                db.get(`SELECT address FROM users WHERE LOWER(username) = ?`, [normalizedUsername], (err, row) => {
                    if (err) return reject(err);
                    resolve(row ? row.address : null);
                });
            });

            if (existingOwner && existingOwner.toLowerCase() !== socket.address.toLowerCase()) {
                callback({ success: false, error: 'Username already taken' });
                return;
            }

            // 2. Persist new username setting directly to SQLite source-of-truth
            await new Promise((resolve, reject) => {
                db.run(`UPDATE users SET username = ? WHERE address = ?`, [username, socket.address], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            // 3. Remove old mappings in-memory if necessary
            const user = users.get(socket.address);
            if (user?.username) {
                usernames.delete(user.username.toLowerCase());
            }

            // 4. Commit to memory stores for quick presence lookups
            usernames.set(normalizedUsername, socket.address);
            if (user) {
                user.username = username;
                users.set(socket.address, user);
            }

            console.log(`[@] Username persisted & set: ${socket.address.slice(0, 10)}... -> @${username}`);
            callback({ success: true, username });

        } catch (err) {
            console.error('[@] Failed to save username to DB:', err.message);
            callback({ success: false, error: 'Internal server error' });
        }
    });

    // Lookup user by username
    socket.on('lookupByUsername', ({ username }, callback) => {
        const normalizedUsername = username.toLowerCase().trim().replace('@', '');
        
        // 1. Quick Check: check memory first (online users)
        const address = usernames.get(normalizedUsername);
        if (address) {
            const user = users.get(address);
            callback({
                address,
                username: user?.username,
                publicKey: user?.publicKey,
                online: user?.online || false
            });
            return;
        }

        // 2. Database Fallback: Check SQLite (for offline user discovery)
        db.get(`SELECT * FROM users WHERE LOWER(username) = ?`, [normalizedUsername], (err, row) => {
            if (err || !row) {
                callback(null);
                return;
            }
            callback({
                address: row.address,
                username: row.username,
                publicKey: row.public_key,
                online: false // Offline if not in-memory Map
            });
        });
    });

    // Get user's public key
    socket.on('getPublicKey', ({ address }, callback) => {
        const user = users.get(address.toLowerCase());
        callback(user ? { publicKey: user.publicKey, online: user.online } : null);
    });

    // --- TASK 9: Media Relay Authorization ---
    socket.on('getUploadToken', (callback) => {
        if (!socket.address) return callback({ error: 'Not registered' });

        const secret = process.env.MEDIA_RELAY_SECRET || 'decentrachat-media-relay-secret-default-change-me';
        const token = jwt.sign({
            address: socket.address,
            exp: Math.floor(Date.now() / 1000) + (60 * 5) // 5 minute expiry
        }, secret);

        console.log(`[🖼️] Upload token generated for ${socket.address.slice(0, 8)}`);
        callback({ token });
    });



    // --- TASK 12: Double Ratchet Pre-Keys ---
    socket.on('uploadPreKeys', ({ preKeys }) => {
        if (!socket.address || !Array.isArray(preKeys)) return;

        db.serialize(() => {
            preKeys.forEach(pk => {
                db.run(
                    `INSERT OR REPLACE INTO pre_keys (address, key_id, public_key, signature) VALUES (?, ?, ?, ?)`,
                    [socket.address.toLowerCase(), pk.keyId, pk.publicKey, pk.signature || null]
                );
            });
        });
        console.log(`[🔐] ${preKeys.length} pre-keys uploaded for ${socket.address.slice(0, 8)}`);
    });

    socket.on('fetchPreKey', ({ address }, callback) => {
        if (!address) return callback(null);
        const targetAddr = address.toLowerCase();

        // Get one random pre-key and DELETE it (consume)
        db.get(
            `SELECT key_id, public_key, signature FROM pre_keys WHERE address = ? ORDER BY RANDOM() LIMIT 1`,
            [targetAddr],
            (err, row) => {
                if (err || !row) {
                    console.log(`[🔐] No pre-keys available for ${targetAddr.slice(0, 8)}`);
                    return callback(null);
                }

                // Delete the key so it's one-time use
                db.run(`DELETE FROM pre_keys WHERE address = ? AND key_id = ?`, [targetAddr, row.key_id]);
                
                console.log(`[🔐] Pre-key fetched and consumed for ${targetAddr.slice(0, 8)}`);
                callback({
                    keyId: row.key_id,
                    publicKey: row.public_key,
                    signature: row.signature
                });
            }
        );
    });

    // WebRTC Signaling: Offer
    socket.on('signal', ({ to, signal }) => {
        const toAddress = to.toLowerCase();
        const recipient = users.get(toAddress);

        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('signal', {
                from: socket.address,
                signal
            });
        }
    });

    // --- TASK 11: Unified Group Sync Protocol ---
    socket.on('getGroupHistory', ({ groupId, lastSequenceNo }, callback) => {
        if (!socket.address || !groupId) return callback([]);

        // Verify membership before returning history (Task 6 Registry check)
        db.get(
            `SELECT 1 FROM group_members WHERE group_id = ? AND user_address = ?`,
            [groupId, socket.address.toLowerCase()],
            (err, row) => {
                if (!row) {
                    console.warn(`[🛡️] History REJECTED for ${socket.address.slice(0, 8)}: Not a member of ${groupId.slice(0, 8)}`);
                    return callback([]);
                }

                db.all(
                    `SELECT payload, sequence_no FROM group_history 
                     WHERE group_id = ? AND sequence_no > ? 
                     ORDER BY sequence_no ASC LIMIT 50`,
                    [groupId, lastSequenceNo || 0],
                    (err, rows) => {
                        if (err) {
                            console.error('[📜] Failed to retrieve group history:', err.message);
                            return callback([]);
                        }
                        
                        const messages = rows.map(r => {
                            try { 
                                const msg = JSON.parse(r.payload);
                                msg.sequence_no = r.sequence_no; // Attach seq for client tracking
                                return msg;
                            } catch { return null; }
                        }).filter(Boolean);

                        console.log(`[📜] Synced ${messages.length} group messages for ${groupId.slice(0, 8)}`);
                        callback(messages);
                    }
                );
            }
        );
    });

    // Send encrypted message
    socket.on('sendMessage', (messageData) => {
        const { to, ...rest } = messageData;
        const toAddress = to.toLowerCase();
        const recipient = users.get(toAddress);

        const fullMessage = {
            ...rest,
            to: toAddress,
            from: socket.address,
            timestamp: Date.now(),
            id: rest.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        // Store in history (always, for both parties to fetch later)
        storeMessage(fullMessage);

        if (recipient && recipient.online) {
            // Deliver immediately
            io.to(recipient.socketId).emit('message', fullMessage);
            socket.emit('messageStatus', { id: fullMessage.id, status: 'delivered' });
            console.log(`[→] Message delivered: ${socket.address?.slice(0, 6)} → ${toAddress.slice(0, 6)}`);
        } else {
            // Store for offline delivery
            const pending = offlineMessages.get(toAddress) || [];
            pending.push(fullMessage);
            offlineMessages.set(toAddress, pending);
            saveOfflineMessagesDb();
            socket.emit('messageStatus', { id: fullMessage.id, status: 'stored' });
            console.log(`[📦] Message stored for offline: ${toAddress.slice(0, 6)}`);
            pushOfflineNotification(toAddress, fullMessage, 'dm');
        }

        // Send back to sender for confirmation
        socket.emit('messageSent', fullMessage);
    });

    // Send group message — fan out to all members, queue for offline ones
    socket.on('sendGroupMessage', (messageData) => {
        const { groupId, members, ...rest } = messageData;

        if (!Array.isArray(members) || members.length === 0) return;

        const fullMessage = {
            ...rest,
            groupId,
            from: socket.address,
            timestamp: Date.now(),
            id: rest.id || `gmsg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        let deliveredCount = 0;
        let queuedCount = 0;

        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();

            // Don't echo back to sender
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);

            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupMessage', fullMessage);
                deliveredCount++;
            } else {
                // Queue for offline delivery — same mechanism as DMs
                const pending = offlineMessages.get(toAddress) || [];
                // Tag so the client knows it's a group message on reconnect
                pending.push({ ...fullMessage, _isGroupMessage: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                queuedCount++;
                pushOfflineNotification(toAddress, fullMessage, 'group');
            }
        });

        // 🛡️ Task 11: Persist to Group History (for catch-up sync)
        db.run(
            `INSERT OR IGNORE INTO group_history (id, group_id, from_addr, payload, timestamp) VALUES (?, ?, ?, ?, ?)`,
            [fullMessage.id, groupId, socket.address.toLowerCase(), JSON.stringify(fullMessage), fullMessage.timestamp]
        );

        // Acknowledge back to sender
        socket.emit('messageSent', fullMessage);
        console.log(`[👥] Group msg ${groupId?.slice(0, 8)}: ${deliveredCount} delivered, ${queuedCount} queued, persisted to history.`);
    });

    // Check if user is online
    socket.on('checkOnline', ({ address }, callback) => {
        const user = users.get(address.toLowerCase());
        callback(user ? user.online : false);
    });

    // Get status for multiple users
    socket.on('getUsersStatus', ({ addresses }, callback) => {
        const statuses = {};
        if (Array.isArray(addresses)) {
            addresses.forEach(addr => {
                const normalized = addr.toLowerCase();
                const user = users.get(normalized);
                if (user) {
                    statuses[normalized] = {
                        online: user.online,
                        lastSeen: user.lastSeen,
                        avatar: user.avatar,
                        status: user.status
                    };
                } else {
                    statuses[normalized] = {
                        online: false,
                        lastSeen: null,
                        avatar: null,
                        status: null
                    };
                }
            });
        }
        callback(statuses);
    });

    // Get user info
    socket.on('getUser', ({ address }, callback) => {
        const user = users.get(address.toLowerCase());
        const meta = usersMeta.get(address.toLowerCase());
        if (user) {
            callback({
                address: address.toLowerCase(),
                publicKey: user.publicKey,
                online: user.online,
                lastSeen: user.lastSeen,
                avatar: user.avatar,
                status: user.status,
                registeredAt: meta?.registeredAt
            });
        } else {
            callback(null);
        }
    });

    // Get conversation history
    socket.on('getHistory', ({ peerAddress }, callback) => {
        if (!socket.address) return callback([]);

        const convId = getConversationId(socket.address, peerAddress.toLowerCase());

        db.all(
            `SELECT payload FROM history WHERE conv_id = ? ORDER BY timestamp ASC LIMIT 100`,
            [convId],
            (err, rows) => {
                if (err) {
                    console.error('[📜] Failed to retrieve history:', err.message);
                    return callback([]);
                }
                const messages = rows.map(r => {
                    try { 
                        const msg = JSON.parse(r.payload);
                        // Enrich with username if possible
                        if (!msg.senderUsername && msg.from) {
                            const sender = users.get(msg.from.toLowerCase());
                            if (sender?.username) msg.senderUsername = sender.username;
                        }
                        return msg;
                    } catch { return null; }
                }).filter(Boolean);

                console.log(`[📜] Returning ${messages.length} messages for ${convId.slice(0, 16)}`);
                callback(messages);
            }
        );
    });

    // Handle message receipts (delivered/read)
    socket.on('messageReceipt', ({ messageId, to, type, chatId }) => {
        const toAddress = to.toLowerCase();
        const recipient = users.get(toAddress);

        // Update message in SQLite history
        db.get(`SELECT payload, conv_id FROM history WHERE id = ?`, [messageId], (err, row) => {
            if (row) {
                try {
                    const msg = JSON.parse(row.payload);
                    msg.status = type;
                    db.run(`UPDATE history SET payload = ? WHERE id = ?`, [JSON.stringify(msg), messageId]);
                } catch (e) {
                    console.error('[📜] Failed to update receipt in DB:', e.message);
                }
            }
        });

        // Relay receipt to sender
        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('messageReceipt', {
                messageId,
                type,
                from: socket.address,
                chatId // Propagate conversation scope back to the sender
            });
            console.log(`[✓] ${type} receipt: ${messageId.slice(0, 15)}... for chat ${chatId?.slice(0, 6)}`);
        }
    });

    // ====== GROUP LIFECYCLE EVENTS ======

    // Get all groups for the requesting user (Task 6 Registry)
    socket.on('getMyGroups', (callback) => {
        if (!socket.address) return callback([]);
        
        const address = socket.address.toLowerCase();
        
        db.all(
            `SELECT g.*, GROUP_CONCAT(m.user_address) as member_list 
             FROM groups g 
             JOIN group_members m ON g.id = m.group_id 
             WHERE g.id IN (SELECT group_id FROM group_members WHERE user_address = ?)
             GROUP BY g.id`,
            [address],
            (err, rows) => {
                if (err) {
                    console.error('[👥] Failed to fetch user groups:', err.message);
                    return callback([]);
                }
                
                const groups = rows.map(row => ({
                    address: row.id,
                    username: row.name,
                    avatar: row.avatar,
                    createdBy: row.created_by,
                    members: row.member_list.split(','),
                    isGroup: true
                }));
                
                callback(groups);
            }
        );
    });

    // Create group — fan out to all members AND persist to Registry
    socket.on('createGroup', ({ groupId, groupName, members, avatar }) => {
        if (!groupId || !Array.isArray(members) || members.length === 0) return;

        const creator = socket.address;
        const timestamp = Date.now();

        // 🛡️ Task 6: Persist Group Registry to SQLite
        db.serialize(() => {
            db.run(
                `INSERT OR IGNORE INTO groups (id, name, avatar, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
                [groupId, groupName, avatar || null, creator, timestamp]
            );

            members.forEach(memberAddr => {
                const isAdmin = memberAddr.toLowerCase() === creator.toLowerCase() ? 1 : 0;
                db.run(
                    `INSERT OR IGNORE INTO group_members (group_id, user_address, is_admin, joined_at) VALUES (?, ?, ?, ?)`,
                    [groupId, memberAddr.toLowerCase(), isAdmin, timestamp]
                );
            });
        });

        const payload = {
            id: `gc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            groupName,
            members,
            avatar,
            admins: [creator],
            createdBy: creator,
            timestamp
        };

        let deliveredCount = 0;
        let queuedCount = 0;

        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();
            if (toAddress === creator) return;

            const recipient = users.get(toAddress);
            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupCreated', payload);
                deliveredCount++;
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupCreated: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                queuedCount++;
                pushOfflineNotification(toAddress, payload, 'groupCreated');
            }
        });

        console.log(`[👥+] Group created & registered: ${groupId?.slice(0, 8)}`);
    });

    // Delete group — fan out AND remove from Registry
    socket.on('deleteGroup', ({ groupId, members }) => {
        if (!groupId) return;

        // 🛡️ Task 6: Remove from Registry
        db.run(`DELETE FROM groups WHERE id = ?`, [groupId]);
        db.run(`DELETE FROM group_members WHERE group_id = ?`, [groupId]);

        const payload = {
            id: `gd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            deletedBy: socket.address,
            timestamp: Date.now()
        };

        members?.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);
            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupDeleted', payload);
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupDeleted: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
            }
        });

        console.log(`[👥-] Group deleted & unregistered: ${groupId?.slice(0, 8)}`);
    });
    // Remove group member — fan out AND update Registry
    socket.on('removeGroupMember', ({ groupId, memberAddress, members }) => {
        if (!groupId || !memberAddress) return;

        // 🛡️ Task 6: Remove from Registry
        db.run(`DELETE FROM group_members WHERE group_id = ? AND user_address = ?`, [groupId, memberAddress.toLowerCase()]);

        const payload = {
            id: `gm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            memberAddress,
            removedBy: socket.address,
            timestamp: Date.now()
        };

        // Notify remaining members and the removed member
        const allTargets = members ? [...members, memberAddress] : [memberAddress];
        const uniqueTargets = [...new Set(allTargets)];

        uniqueTargets.forEach(addr => {
            const toAddress = addr.toLowerCase();
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);
            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupMemberRemoved', payload);
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupMemberRemoved: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
            }
        });
        
        console.log(`[👤-] Member ${memberAddress.slice(0, 8)} removed from group ${groupId?.slice(0, 8)}`);
    });

    // Update group avatar — fan out AND update Registry
    socket.on('updateGroupAvatar', ({ groupId, avatar, members }) => {
        if (!groupId) return;

        // 🛡️ Task 6: Update Registry
        db.run(`UPDATE groups SET avatar = ? WHERE id = ?`, [avatar, groupId]);

        const payload = {
            id: `ga_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            avatar,
            updatedBy: socket.address,
            timestamp: Date.now()
        };

        members?.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);
            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupAvatarUpdated', payload);
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupAvatarUpdate: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
            }
        });
    });

    // React to a message — relay to recipient(s)
    socket.on('messageReaction', (data) => {
        const { messageId, emoji, action, to, groupId, members } = data;
        if (!messageId || !emoji) return;

        const payload = {
            id: `rx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            messageId,
            emoji,
            action: action || 'add',
            from: socket.address,
            groupId: groupId || null,
            timestamp: Date.now()
        };

        // Determine targets: group → all members, DM → single recipient
        const targets = groupId && Array.isArray(members) ? members : (to ? [to] : []);

        targets.forEach(addr => {
            const toAddress = addr.toLowerCase();
            if (toAddress === socket.address) return; // Skip self

            const recipient = users.get(toAddress);

            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('messageReaction', payload);
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isReaction: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                pushOfflineNotification(toAddress, payload, 'reaction');
            }
        });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        // Clean up any pending challenge for this socket (mid-handshake disconnect)
        if (pendingChallenges.has(socket.id)) {
            pendingChallenges.delete(socket.id);
            console.log(`[🔐] Cleaned up pending challenge for disconnected socket: ${socket.id.slice(0, 8)}`);
        }

        const address = socket.address;

        if (address) {
            const user = users.get(address);
            if (user && user.socketId === socket.id) {
                // Only mark offline if this was the active socket
                user.online = false;
                user.lastSeen = Date.now();
                users.set(address, user);

                // Broadcast offline status
                socket.broadcast.emit('userStatus', {
                    address: address,
                    online: false,
                    lastSeen: user.lastSeen
                });
                console.log(`[-] Disconnected (User Offline): ${address.slice(0, 10)}...`);
            } else {
                console.log(`[-] Disconnected (Stale Socket or Replaced): ${address.slice(0, 10)}...`);
            }
        } else {
            console.log(`[-] Disconnected (Unregistered Socket): ${socket.id}`);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 DecentraChat Signaling Server                        ║
║                                                           ║
║   Local:  http://localhost:${PORT}                         ║
║   Status: Ready for connections                           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});
