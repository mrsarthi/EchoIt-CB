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

const { argon2id } = require('hash-wasm');

// ===== Registration Challenge Setup =====
const pendingChallenges = new Map(); // socket.id -> { challenge, timestamp }
const CHALLENGE_TIMEOUT = 60000; // 60 seconds
const GRACE_PERIOD_ENABLED = false; // Hard-enforced Sybil resistance

// ===== JWT Security Config =====
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '4h'; // Short-lived VIP pass for session continuity

// ===== CORS Lockdown =====
const ALLOWED_ORIGINS = [
    'http://localhost:5173',          // Local dev
    'http://localhost:3000',          // Electron dev
    'https://decentrachat.onrender.com', // Production web
    'https://decentrachat-singnalling.onrender.com', // Signaling server (for auth.html relay)
    'capacitor://localhost',           // Capacitor Android
    'http://localhost'                 // Capacitor iOS
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS blocked: Unauthorized origin'));
        }
    },
    methods: ["GET", "POST"],
    credentials: true
};

// ===== SQLite Database Setup =====
const dbPath = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

// Create users table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        address TEXT PRIMARY KEY,
        username TEXT,
        public_key TEXT,
        signing_public_key TEXT,
        signed_pre_key TEXT,
        signed_pre_key_signature TEXT,
        avatar TEXT,
        status TEXT,
        registered_at INTEGER,
        trust_score INTEGER DEFAULT 100,
        push_token TEXT,
        os_platform TEXT
    )`);

    // Ensure columns exist for existing databases
    db.run(`ALTER TABLE users ADD COLUMN trust_score INTEGER DEFAULT 100`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN push_token TEXT`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN os_platform TEXT`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN signing_public_key TEXT`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN signed_pre_key TEXT`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN signed_pre_key_signature TEXT`, (err) => {});

    // Create index for fast, case-insensitive username lookups
    db.run(`CREATE INDEX IF NOT EXISTS idx_username ON users (username)`);

    // NEW: Verifications table for Web of Trust tracking
    db.run(`CREATE TABLE IF NOT EXISTS verifications (
        verifier TEXT NOT NULL,
        verified TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY(verifier, verified)
    )`);

    // NEW: Reports table for spam detection and reputation penalties
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        reporter TEXT NOT NULL,
        reported TEXT NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY(reporter, reported)
    )`);

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

// Helper: Send Push Notification (via Stateless Push Buffer)
async function pushOfflineNotification(toAddress, payload, type) {
    db.get(`SELECT push_token FROM users WHERE address = ?`, [toAddress.toLowerCase()], async (err, user) => {
        if (err || !user || !user.push_token) return;

        try {
            let title = 'DecentraChat';
            let body = 'You have a new notification';

            const senderAddress = payload.from?.toLowerCase();
            const senderUser = await new Promise(resolve => {
                db.get(`SELECT username FROM users WHERE address = ?`, [senderAddress], (err, row) => resolve(row));
            });
            const senderName = senderUser?.username || payload.from?.slice(0, 6);

            if (type === 'dm') {
                title = `New message from ${senderName}`;
                body = 'Sent you a message'; 
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

            // Forward to Push Buffer microservice
            const PUSH_BUFFER_URL = process.env.PUSH_BUFFER_URL || 'http://localhost:3002/push';
            const response = await fetch(PUSH_BUFFER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pushToken: user.push_token,
                    title,
                    body,
                    data: {
                        type,
                        from: payload.from,
                        groupId: payload.groupId || ''
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[Push] Buffer service error:', errorData);
                if (errorData.code === 'messaging/registration-token-not-registered') {
                    db.run(`UPDATE users SET push_token = NULL WHERE address = ?`, [toAddress.toLowerCase()]);
                }
            } else {
                console.log(`[Push] Forwarded notification to buffer for ${toAddress.slice(0, 8)}`);
            }
        } catch (err) {
            console.error('[Push] Failed to forward to buffer:', err.message);
        }
    });
}

const app = express();
app.set('trust proxy', 1); // Trust Render's reverse proxy for correct req.ip
app.use(cors(corsOptions));
app.use(express.json());

// Serve static Auth Page for Mobile Deep Linking
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        service: 'DecentraChat Signaling Server',
        timestamp: Date.now() 
    });
});

// --- Rate Limiting ---
const ipRateLimits = new Map();
function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const limit = ipRateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > limit.resetAt) {
        limit.count = 1;
        limit.resetAt = now + 60000;
    } else {
        limit.count++;
    }
    ipRateLimits.set(ip, limit);
    if (limit.count > 30) return res.status(429).json({ error: 'Too many requests' });
    next();
}

const server = http.createServer(app);
const io = new Server(server, {
    cors: corsOptions,
    allowEIO3: true 
});

// --- Socket Authentication Middleware ---
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.address = decoded.address.toLowerCase();
            return next();
        } catch (err) {
            // Token expired or invalid
        }
    }
    next();
});

const preKeyCounters = new Map();

// Helper: Require authentication for socket events
function requireAuth(socket, callback) {
    if (!socket.address) {
        if (callback) callback({ error: 'Authentication required' });
        return false;
    }
    return true;
}

app.get('/api/turn', (req, res) => {
    res.status(401).json({ error: 'Endpoint moved to socket event "fetchTurnCredentials"' });
});

const users = new Map(); 
const fs = require('fs');
const usernames = new Map(); 

const OFFLINE_DB_PATH = path.join(__dirname, 'offline_messages.json');
let offlineMessages = new Map(); 

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
    }, 500); 
}

const authResults = new Map(); 

setInterval(() => {
    const now = Date.now();
    for (const [sid, result] of authResults.entries()) {
        if (now - result.timestamp > 1000 * 60 * 10) { 
            authResults.delete(sid);
        }
    }
}, 1000 * 60 * 60);

function getTrustStage(registeredAt, trustScore) {
    const ageDays = (Date.now() - registeredAt) / (1000 * 60 * 60 * 24);
    if (ageDays >= 30 && (trustScore || 0) > 150) return 3; 
    if (ageDays >= 7 && (trustScore || 0) >= 110) return 2;  
    return 1; 
}

function incrementTrustScore(address, points) {
    db.run(`UPDATE users SET trust_score = COALESCE(trust_score, 100) + ? WHERE address = ?`, [points, address.toLowerCase()]);
}

// --- V3 Staged Privileges & Rate Limiting ---
const messageCounters = new Map(); // address -> { count, resetAt }
const groupCreationCounters = new Map(); // address -> { count, resetAt }
const strangerDMLimits = new Map(); // address -> { lastInitiatedAt, initiatedRecipients: Set }

async function checkPrivileges(address, action, toAddress = null) {
    const user = await new Promise(resolve => {
        db.get(`SELECT * FROM users WHERE address = ?`, [address.toLowerCase()], (err, row) => resolve(row));
    });
    if (!user) return { allowed: false, error: 'User not found' };

    const stage = getTrustStage(user.registered_at, user.trust_score);
    const now = Date.now();

    if (action === 'sendMessage') {
        if (stage >= 2) return { allowed: true }; // Stage 2+ unlimited
        
        // 1. General Rate Limit (10 per minute)
        const limit = messageCounters.get(address) || { count: 0, resetAt: now + 60000 };
        if (now > limit.resetAt) {
            limit.count = 1;
            limit.resetAt = now + 60000;
        } else {
            limit.count++;
        }
        messageCounters.set(address, limit);

        if (limit.count > 10) {
            return { allowed: false, error: 'Rate limit exceeded for Stage 1. Verify a contact to unlock higher limits.' };
        }

        // 2. Stranger DM Rate Limit (1 NEW stranger per hour)
        if (toAddress) {
            const normalizedTo = toAddress.toLowerCase();
            // A recipient is NOT a stranger if they have verified the sender
            const hasVerifiedMe = await new Promise(resolve => {
                db.get(`SELECT 1 FROM verifications WHERE verifier = ? AND verified = ?`, [normalizedTo, address.toLowerCase()], (err, row) => resolve(!!row));
            });

            if (!hasVerifiedMe) {
                const strangerLimit = strangerDMLimits.get(address) || { lastInitiatedAt: 0, initiatedRecipients: new Set() };
                
                // If we haven't messaged this stranger yet in this session
                if (!strangerLimit.initiatedRecipients.has(normalizedTo)) {
                    const oneHour = 60 * 60 * 1000;
                    if (now - strangerLimit.lastInitiatedAt < oneHour) {
                        return { allowed: false, error: 'Stage 1 users can only initiate 1 new DM to a stranger per hour. Get verified to unlock.' };
                    }
                    // Record the initiation
                    strangerLimit.lastInitiatedAt = now;
                    strangerLimit.initiatedRecipients.add(normalizedTo);
                    strangerDMLimits.set(address, strangerLimit);
                    console.log(`🛡️ Stage 1 DM Gating: ${address.slice(0, 10)} initiated DM to stranger ${normalizedTo.slice(0, 10)}`);
                }
            }
        }
    }

    if (action === 'createGroup') {
        if (stage === 1) {
            return { allowed: false, error: 'Stage 1 (Quarantine) users cannot create groups. Aging and verification points required.' };
        }
        if (stage >= 3) return { allowed: true }; // Stage 3 unlimited
        
        const limit = groupCreationCounters.get(address) || { count: 0, resetAt: now + (24 * 60 * 60 * 1000) };
        if (now > limit.resetAt) {
            limit.count = 1;
            limit.resetAt = now + (24 * 60 * 60 * 1000);
        } else {
            limit.count++;
        }
        groupCreationCounters.set(address, limit);

        const maxGroups = stage === 2 ? 5 : 0;
        if (limit.count > maxGroups) {
            return { allowed: false, error: `Daily group limit reached for Stage ${stage}.` };
        }
    }

    return { allowed: true };
}

app.post('/api/auth/callback', rateLimitMiddleware, (req, res) => {
    const { sessionId, address, signature } = req.body;
    if (!sessionId || !address || !signature) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const expectedMessage = `Authorize DecentraChat Auth: ${sessionId}`;
        const recovered = ethers.verifyMessage(expectedMessage, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
            return res.status(403).json({ error: 'Signature does not match address' });
        }
    } catch (err) {
        return res.status(400).json({ error: 'Invalid signature format' });
    }

    try {
        const token = jwt.sign({ address: address.toLowerCase() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        authResults.set(sessionId, { address, signature, token, timestamp: Date.now() });
        io.to(`auth_${sessionId}`).emit('wallet_auth_result', { address, signature, token });
        res.json({ success: true, token });
    } catch (err) {
        console.error("Auth Callback 500 Error:", err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

app.get('/api/auth/status/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const bufferedResult = authResults.get(sessionId);
    if (bufferedResult) {
        authResults.delete(sessionId);
        res.json({ 
            success: true, 
            data: {
                address: bufferedResult.address,
                signature: bufferedResult.signature,
                token: bufferedResult.token
            }
        });
    } else {
        res.json({ success: false });
    }
});

io.on('connection', (socket) => {
    // Re-join room if authenticated via token
    if (socket.address) {
        socket.join(socket.address);
    }

    socket.on('join_auth_room', ({ sessionId }) => {
        socket.join(`auth_${sessionId}`);
        const bufferedResult = authResults.get(sessionId);
        if (bufferedResult) {
            socket.emit('wallet_auth_result', {
                address: bufferedResult.address,
                signature: bufferedResult.signature,
                token: bufferedResult.token
            });
            authResults.delete(sessionId);
        }
    });

    socket.on('leave_auth_room', ({ sessionId }) => {
        socket.leave(`auth_${sessionId}`);
    });

    socket.on('requestChallenge', (callback) => {
        const challenge = crypto.randomBytes(32).toString('hex');
        pendingChallenges.set(socket.id, { challenge, timestamp: Date.now() });
        setTimeout(() => {
            if (pendingChallenges.has(socket.id)) {
                pendingChallenges.delete(socket.id);
            }
        }, CHALLENGE_TIMEOUT);
        callback(challenge);
    });

    socket.on('register', async ({ address, publicKey, signingPublicKey, signedPreKey, signedPreKeySignature, username, avatar, status, registeredAt, challenge, signature, proofOfWork, pushToken, osPlatform }) => {
        const normalizedAddress = address.toLowerCase();
        const isAuthenticated = socket.address === normalizedAddress;

        if (!isAuthenticated) {
            if (!challenge || !signature || !proofOfWork) {
                return socket.emit('registrationError', { error: 'Missing challenge, signature, or security proof.' });
            }

            // 1. Verify PoW (Sybil Resistance)
            try {
                const salt = normalizedAddress.slice(0, 16);
                const computedHashHex = await argon2id({
                    password: challenge,
                    salt: salt,
                    iterations: 2,
                    memorySize: 65536,
                    parallelism: 1,
                    hashLength: 32,
                    outputType: 'hex',
                });
                
                const proofOfWorkBuffer = Buffer.from(proofOfWork, 'base64');
                const proofOfWorkHex = proofOfWorkBuffer.toString('hex');

                if (computedHashHex !== proofOfWorkHex) {
                    console.warn(`🛡️ Sybil Alert: Invalid PoW from ${normalizedAddress.slice(0, 10)}`);
                    return socket.emit('registrationError', { error: 'Invalid security proof. Bot detected.' });
                }
            } catch (err) {
                console.error('PoW Validation Error:', err.message);
                if (!GRACE_PERIOD_ENABLED) {
                    return socket.emit('registrationError', { error: 'Security verification failed.' });
                }
            }

            if (!pendingChallenges.has(socket.id) || pendingChallenges.get(socket.id).challenge !== challenge) {
                return socket.emit('registrationError', { error: 'Invalid or expired challenge. Please try again.' });
            }
            pendingChallenges.delete(socket.id); 

            try {
                const expectedMessage = `Authorize DecentraChat Registration: ${challenge}`;
                const recoveredAddress = ethers.verifyMessage(expectedMessage, signature);
                if (recoveredAddress.toLowerCase() !== normalizedAddress) {
                    return socket.emit('registrationError', { error: 'Signature mismatch' });
                }
            } catch (err) {
                return socket.emit('registrationError', { error: 'Invalid signature format' });
            }
        }

        if (username) {
            const normalizedUsername = username.toLowerCase().trim().replace('@', '');
            const existingOwner = await new Promise(resolve => {
                db.get(`SELECT address FROM users WHERE LOWER(username) = ?`, [normalizedUsername], (err, row) => resolve(row?.address));
            });

            if (existingOwner && existingOwner.toLowerCase() !== normalizedAddress) {
                return socket.emit('registrationError', { error: 'Username already taken by another address.' });
            }
        }

        const dbUser = await new Promise(resolve => {
            db.get(`SELECT * FROM users WHERE address = ?`, [normalizedAddress], (err, row) => resolve(row));
        });

        const finalUsername = dbUser?.username || username;
        const finalAvatar = avatar !== undefined ? avatar : dbUser?.avatar;
        const finalStatus = status !== undefined ? status : dbUser?.status;
        const finalRegisteredAt = dbUser?.registered_at || (registeredAt || Date.now());
        const finalPushToken = pushToken || dbUser?.push_token;
        const finalOsPlatform = osPlatform || dbUser?.os_platform;
        const trustScore = dbUser?.trust_score ?? 100;

        db.run(`INSERT OR REPLACE INTO users (address, username, public_key, signing_public_key, signed_pre_key, signed_pre_key_signature, avatar, status, registered_at, trust_score, push_token, os_platform)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [normalizedAddress, finalUsername, publicKey, signingPublicKey, signedPreKey, signedPreKeySignature, finalAvatar, finalStatus, finalRegisteredAt, trustScore, finalPushToken, finalOsPlatform]);
        
        // Generate JWT session token
        const token = jwt.sign({ address: normalizedAddress }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        
        users.set(normalizedAddress, {
            socketId: socket.id,
            publicKey,
            signingPublicKey,
            online: true,
            lastSeen: Date.now(),
            username: finalUsername,
            avatar: finalAvatar,
            status: finalStatus,
            registeredAt: finalRegisteredAt,
            trustScore: trustScore,
            pushToken: finalPushToken,
            osPlatform: finalOsPlatform
        });

        if (finalUsername) {
            usernames.set(finalUsername.toLowerCase(), normalizedAddress);
        }

        socket.address = normalizedAddress;
        socket.join(normalizedAddress);

        socket.emit('registered', {
            address: normalizedAddress,
            publicKey,
            signingPublicKey,
            username: finalUsername,
            registeredAt: finalRegisteredAt,
            trustScore: trustScore,
            trustStage: getTrustStage(finalRegisteredAt, trustScore),
            token // Send token to client for subsequent authentication
        });

        socket.broadcast.emit('userStatus', {
            address: normalizedAddress,
            online: true,
            lastSeen: Date.now(),
            avatar: finalAvatar,
            status: finalStatus,
            registeredAt: finalRegisteredAt,
            trustScore: trustScore,
            trustStage: getTrustStage(finalRegisteredAt, trustScore),
            signingPublicKey
        });
    });

    socket.on('fetchOfflineMessages', () => {
        if (!requireAuth(socket)) return;
        const pending = offlineMessages.get(socket.address) || [];
        if (pending.length > 0) {
            pending.forEach(msg => {
                if (msg._isReaction) socket.emit('messageReaction', msg);
                else if (msg._isGroupCreated) socket.emit('groupCreated', msg);
                else if (msg._isGroupDeleted) socket.emit('groupDeleted', msg);
                else if (msg._isGroupAvatarUpdate) socket.emit('groupAvatarUpdated', msg);
                else if (msg._isGroupMessage) socket.emit('groupMessage', msg);
                else if (msg._isReceipt) socket.emit('messageReceipt', msg);
                else socket.emit('message', msg);
            });
        }
    });

    socket.on('ackOfflineMessages', ({ messageIds }) => {
        if (!requireAuth(socket) || !Array.isArray(messageIds) || messageIds.length === 0) return;
        const pending = offlineMessages.get(socket.address) || [];
        const remaining = pending.filter(msg => !messageIds.includes(msg.id || msg.messageId));
        if (remaining.length === 0) offlineMessages.delete(socket.address);
        else offlineMessages.set(socket.address, remaining);
        saveOfflineMessagesDb();
    });

    socket.on('updateProfile', ({ avatar, status }) => {
        if (!requireAuth(socket)) return;
        const address = socket.address;
        const user = users.get(address);
        if (user) {
            if (avatar !== undefined) user.avatar = avatar;
            if (status !== undefined) user.status = status;
            users.set(address, user);
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
        if (!requireAuth(socket)) return;
        const user = users.get(socket.address);
        if (user) {
            user.pushToken = token;
            users.set(socket.address, user);
        }
    });

    socket.on('verifyContact', async ({ address }, callback) => {
        if (!requireAuth(socket, callback)) return;
        const verifier = socket.address.toLowerCase();
        const verified = address.toLowerCase();

        const verifierUser = await new Promise(resolve => {
            db.get(`SELECT * FROM users WHERE address = ?`, [verifier], (err, row) => resolve(row));
        });
        const verifierStage = verifierUser ? getTrustStage(verifierUser.registered_at, verifierUser.trust_score) : 1;

        if (verifierStage === 1) {
            if (callback) callback({ success: false, error: 'Stage 1 users cannot grant verification points.' });
            return;
        }

        const alreadyVerified = await new Promise(resolve => {
            db.get(`SELECT * FROM verifications WHERE verifier = ? AND verified = ?`, [verifier, verified], (err, row) => resolve(row));
        });

        if (alreadyVerified) {
            if (callback) callback({ success: false, error: 'Already verified this contact.' });
            return;
        }

        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const recentCount = await new Promise(resolve => {
            db.get(`SELECT COUNT(*) as count FROM verifications WHERE verifier = ? AND timestamp > ?`, [verifier, oneDayAgo], (err, row) => resolve(row ? row.count : 0));
        });

        if (recentCount >= 1) {
            if (callback) callback({ success: false, error: 'You can only verify one new contact per day.' });
            return;
        }

        const points = 10;
        db.run(`INSERT INTO verifications (verifier, verified, timestamp) VALUES (?, ?, ?)`, [verifier, verified, Date.now()]);
        incrementTrustScore(verified, points);
        if (callback) callback({ success: true, pointsAwarded: points });
    });

    socket.on('reportSpam', async ({ address, reason }, callback) => {
        if (!requireAuth(socket, callback)) return;
        const reporter = socket.address.toLowerCase();
        const reported = address.toLowerCase();

        if (reporter === reported) {
            if (callback) callback({ success: false, error: 'You cannot report yourself.' });
            return;
        }

        const alreadyReported = await new Promise(resolve => {
            db.get(`SELECT * FROM reports WHERE reporter = ? AND reported = ?`, [reporter, reported], (err, row) => resolve(row));
        });

        if (alreadyReported) {
            if (callback) callback({ success: false, error: 'You have already reported this user.' });
            return;
        }

        const penalty = -50;
        db.run(`INSERT INTO reports (reporter, reported, reason, timestamp) VALUES (?, ?, ?, ?)`, [reporter, reported, reason || 'spam', Date.now()]);
        incrementTrustScore(reported, penalty);
        
        console.log(`🛡️ Spam Report: ${reporter.slice(0, 10)} reported ${reported.slice(0, 10)}. Penalty applied: ${penalty}`);
        
        if (callback) callback({ success: true, penaltyApplied: penalty });
    });

    socket.on('setUsername', async ({ username }, callback) => {
        if (!requireAuth(socket, callback)) return;

        const normalizedUsername = username.toLowerCase().trim();
        if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
            callback({ success: false, error: 'Username must be 3-20 characters' });
            return;
        }
        if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
            callback({ success: false, error: 'Username can only contain letters, numbers, and underscores' });
            return;
        }

        try {
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

            await new Promise((resolve, reject) => {
                db.run(`UPDATE users SET username = ? WHERE address = ?`, [username, socket.address], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            const user = users.get(socket.address);
            if (user?.username) usernames.delete(user.username.toLowerCase());
            usernames.set(normalizedUsername, socket.address);
            if (user) {
                user.username = username;
                users.set(socket.address, user);
            }
            callback({ success: true, username });
        } catch (err) {
            callback({ success: false, error: 'Internal server error' });
        }
    });

    socket.on('lookupByUsername', ({ username }, callback) => {
        const normalizedUsername = username.toLowerCase().trim().replace('@', '');
        
        db.get(`SELECT * FROM users WHERE LOWER(username) LIKE ?`, [`%${normalizedUsername}%`], (err, row) => {
            if (err || !row) {
                callback(null);
                return;
            }
            const onlineUser = users.get(row.address.toLowerCase());
            callback({
                address: row.address,
                username: row.username,
                publicKey: row.public_key,
                signingPublicKey: row.signing_public_key,
                signedPreKey: row.signed_pre_key,
                signedPreKeySignature: row.signed_pre_key_signature,
                avatar: row.avatar,
                status: row.status,
                online: onlineUser?.online || false,
                registeredAt: row.registered_at,
                trustScore: row.trust_score,
                trustStage: getTrustStage(row.registered_at, row.trust_score)
            });
        });
    });

    socket.on('getPublicKey', ({ address }, callback) => {
        const normalizedAddress = address.toLowerCase();
        db.get(`SELECT public_key, signing_public_key, signed_pre_key, signed_pre_key_signature FROM users WHERE address = ?`, [normalizedAddress], (err, row) => {
            if (err || !row) return callback(null);
            const onlineUser = users.get(normalizedAddress);
            callback({ 
                publicKey: row.public_key, 
                signingPublicKey: row.signing_public_key,
                signedPreKey: row.signed_pre_key,
                signedPreKeySignature: row.signed_pre_key_signature,
                online: onlineUser?.online || false 
            });
        });
    });

    socket.on('uploadPreKeys', ({ preKeys }) => {
        if (!requireAuth(socket) || !Array.isArray(preKeys)) return;
        db.serialize(() => {
            preKeys.forEach(pk => {
                db.run(
                    `INSERT OR REPLACE INTO pre_keys (address, key_id, public_key, signature) VALUES (?, ?, ?, ?)`,
                    [socket.address.toLowerCase(), pk.keyId, pk.publicKey, pk.signature || null]
                );
            });
        });
    });

    socket.on('fetchPreKey', ({ address }, callback) => {
        if (!requireAuth(socket, callback)) return;
        if (!address) return callback(null);
        
        const now = Date.now();
        const limit = preKeyCounters.get(socket.address) || { count: 0, resetAt: now + 60000 };
        if (now > limit.resetAt) { limit.count = 1; limit.resetAt = now + 60000; }
        else { limit.count++; }
        preKeyCounters.set(socket.address, limit);
        
        if (limit.count > 30) {
            return callback({ error: 'Rate limit exceeded' });
        }

        const targetAddr = address.toLowerCase();
        db.get(
            `SELECT key_id, public_key, signature FROM pre_keys WHERE address = ? ORDER BY RANDOM() LIMIT 1`,
            [targetAddr],
            (err, row) => {
                if (err || !row) return callback(null);
                db.run(`DELETE FROM pre_keys WHERE address = ? AND key_id = ?`, [targetAddr, row.key_id]);
                callback({
                    keyId: row.key_id,
                    publicKey: row.public_key,
                    signature: row.signature
                });
            }
        );
    });

    socket.on('signal', ({ to, signal }) => {
        if (!requireAuth(socket)) return;
        const toAddress = to.toLowerCase();
        const recipient = users.get(toAddress);
        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('signal', {
                from: socket.address,
                signal
            });
        }
    });

    socket.on('getHistory', ({ peerAddress }, callback) => {
        if (!requireAuth(socket, callback) || typeof callback !== 'function') return;
        callback([]); 
    });

    socket.on('getGroupHistory', ({ groupId, lastSequenceNo }, callback) => {
        if (!requireAuth(socket, callback) || typeof callback !== 'function') return;
        callback([]);
    });

    socket.on('sendMessage', async (messageData) => {
        const { to, ...rest } = messageData;
        const toAddress = to.toLowerCase();
        if (!requireAuth(socket)) return;

        const { allowed, error } = await checkPrivileges(socket.address, 'sendMessage', toAddress);
        if (!allowed) {
            return socket.emit('error', { message: error });
        }

        const fullMessage = {
            ...rest,
            to: toAddress,
            from: socket.address,
            timestamp: Date.now(),
            id: rest.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        const recipient = users.get(toAddress);
        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('message', fullMessage);
            socket.emit('messageStatus', { id: fullMessage.id, status: 'delivered' });
        } else {
            const pending = offlineMessages.get(toAddress) || [];
            pending.push(fullMessage);
            offlineMessages.set(toAddress, pending);
            saveOfflineMessagesDb();
            socket.emit('messageStatus', { id: fullMessage.id, status: 'stored' });
            pushOfflineNotification(toAddress, fullMessage, 'dm');
        }
        socket.emit('messageSent', fullMessage);
    });

    socket.on('sendGroupMessage', (messageData) => {
        if (!requireAuth(socket)) return;
        const { groupId, members, ...rest } = messageData;
        if (!Array.isArray(members) || members.length === 0) return;

        const fullMessage = {
            ...rest,
            groupId,
            from: socket.address,
            timestamp: Date.now(),
            id: rest.id || `gmsg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();
            if (toAddress === socket.address) return;
            const recipient = users.get(toAddress);
            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupMessage', fullMessage);
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...fullMessage, _isGroupMessage: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                pushOfflineNotification(toAddress, fullMessage, 'group');
            }
        });
        socket.emit('messageSent', fullMessage);
    });

    socket.on('checkOnline', ({ address }, callback) => {
        const user = users.get(address.toLowerCase());
        callback(user ? user.online : false);
    });

    socket.on('getUsersStatus', ({ addresses }, callback) => {
        const statuses = {};
        if (!Array.isArray(addresses) || addresses.length === 0) return callback(statuses);

        const lowerAddresses = addresses.map(addr => addr.toLowerCase());
        const placeholders = lowerAddresses.map(() => '?').join(',');

        db.all(`SELECT * FROM users WHERE address IN (${placeholders})`, lowerAddresses, (err, rows) => {
            if (err) return callback(statuses);

            rows.forEach(row => {
                const normalized = row.address;
                const user = users.get(normalized);
                statuses[normalized] = {
                    online: user ? user.online : false,
                    lastSeen: user ? user.lastSeen : null,
                    avatar: row.avatar,
                    status: row.status,
                    trustScore: row.trust_score,
                    trustStage: getTrustStage(row.registered_at, row.trust_score),
                    registeredAt: row.registered_at,
                    signingPublicKey: row.signing_public_key
                };
            });

            // For any requested address not in DB, return defaults
            lowerAddresses.forEach(addr => {
                if (!statuses[addr]) {
                    statuses[addr] = { online: false, lastSeen: null, avatar: null, status: null };
                }
            });

            callback(statuses);
        });
    });

    socket.on('getUser', ({ address }, callback) => {
        const normalizedAddress = address.toLowerCase();
        db.get(`SELECT * FROM users WHERE address = ?`, [normalizedAddress], (err, row) => {
            if (err || !row) return callback(null);
            const onlineUser = users.get(normalizedAddress);
            callback({
                address: normalizedAddress,
                username: row.username,
                publicKey: row.public_key,
                signingPublicKey: row.signing_public_key,
                avatar: row.avatar,
                status: row.status,
                online: onlineUser?.online || false,
                lastSeen: onlineUser?.lastSeen || null,
                registeredAt: row.registered_at,
                trustScore: row.trust_score,
                trustStage: getTrustStage(row.registered_at, row.trust_score)
            });
        });
    });

    socket.on('syncYjsState', ({ toAddress, chatId, epochIndex, updateBase64 }) => {
        if (!requireAuth(socket) || !toAddress) return;
        const recipient = users.get(toAddress.toLowerCase());
        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('syncYjsState', {
                fromAddress: socket.address,
                chatId,
                epochIndex,
                updateBase64
            });
        }
    });

    socket.on('messageReceipt', ({ messageId, to, type, chatId }) => {
        if (!requireAuth(socket)) return;
        const toAddress = to.toLowerCase();
        const fromAddress = socket.address.toLowerCase();
        if (chatId && chatId.startsWith('group_')) {
            db.all(`SELECT user_address FROM group_members WHERE group_id = ?`, [chatId], (err, rows) => {
                if (err || !rows) return;
                rows.forEach(row => {
                    const memberAddr = row.user_address.toLowerCase();
                    if (memberAddr === fromAddress) return;
                    
                    const payload = { id: `rcpt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, messageId, type, from: socket.address, chatId, _isReceipt: true, timestamp: Date.now() };
                    const member = users.get(memberAddr);
                    if (member && member.online) {
                        io.to(member.socketId).emit('messageReceipt', payload);
                    } else {
                        const pending = offlineMessages.get(memberAddr) || [];
                        pending.push(payload);
                        offlineMessages.set(memberAddr, pending);
                        saveOfflineMessagesDb();
                        // No push notification needed for read receipts
                    }
                });
            });
        } else {
            const payload = { id: `rcpt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, messageId, type, from: socket.address, chatId, _isReceipt: true, timestamp: Date.now() };
            const recipient = users.get(toAddress);
            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('messageReceipt', payload);
            } else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push(payload);
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                // No push notification needed for read receipts
            }
        }
    });

    socket.on('getMyGroups', (callback) => {
        if (!requireAuth(socket, callback)) return;
        const address = socket.address.toLowerCase();
        db.all(
            `SELECT g.*, GROUP_CONCAT(m.user_address) as member_list 
             FROM groups g 
             JOIN group_members m ON g.id = m.group_id 
             WHERE g.id IN (SELECT group_id FROM group_members WHERE user_address = ?)
             GROUP BY g.id`,
            [address],
            (err, rows) => {
                if (err) return callback([]);
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

    socket.on('createGroup', async ({ groupId, groupName, members, avatar }) => {
        if (!requireAuth(socket)) return;
        
        const { allowed, error } = await checkPrivileges(socket.address, 'createGroup');
        if (!allowed) {
            return socket.emit('error', { message: error });
        }

        if (!groupId || !Array.isArray(members) || members.length === 0) return;
        const creator = socket.address;
        const timestamp = Date.now();
        db.serialize(() => {
            db.run(`INSERT OR IGNORE INTO groups (id, name, avatar, created_by, created_at) VALUES (?, ?, ?, ?, ?)`, [groupId, groupName, avatar || null, creator, timestamp]);
            members.forEach(memberAddr => {
                const isAdmin = memberAddr.toLowerCase() === creator.toLowerCase() ? 1 : 0;
                db.run(`INSERT OR IGNORE INTO group_members (group_id, user_address, is_admin, joined_at) VALUES (?, ?, ?, ?)`, [groupId, memberAddr.toLowerCase(), isAdmin, timestamp]);
            });
        });
        const payload = { id: `gc_${Date.now()}`, groupId, groupName, members, avatar, admins: [creator], createdBy: creator, timestamp };
        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();
            if (toAddress === creator) return;
            const recipient = users.get(toAddress);
            if (recipient && recipient.online) io.to(recipient.socketId).emit('groupCreated', payload);
            else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupCreated: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                pushOfflineNotification(toAddress, payload, 'groupCreated');
            }
        });
    });

    socket.on('deleteGroup', ({ groupId, members }) => {
        if (!requireAuth(socket) || !groupId) return;
        db.get(`SELECT is_admin FROM group_members WHERE group_id = ? AND user_address = ?`, [groupId, socket.address.toLowerCase()], (err, row) => {
            if (err || !row || row.is_admin !== 1) return; // Not an admin
            db.run(`DELETE FROM groups WHERE id = ?`, [groupId]);
            db.run(`DELETE FROM group_members WHERE group_id = ?`, [groupId]);
            const payload = { id: `gd_${Date.now()}`, groupId, deletedBy: socket.address, timestamp: Date.now() };
            members?.forEach(memberAddr => {
                const toAddress = memberAddr.toLowerCase();
                if (toAddress === socket.address) return;
                const recipient = users.get(toAddress);
                if (recipient && recipient.online) io.to(recipient.socketId).emit('groupDeleted', payload);
                else {
                    const pending = offlineMessages.get(toAddress) || [];
                    pending.push({ ...payload, _isGroupDeleted: true });
                    offlineMessages.set(toAddress, pending);
                    saveOfflineMessagesDb();
                }
            });
        });
    });

    socket.on('removeGroupMember', ({ groupId, memberAddress, members }) => {
        if (!requireAuth(socket) || !groupId || !memberAddress) return;
        db.get(`SELECT is_admin FROM group_members WHERE group_id = ? AND user_address = ?`, [groupId, socket.address.toLowerCase()], (err, row) => {
            if (err || !row || row.is_admin !== 1) {
                // Allow users to remove themselves (leave group)
                if (memberAddress.toLowerCase() !== socket.address.toLowerCase()) return;
            }
            db.run(`DELETE FROM group_members WHERE group_id = ? AND user_address = ?`, [groupId, memberAddress.toLowerCase()]);
            const payload = { id: `gm_${Date.now()}`, groupId, memberAddress, removedBy: socket.address, timestamp: Date.now() };
            const allTargets = members ? [...members, memberAddress] : [memberAddress];
            [...new Set(allTargets)].forEach(addr => {
                const toAddress = addr.toLowerCase();
                if (toAddress === socket.address) return;
                const recipient = users.get(toAddress);
                if (recipient && recipient.online) io.to(recipient.socketId).emit('groupMemberRemoved', payload);
                else {
                    const pending = offlineMessages.get(toAddress) || [];
                    pending.push({ ...payload, _isGroupMemberRemoved: true });
                    offlineMessages.set(toAddress, pending);
                    saveOfflineMessagesDb();
                }
            });
        });
    });

    socket.on('updateGroupAvatar', ({ groupId, avatar, members }) => {
        if (!requireAuth(socket) || !groupId) return;
        db.get(`SELECT is_admin FROM group_members WHERE group_id = ? AND user_address = ?`, [groupId, socket.address.toLowerCase()], (err, row) => {
            if (err || !row || row.is_admin !== 1) return;
            db.run(`UPDATE groups SET avatar = ? WHERE id = ?`, [avatar, groupId]);
            const payload = { id: `ga_${Date.now()}`, groupId, avatar, updatedBy: socket.address, timestamp: Date.now() };
            members?.forEach(memberAddr => {
                const toAddress = memberAddr.toLowerCase();
                if (toAddress === socket.address) return;
                const recipient = users.get(toAddress);
                if (recipient && recipient.online) io.to(recipient.socketId).emit('groupAvatarUpdated', payload);
                else {
                    const pending = offlineMessages.get(toAddress) || [];
                    pending.push({ ...payload, _isGroupAvatarUpdate: true });
                    offlineMessages.set(toAddress, pending);
                    saveOfflineMessagesDb();
                }
            });
        });
    });

    socket.on('messageReaction', (data) => {
        if (!requireAuth(socket)) return;
        const { messageId, emoji, action, to, groupId, members } = data;
        if (!messageId || !emoji) return;
        const payload = { id: `rx_${Date.now()}`, messageId, emoji, action: action || 'add', from: socket.address, groupId: groupId || null, timestamp: Date.now() };
        const targets = groupId && Array.isArray(members) ? members : (to ? [to] : []);
        targets.forEach(addr => {
            const toAddress = addr.toLowerCase();
            if (toAddress === socket.address) return;
            const recipient = users.get(toAddress);
            if (recipient && recipient.online) io.to(recipient.socketId).emit('messageReaction', payload);
            else {
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isReaction: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                pushOfflineNotification(toAddress, payload, 'reaction');
            }
        });
    });

    socket.on('fetchTurnCredentials', async (callback) => {
        if (!requireAuth(socket, callback)) return;
        if (!process.env.TURN_API_KEY) {
            return callback([
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]);
        }
        try {
            const response = await fetch(`https://decentrachat.metered.ca/api/v1/turn/credentials?apiKey=${process.env.TURN_API_KEY}`);
            const iceServers = await response.json();
            callback(iceServers);
        } catch (err) {
            callback([{ urls: 'stun:stun.l.google.com:19302' }]);
        }
    });

    socket.on('disconnect', () => {
        if (pendingChallenges.has(socket.id)) pendingChallenges.delete(socket.id);
        const address = socket.address;
        if (address) {
            const user = users.get(address);
            if (user && user.socketId === socket.id) {
                user.online = false;
                user.lastSeen = Date.now();
                users.delete(address); // Delete from memory map to prevent leaks
                socket.broadcast.emit('userStatus', { address: address, online: false, lastSeen: user.lastSeen });
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 DecentraChat Signaling Server running on port ${PORT}`);
});
