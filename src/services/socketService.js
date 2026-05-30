// Socket.IO Service - Connection to signaling server
import { io } from 'socket.io-client';

// Deployed server URL - uses Render.com
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://decentrachat-singnalling.onrender.com';

let socket = null;
let messageCallback = null;
let signalCallback = null;
let receiptCallback = null;
let connectionChangeCallback = null;
let currentUser = null;
let isRegistered = false;
let registrationPromise = null;
let userStatusListeners = [];
let reconnectCallbacks = []; // Fired when socket reconnects after a disconnect
let wasDisconnected = false; // Track if we were previously disconnected
let activeAuthSessionId = null; // Track active auth relay session to handle reconnections
let groupCreatedCallback = null;
let groupDeletedCallback = null;
let reactionCallback = null;
let groupAvatarUpdatedCallback = null;
let groupMemberRemovedCallback = null;
let mediaQueryCallback = null;
let mediaOfferCallback = null;

/**
 * Initialize socket connection
 */
export function initSocket() {
    if (socket) return socket;

    // Wake up Render server (cold start can take 30-60s on free tier)
    // Fire an HTTP request BEFORE opening the socket so the server spins up
    fetch(SERVER_URL, { method: 'GET', mode: 'no-cors' }).catch(() => {});

    const token = localStorage.getItem('decentrachat_session_token');

    socket = io(SERVER_URL, {
        auth: token ? { token } : undefined,
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: Infinity,  // Never give up
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,     // Cap at 10s between attempts
        timeout: 30000,                  // 30s connection timeout for cold starts
    });

    socket.on('connect_error', (err) => {
        console.error('❌ Socket Connection Error:', err.message);
        console.error('Target URL:', SERVER_URL);
        console.error('Error Details:', err);
    });

    socket.on('connect', () => {
        console.log('🔌 Connected to signaling server');
        // Re-register if we were previously registered (handles reconnects).
        // We call the full register() function to attempt a signed challenge-response.
        // If the signer (MetaMask) is unavailable, it falls back to the legacy
        // unsigned emit which the server's grace period accepts.
        if (currentUser && isRegistered) {
            console.log('🔄 Re-registering session with challenge-response...');
            register(
                currentUser.address,
                currentUser.publicKey,
                currentUser.signingPublicKey,
                currentUser.signedPreKey,
                currentUser.signedPreKeySignature,
                currentUser.username,
                currentUser.avatar,
                currentUser.status,
                currentUser.signMessage,
                currentUser.getPoW,
                currentUser.pushToken,
                currentUser.signingSecretKey,
                currentUser.walletSignature
            ).catch(err => {
                console.error('⚠️ Challenge-response re-registration failed:', err.message);
            });
        }

        // Re-join auth room if we were waiting for login (crucial for mobile backgrounding)
        if (activeAuthSessionId) {
            console.log('🔄 Re-joining auth room after reconnect:', activeAuthSessionId);
            socket.emit('join_auth_room', { sessionId: activeAuthSessionId });
        }

        if (connectionChangeCallback) connectionChangeCallback(true);

        // Fire reconnect callbacks if we were previously disconnected
        if (wasDisconnected) {
            console.log('🔄 Reconnected! Firing reconnect callbacks...');
            wasDisconnected = false;
            // Small delay to ensure registration completes
            setTimeout(() => {
                reconnectCallbacks.forEach(cb => cb());
            }, 500);
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected from signaling server');
        wasDisconnected = true;
        if (connectionChangeCallback) connectionChangeCallback(false);
    });

    socket.on('connect_error', (error) => {
        console.warn('Connection error (auto-reconnecting):', error.message);
        // Removed aggressive alert, rely on connectionChangeCallback for UI state
    });

    socket.on('syncYjsState', (data) => {
        if (syncYjsStateCallback) syncYjsStateCallback(data);
    });

    // Handle incoming messages
    socket.on('message', (msg) => {
        console.log('📩 Received message via server');
        if (messageCallback) {
            messageCallback(msg);
        }
    });

    // Handle incoming group messages (real-time + offline-queued delivery)
    socket.on('groupMessage', (msg) => {
        console.log('👥 Received group message via server');
        if (groupMessageCallback) {
            groupMessageCallback(msg);
        }
    });

    // Handle WebRTC signals
    socket.on('signal', (data) => {
        // Allow hooking into generic signals (like typing indicators)
        if (data.signal?.type === 'typing') {
            console.log('⌨️ Typing signal:', data.from?.slice(0, 10), data.signal.isTyping);
            if (typingCallback) typingCallback(data);
            return;
        }

        // Handle Media Swarm Signals
        if (data.signal?.type === 'MEDIA_QUERY') {
            if (mediaQueryCallback) mediaQueryCallback(data);
            return;
        }
        if (data.signal?.type === 'MEDIA_OFFER') {
            if (mediaOfferCallback) mediaOfferCallback(data);
            return;
        }

        console.log('📡 Received WebRTC signal from:', data.from?.slice(0, 10));
        if (signalCallback) {
            signalCallback(data);
        }
    });

    // Handle message sent confirmation
    socket.on('messageSent', (msg) => {
        console.log('✓ Message sent confirmed:', msg.id);
    });

    // Handle message status updates
    socket.on('messageStatus', ({ id, status }) => {
        console.log(`📝 Message ${id} status: ${status}`);
    });

    // Handle message receipts (delivered/read)
    socket.on('messageReceipt', (data) => {
        console.log(`✓ Receipt: ${data.type} for ${data.messageId?.slice(0, 15)}`);
        if (receiptCallback) {
            receiptCallback(data);
        }
    });

    // Handle user status updates (online/offline)
    socket.on('userStatus', (data) => {
        console.log(`👤 User status update: ${data.address?.slice(0, 10)} is ${data.online ? 'Online' : 'Offline'}`);
        userStatusListeners.forEach(listener => listener(data));
    });

    // Handle group lifecycle events
    socket.on('groupCreated', (data) => {
        console.log('👥+ Group created notification:', data.groupId?.slice(0, 10));
        if (groupCreatedCallback) groupCreatedCallback(data);
    });

    socket.on('groupDeleted', (data) => {
        console.log('🗑️ Group deleted notification:', data.groupId?.slice(0, 10));
        if (groupDeletedCallback) groupDeletedCallback(data);
    });

    socket.on('groupMemberRemoved', (data) => {
        console.log('🚪 Group member removed:', data.memberAddress?.slice(0, 10));
        if (groupMemberRemovedCallback) groupMemberRemovedCallback(data);
    });

    socket.on('groupAvatarUpdated', (data) => {
        console.log('👥🖼 Group avatar updated:', data.groupId?.slice(0, 10));
        if (groupAvatarUpdatedCallback) groupAvatarUpdatedCallback(data);
    });

    socket.on('messageReaction', (data) => {
        if (reactionCallback) reactionCallback(data);
    });

    // Handle registration errors
    socket.on('registrationError', (data) => {
        console.error('❌ Registration Error:', data.error);
        alert(`Registration Error: ${data.error}`);
    });

    return socket;
}

// ... existing code ...



/**
 * Request a random challenge from the server for cryptographic verification
 * @returns {Promise<string>}
 */
export function requestChallenge() {
    if (!socket) initSocket();
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for registration challenge'));
        }, 7000);

        socket.emit('requestChallenge', (challenge) => {
            clearTimeout(timeout);
            resolve(challenge);
        });
    });
}

