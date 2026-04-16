// DecentraChat Signaling Server
// Handles: WebRTC signaling, presence, offline message store-and-forward
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const path = require('path');
const admin = require('firebase-admin');

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

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for development
        methods: ["GET", "POST"]
    }
});

// In-memory stores (use Redis/SQLite for production persistence)
const users = new Map(); // address -> { socketId, publicKey, online, username }
const fs = require('fs');

const usernames = new Map(); // username -> address (for lookup)

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
const messageHistory = new Map(); // conversationId -> [messages]
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
    // Skip group messages — they shouldn't pollute DM history
    if (msg.groupId) return;

    const convId = getConversationId(msg.from, msg.to);
    const history = messageHistory.get(convId) || [];
    // Avoid duplicates
    if (!history.some(m => m.id === msg.id)) {
        history.push(msg);
        // Keep last 100 messages per conversation
        if (history.length > 100) {
            history.shift();
        }
        messageHistory.set(convId, history);
    }
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'DecentraChat Signaling Server',
        users: users.size,
        conversations: messageHistory.size,
        pendingMessages: [...offlineMessages.values()].flat().length
    });
});

// Authentication Callback from Web (used for Mobile Deep-link bypass)
app.post('/api/auth/callback', (req, res) => {
    const { sessionId, address, signature } = req.body;
    if (!sessionId || !address || !signature) {
        return res.status(400).json({ error: 'Missing parameters' });
    }
    console.log(`[🔐] Received Auth Callback for session: ${sessionId}`);

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
    socket.on('register', ({ address, publicKey, username, avatar, status }) => {
        const normalizedAddress = address.toLowerCase();

        // Get existing username for this user if any
        const existingUser = users.get(normalizedAddress);
        const existingUsername = existingUser?.username || username;
        
        // Use incoming avatar/status or preserve existing ones
        const finalAvatar = avatar !== undefined ? avatar : existingUser?.avatar;
        const finalStatus = status !== undefined ? status : existingUser?.status;

        // Store user info
        users.set(normalizedAddress, {
            socketId: socket.id,
            publicKey,
            online: true,
            lastSeen: Date.now(),
            username: existingUsername,
            avatar: finalAvatar,
            status: finalStatus
        });

        // Also add to usernames lookup map if username exists
        if (existingUsername) {
            usernames.set(existingUsername.toLowerCase(), normalizedAddress);
        }

        socket.address = normalizedAddress;
        socket.join(normalizedAddress);

        console.log(`[✓] Registered: ${normalizedAddress.slice(0, 10)}...${existingUsername ? ` (@${existingUsername})` : ''}`);

        // Notify sender about successful registration FIRST
        // (so client's registerUser() promise resolves and handlers are set up)
        socket.emit('registered', {
            address: normalizedAddress,
            publicKey,
            username: existingUsername
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
    socket.on('setUsername', ({ username }, callback) => {
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

        // Check if username is taken (by someone else)
        const existingAddress = usernames.get(normalizedUsername);
        if (existingAddress && existingAddress !== socket.address) {
            callback({ success: false, error: 'Username already taken' });
            return;
        }

        // Remove old username mapping if user had one
        const user = users.get(socket.address);
        if (user?.username) {
            usernames.delete(user.username.toLowerCase());
        }

        // Set new username
        usernames.set(normalizedUsername, socket.address);
        user.username = username; // Keep original casing
        users.set(socket.address, user);

        console.log(`[@] Username set: ${socket.address.slice(0, 10)}... -> @${username}`);
        callback({ success: true, username });
    });

    // Lookup user by username
    socket.on('lookupByUsername', ({ username }, callback) => {
        const normalizedUsername = username.toLowerCase().trim().replace('@', '');
        const address = usernames.get(normalizedUsername);

        if (address) {
            const user = users.get(address);
            callback({
                address,
                username: user?.username,
                publicKey: user?.publicKey,
                online: user?.online
            });
        } else {
            callback(null);
        }
    });

    // Get user's public key
    socket.on('getPublicKey', ({ address }, callback) => {
        const user = users.get(address.toLowerCase());
        callback(user ? { publicKey: user.publicKey, online: user.online } : null);
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

        // Acknowledge back to sender
        socket.emit('messageSent', fullMessage);
        console.log(`[👥] Group msg ${groupId?.slice(0, 8)}: ${deliveredCount} delivered, ${queuedCount} queued`);
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
        if (user) {
            callback({
                address: address.toLowerCase(),
                publicKey: user.publicKey,
                online: user.online,
                lastSeen: user.lastSeen,
                avatar: user.avatar,
                status: user.status
            });
        } else {
            callback(null);
        }
    });

    // Get conversation history
    socket.on('getHistory', ({ peerAddress }, callback) => {
        if (!socket.address) {
            callback([]);
            return;
        }
        const convId = getConversationId(socket.address, peerAddress.toLowerCase());
        const history = messageHistory.get(convId) || [];

        // Enrich messages with sender usernames if not already present
        const enrichedHistory = history.map(msg => {
            if (!msg.senderUsername && msg.from) {
                const sender = users.get(msg.from.toLowerCase());
                if (sender?.username) {
                    return { ...msg, senderUsername: sender.username };
                }
            }
            return msg;
        });

        console.log(`[📜] Returning ${enrichedHistory.length} messages for conversation`);
        callback(enrichedHistory);
    });

    // Handle message receipts (delivered/read)
    socket.on('messageReceipt', ({ messageId, to, type }) => {
        const toAddress = to.toLowerCase();
        const recipient = users.get(toAddress);

        // Update message in history
        for (const [convId, messages] of messageHistory.entries()) {
            const msg = messages.find(m => m.id === messageId);
            if (msg) {
                msg.status = type; // 'delivered' or 'read'
                break;
            }
        }

        // Relay receipt to sender
        if (recipient && recipient.online) {
            io.to(recipient.socketId).emit('messageReceipt', {
                messageId,
                type,
                from: socket.address
            });
            console.log(`[✓] ${type} receipt: ${messageId.slice(0, 15)}... to ${toAddress.slice(0, 6)}`);
        }
    });

    // ====== GROUP LIFECYCLE EVENTS ======

    // Create group — fan out to all members so they know about the new group
    socket.on('createGroup', ({ groupId, groupName, members, admins }) => {
        if (!groupId || !Array.isArray(members) || members.length === 0) return;

        const payload = {
            id: `gc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            groupName,
            members,
            admins: admins || [socket.address],
            createdBy: socket.address,
            timestamp: Date.now()
        };

        let deliveredCount = 0;
        let queuedCount = 0;

        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();

            // Don't send back to the creator
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);

            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupCreated', payload);
                deliveredCount++;
            } else {
                // Queue for offline delivery
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupCreated: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                queuedCount++;
                pushOfflineNotification(toAddress, payload, 'groupCreated');
            }
        });

        console.log(`[👥+] Group created ${groupId?.slice(0, 8)}: ${deliveredCount} notified, ${queuedCount} queued`);
    });

    // Delete group — fan out to all members so they remove it
    socket.on('deleteGroup', ({ groupId, members }) => {
        if (!groupId || !Array.isArray(members) || members.length === 0) return;

        const payload = {
            id: `gd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            deletedBy: socket.address,
            timestamp: Date.now()
        };

        let deliveredCount = 0;
        let queuedCount = 0;

        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();

            // Don't send back to the admin who deleted
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);

            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupDeleted', payload);
                deliveredCount++;
            } else {
                // Queue for offline delivery
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupDeleted: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                queuedCount++;
            }
        });

        console.log(`[👥-] Group deleted ${groupId?.slice(0, 8)}: ${deliveredCount} notified, ${queuedCount} queued`);
    });

    // Update group avatar — fan out to all members
    socket.on('updateGroupAvatar', ({ groupId, avatar, members }) => {
        if (!groupId || !Array.isArray(members) || members.length === 0) return;

        const payload = {
            id: `ga_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            groupId,
            avatar,
            updatedBy: socket.address,
            timestamp: Date.now()
        };

        let deliveredCount = 0;
        let queuedCount = 0;

        members.forEach(memberAddr => {
            const toAddress = memberAddr.toLowerCase();

            // Don't send back to the admin who updated
            if (toAddress === socket.address) return;

            const recipient = users.get(toAddress);

            if (recipient && recipient.online) {
                io.to(recipient.socketId).emit('groupAvatarUpdated', payload);
                deliveredCount++;
            } else {
                // Queue for offline delivery
                const pending = offlineMessages.get(toAddress) || [];
                pending.push({ ...payload, _isGroupAvatarUpdate: true });
                offlineMessages.set(toAddress, pending);
                saveOfflineMessagesDb();
                queuedCount++;
            }
        });

        console.log(`[👥🖼] Group avatar updated ${groupId?.slice(0, 8)}: ${deliveredCount} notified, ${queuedCount} queued`);
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