/**
 * Get all groups for the current user from the server registry
 * @returns {Promise<Array>}
 */
export function getMyGroups() {
    if (!socket?.connected) return Promise.resolve([]);

    return new Promise((resolve) => {
        socket.emit('getMyGroups', (groups) => {
            resolve(groups);
        });
    });
}

/**
 * Sync missed group messages from the server registry (Task 11)
 * @param {string} groupId 
 * @param {number} lastSequenceNo 
 * @returns {Promise<Array>}
 */
export function syncGroup(groupId, lastSequenceNo) {
    if (!socket?.connected) return Promise.resolve([]);

    return new Promise((resolve) => {
        socket.emit('getGroupHistory', { groupId, lastSequenceNo }, (messages) => {
            resolve(messages);
        });
    });
}

/**
 * --- TASK 12: Double Ratchet Pre-Key Management ---
 */

/**
 * Upload a bundle of one-time pre-keys to the server
 */
export function uploadPreKeys(preKeys) {
    if (!socket?.connected) return;
    socket.emit('uploadPreKeys', { preKeys });
}

/**
 * Fetch a one-time pre-key for a peer (consumed on fetch)
 */
export function fetchPreKey(address) {
    if (!socket?.connected) return Promise.resolve(null);

    return new Promise((resolve) => {
        socket.emit('fetchPreKey', { address }, (preKey) => {
            resolve(preKey);
        });
    });
}

/**
 * Send static registration data to the server (pub key, username, etc)
 * @param {string} address User's wallet address
 * @param {string} publicKey User's public key for encryption
 * @param {string} [username] Optional username
 * @param {string} [avatar] Optional base64 avatar
 * @param {string} [status] Optional status text
 * @param {Function} [signMessage] Optional function to sign the challenge
 * @param {Function} [getPoW] Optional function to solve Argon2 PoW (challenge => Promise<hash>)
 * @param {string} [pushToken] Optional FCM/APNs token for background push
 * @returns {Promise<{address: string, username?: string}>}
 */
export async function register(address, publicKey, signingPublicKey, signedPreKey, signedPreKeySignature, username, avatar, status, signMessage, getPoW, pushToken, signingSecretKey = null, walletSignature = null) {
    if (registrationPromise) return registrationPromise;

    if (!socket) initSocket();

    // Store credentials so they persist across socket disconnects/reconnects
    currentUser = { address, publicKey, signingPublicKey, signedPreKey, signedPreKeySignature, username, avatar, status, signMessage, getPoW, pushToken, signingSecretKey, walletSignature };

    registrationPromise = (async () => {
        try {
            let challenge = null;
            let signature = null;
            let proofOfWork = null;
            let signatureMethod = 'wallet';

            // Check if we are already authenticated via token on the socket
            const storedToken = localStorage.getItem('decentrachat_session_token');
            const hasValidToken = storedToken && socket.auth?.token === storedToken;

            if (!hasValidToken) {
                try {
                    console.log('🛡️ Requesting registration challenge...');
                    challenge = await requestChallenge();
                    
                    // Perform PoW if solver provided
                    if (getPoW) {
                        console.log('🛡️ Solving Sybil-resistance PoW...');
                        proofOfWork = await getPoW(challenge);
                    }

                    if (signingSecretKey) {
                        // Method 1: Detached signature using stored Identity key (Zero Wallet Popups)
                        console.log('🛡️ Signing registration challenge via Identity Key...');
                        const { signDetached } = await import('../crypto/crypto');
                        const msg = `Authorize DecentraChat Registration: ${challenge}`;
                        signature = signDetached(msg, signingSecretKey);
                        signatureMethod = 'identity';
                    } else if (signMessage) {
                        // Method 2: Standard Wallet personal_sign
                        console.log('🛡️ Signing registration challenge via Web3 Wallet...');
                        const msg = `Authorize DecentraChat Registration: ${challenge}`;
                        signature = await signMessage(msg);
                        signatureMethod = 'wallet';
                    } else if (walletSignature) {
                        // Method 3: Fallback using cached Wallet signature (Pairing / Generation Proof)
                        console.log('🛡️ Utilizing cached wallet signature fallback...');
                        signature = walletSignature;
                        if (activeAuthSessionId) {
                            challenge = activeAuthSessionId;
                            signatureMethod = 'pairing';
                        } else {
                            challenge = address;
                            signatureMethod = 'generation';
                        }
                    }
                } catch (err) {
                    console.warn('⚠️ Signature flow failed, trying cached wallet signature fallback:', err.message);
                    if (walletSignature) {
                        signature = walletSignature;
                        if (activeAuthSessionId) {
                            challenge = activeAuthSessionId;
                            signatureMethod = 'pairing';
                        } else {
                            challenge = address;
                            signatureMethod = 'generation';
                        }
                    } else {
                        throw err;
                    }
                }
            }

            return await new Promise((resolve, reject) => {
                let isResolved = false;

                const timeout = setTimeout(() => {
                    if (!isResolved) {
                        alert(`Network Timeout: Failed to register session after 15 seconds. Please restart the app.`);
                        reject(new Error(`Timeout waiting for 'registered' event from server.`));
                    }
                }, 15000);

                socket.emit('register', { 
                    address, 
                    publicKey, 
                    signingPublicKey: currentUser.signingPublicKey, 
                    signedPreKey: currentUser.signedPreKey, 
                    signedPreKeySignature: currentUser.signedPreKeySignature, 
                    username, 
                    avatar, 
                    status, 
                    challenge, 
                    signature, 
                    signatureMethod,
                    proofOfWork, 
                    pushToken 
                });
                
                socket.once('registered', (data) => {
                    isResolved = true;
                    isRegistered = true;
                    clearTimeout(timeout);
                    console.log('✓ Registered with server:', data.address?.slice(0, 10), data.username ? `(@${data.username})` : '');
                    
                    if (data.token) {
                        localStorage.setItem('decentrachat_session_token', data.token);
                        if (socket) socket.auth = { token: data.token };
                    }
                    
                    resolve(data);
                });
            });
        } catch (err) {
            console.error('Registration failed:', err);
            throw err;
        } finally {
            registrationPromise = null;
        }
    })();

    return registrationPromise;
}

/**
 * Set username for the current user
 * @param {string} username
 * @returns {Promise<{success: boolean, username?: string, error?: string}>}
 */
export function setUsername(username) {
    if (!socket?.connected) {
        return Promise.resolve({ success: false, error: 'Not connected' });
    }

    return new Promise((resolve) => {
        socket.emit('setUsername', { username }, (response) => {
            resolve(response);
        });
    });
}

/**
 * Lookup user by username
 * @param {string} username
 * @returns {Promise<{address, username, publicKey, online} | null>}
 */
export function lookupByUsername(username) {
    if (!socket?.connected) {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        socket.emit('lookupByUsername', { username }, (response) => {
            resolve(response);
        });
    });
}



/**
 * Send an encrypted message
 * @param {string} to - Recipient address
 * @param {Object} messageData - Encrypted message data
 */
export function sendMessage(to, messageData) {
    if (!socket?.connected) {
        throw new Error('Not connected to server');
    }

    socket.emit('sendMessage', {
        to,
        ...messageData
    });
}

/**
 * Subscribe to incoming messages
 * @param {Function} callback
 */
export function onMessage(callback) {
    messageCallback = callback;
}

/**
 * Send a group message (server fans out + queues for offline members)
 * @param {string} groupId - The group's unique ID
 * @param {string[]} members - Array of all member addresses (including sender)
 * @param {Object} messageData - Encrypted message data
 */
export function sendGroupMessage(groupId, members, messageData) {
    if (!socket?.connected) {
        throw new Error('Not connected to server');
    }
    socket.emit('sendGroupMessage', {
        groupId,
        members,
        ...messageData
    });
}

/**
 * Subscribe to incoming group messages (real-time + queued offline delivery)
 * @param {Function} callback
 * @returns {Function} unsubscribe function
 */
let groupMessageCallback = null;
export function onGroupMessage(callback) {
    groupMessageCallback = callback;
    return () => { groupMessageCallback = null; };
}

/**
 * Subscribe to WebRTC signals
 * @param {Function} callback
 */
export function onSignal(callback) {
    signalCallback = callback;
}

/**
 * Subscribe to message receipts (delivered/read)
 * @param {Function} callback
 */
export function onReceipt(callback) {
    receiptCallback = callback;
}

/**
 * Subscribe to connection status changes
 * @param {Function} callback 
 */
export function onConnectionChange(callback) {
    connectionChangeCallback = callback;
    // Callback immediately with current status
    if (socket) {
        callback(socket.connected);
    }
}

/**
 * Subscribe to user status updates
 * @param {Function} callback
 * @returns {Function} unsubscribe function
 */
export function onUserStatus(callback) {
    userStatusListeners.push(callback);
    return () => {
        userStatusListeners = userStatusListeners.filter(l => l !== callback);
    };
}

/**
 * Subscribe to reconnection events
 * @param {Function} callback - Called when socket reconnects after disconnect
 * @returns {Function} unsubscribe function
 */
export function onReconnect(callback) {
    reconnectCallbacks.push(callback);
    return () => {
        reconnectCallbacks = reconnectCallbacks.filter(cb => cb !== callback);
    };
}

/**
 * Send a message receipt (delivered or read)
 * @param {string} messageId - The message ID
 * @param {string} to - Original sender's address
 * @param {'delivered' | 'read'} type - Receipt type
 */
export function sendReceipt(messageId, to, type, chatId = null) {
    if (!socket?.connected) return;
    socket.emit('messageReceipt', { messageId, to, type, chatId });
}

/**
 * Send WebRTC signal to peer
 * @param {string} to - Peer address
 * @param {Object} signal - WebRTC signal data
 */
export function sendSignal(to, signal) {
    if (!socket?.connected) return;
    socket.emit('signal', { to, signal });
}

// ====== GROUP LIFECYCLE ======

/**
 * Notify server about new group creation (server fans out to members)
 */
export function emitCreateGroup(groupId, groupName, members, admins, avatar = null) {
    if (!socket?.connected) return;
    socket.emit('createGroup', { groupId, groupName, members, admins, avatar });
}

/**
 * Notify server about group deletion (server fans out to members)
 */
export function emitDeleteGroup(groupId, members) {
    if (!socket?.connected) return;
    socket.emit('deleteGroup', { groupId, members });
}

/**
 * Notify server to remove a member from a group
 */
export function emitRemoveGroupMember(groupId, memberAddress, members) {
    if (!socket?.connected) return;
    socket.emit('removeGroupMember', { groupId, memberAddress, members });
}

/**
 * Subscribe to group created events
 * @param {Function} callback - ({ groupId, groupName, members, admins, createdBy }) => void
 */
export function onGroupCreated(callback) {
    groupCreatedCallback = callback;
}

/**
 * Subscribe to group member removed events
 * @param {Function} callback 
 */
export function onGroupMemberRemoved(callback) {
    groupMemberRemovedCallback = callback;
}

/**
 * Subscribe to group deleted events
 * @param {Function} callback - ({ groupId, deletedBy }) => void
 */
export function onGroupDeleted(callback) {
    groupDeletedCallback = callback;
}

/**
 * Emit a reaction event to the server
 */
export function emitReaction(messageId, emoji, action, to, groupId, members) {
    if (!socket?.connected) return;
    socket.emit('messageReaction', { messageId, emoji, action, to, groupId, members });
}

let typingCallback = null;

export function onTypingStatus(cb) {
    typingCallback = cb;
}

/**
 * Send typing status indicator
 */
export function sendTypingStatus(toAddress, isTyping, groupId = null) {
    if (!socket?.connected) return;
    
    // Send as a special generic signal
    socket.emit('signal', {
        to: toAddress,
        groupId: groupId,
        signal: { type: 'typing', isTyping }
    });
}

/**
 * Emit a group avatar update to the server (server fans out to all members)
 */
export function emitUpdateGroupAvatar(groupId, avatar, members) {
    if (!socket?.connected) return;
    socket.emit('updateGroupAvatar', { groupId, avatar, members });
}

/**
 * Subscribe to group avatar update events
 * @param {Function} callback - ({ groupId, avatar, updatedBy }) => void
 */
export function onGroupAvatarUpdated(callback) {
    groupAvatarUpdatedCallback = callback;
}

/**
 * Get user info from server
 * @param {string} address
 */
export function getUser(address) {
    if (!socket?.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
        socket.emit('getUser', { address }, (user) => {
            resolve(user);
        });
    });
}

/**
 * Emit cryptographic verification of a peer to award POC points
 * @param {string} address The verified peer's wallet address
 */
export function emitVerifyContact(address) {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve({ success: false, error: 'Offline' });
            return;
        }
        socket.emit('verifyContact', { address }, (response) => {
            resolve(response);
        });
    });
}

/**
 * Report a user for spam/abuse
 * @param {string} address 
 * @param {string} reason 
 */
export function emitReportSpam(address, reason = 'spam') {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve({ success: false, error: 'Offline' });
            return;
        }
        socket.emit('reportSpam', { address, reason }, (response) => {
            resolve(response);
        });
    });
}

/**
 * Emit a Yjs sync state vector or update to a peer
 */
export function emitSyncYjsState(toAddress, chatId, epochIndex, updateBase64) {
    if (!socket?.connected) return;
    socket.emit('syncYjsState', { toAddress, chatId, epochIndex, updateBase64 });
}

let syncYjsStateCallback = null;

/**
 * Subscribe to incoming Yjs state updates
 */
export function onSyncYjsState(callback) {
    syncYjsStateCallback = callback;
}

/**
 * Check if user is online
 * @param {string} address
 */
export function checkOnline(address) {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve(false);
            return;
        }
        socket.emit('checkOnline', { address }, (online) => {
            resolve(online);
        });
    });
}

/**
 * Check if user is online
 * @param {string} address
 */
export function checkUsernameAvailability(username) {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve({ available: false, error: 'Offline' });
            return;
        }
        socket.emit('checkUsername', { username }, (response) => {
            resolve(response);
        });
    });
}

/**
 * Update the user's avatar and status
 * @param {string} avatar Base64 image string or URL
 * @param {string} status Status tagline
 */
export function updateProfile(avatar, status) {
    if (!socket?.connected) return;
    
    // Update our saved credentials for reconnections
    if (currentUser) {
        currentUser.avatar = avatar;
        currentUser.status = status;
    }
    
    socket.emit('updateProfile', { avatar, status });
}

/**
 * Update the user's push notification token
 * @param {string} token FCM token from Capacitor
 */
export function updatePushToken(token) {
    if (!socket?.connected) return;
    socket.emit('updatePushToken', { token });
}

/**
 * Request delivery of any queued offline messages
 */
export function fetchOfflineMessages() {
    if (!socket?.connected) return;
    socket.emit('fetchOfflineMessages');
}

/**
 * Acknowledge receipt of offline messages so the server deletes them from its holding queue
 * @param {string[]} messageIds 
 */
export function ackOfflineMessages(messageIds) {
    if (!socket?.connected || !messageIds || messageIds.length === 0) return;
    socket.emit('ackOfflineMessages', { messageIds });
}

/**
 * Get status for multiple users
 * @param {string[]} addresses
 */
export function getUsersStatus(addresses) {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve({});
            return;
        }
        const timer = setTimeout(() => {
            console.warn('⚠️ getUsersStatus timed out');
            resolve({});
        }, 7000);

        socket.emit('getUsersStatus', { addresses }, (statuses) => {
            clearTimeout(timer);
            resolve(statuses);
        });
    });
}

/**
 * Get user's public key
 * @param {string} address
 */
export function getPublicKey(address) {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve(null);
            return;
        }
        // Hard deadline to prevent infinite promise deadlock if socket stalls
        const timer = setTimeout(() => {
            console.warn(`⚠️ getPublicKey timeout for ${address?.slice(0, 8)}`);
            resolve(null); // Fail gracefully so app enters offline queue mode
        }, 7000);

        socket.emit('getPublicKey', { address }, (result) => {
            clearTimeout(timer);
            resolve(result?.publicKey || null);
        });
    });
}

/**
 * Get conversation history with a peer
 * @param {string} peerAddress
 * @returns {Promise<Array>}
 */
export function getHistory(peerAddress) {
    return new Promise((resolve) => {
        if (!socket?.connected) {
            resolve([]);
            return;
        }
        // Hard deadline to prevent infinite spinner on stalled load
        const timer = setTimeout(() => {
            console.warn(`⚠️ getHistory timeout for ${peerAddress?.slice(0, 8)}`);
            resolve([]);
        }, 7000);

        socket.emit('getHistory', { peerAddress }, (history) => {
            clearTimeout(timer);
            console.log(`📜 Received ${history?.length || 0} historical messages`);
            resolve(history || []);
        });
    });
}

/**
 * Listen for off-band authentication (Mobile WebSocket Relay)
 * @param {string} sessionId
 * @returns {Promise<{address, signature}>}
 */
export function listenForAuth(sessionId) {
    if (!socket?.connected) initSocket();
    activeAuthSessionId = sessionId;

    return new Promise((resolve, reject) => {
        // 2 minute timeout - mobile auth can take a while if the user is slow in MetaMask
        const timeout = setTimeout(() => {
            socket.off('wallet_auth_result', handler);
            activeAuthSessionId = null;
            reject(new Error('Authentication timed out after 2 minutes. Please try again.'));
        }, 120000);

        const handler = (data) => {
            clearTimeout(timeout);
            console.log('✅ Received Auth Result via WebSocket Relay!');
            socket.off('wallet_auth_result', handler);
            socket.emit('leave_auth_room', { sessionId });
            activeAuthSessionId = null;
            resolve(data);
        };
        socket.on('wallet_auth_result', handler);

        // Join the specific room for this auth session
        socket.emit('join_auth_room', { sessionId });
        console.log(`🔌 Listening for Auth Relay in room: auth_${sessionId}`);
    });
}

/**
 * Disconnect from server
 */
export function disconnect() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    currentUser = null;
    isRegistered = false;
}



export function onReaction(callback) {
    if (socket) {
        socket.on('reaction', callback);
    }
}

export function updateSocketProfile(avatar, status) {
    if (socket) {
        socket.emit('update_profile', { avatar, status });
    }
}

/**
 * Check if connected
 */
export function isConnected() {
    return socket?.connected || false;
}

/**
 * Get socket instance
 */
export function getSocket() {
    return socket;
}

// ====== MEDIA SELF-HEALING (P2P SWARM) ======

/**
 * Broadcast a request for missing media chunks to the chat members
 * @param {string} chatId The chat/group ID
 * @param {string} mediaId The ID of the missing media
 */
export function requestMedia(chatId, mediaId) {
    if (!socket?.connected) return;
    socket.emit('signal', {
        groupId: chatId, // If it's a group, send to group. If direct, the server handles it if to === chatId.
        to: chatId,      // Server will route based on what this is
        signal: { type: 'MEDIA_QUERY', mediaId, chatId }
    });
    console.log(`[Media Swarm] 📡 Broadcasted MEDIA_QUERY for ${mediaId}`);
}

/**
 * Offer media chunks to the chat (so others know it's handled)
 * @param {string} chatId The chat/group ID
 * @param {string} mediaId The ID of the media
 */
export function offerMedia(chatId, mediaId) {
    if (!socket?.connected) return;
    socket.emit('signal', {
        groupId: chatId,
        to: chatId,
        signal: { type: 'MEDIA_OFFER', mediaId }
    });
    console.log(`[Media Swarm] 🤝 Sent MEDIA_OFFER to ${chatId} for ${mediaId}`);
}

/**
 * Subscribe to incoming media queries
 */
export function onMediaQuery(callback) {
    mediaQueryCallback = callback;
}

/**
 * Subscribe to incoming media offers
 */
export function onMediaOffer(callback) {
    mediaOfferCallback = callback;
}
