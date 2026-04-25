// Message Service - High-level messaging API with hybrid P2P/Relay transport
import { encryptMessage, decryptMessage } from '../crypto/crypto';
import { getStoredKeys } from '../crypto/keyManager';
import * as socketService from './socketService';
import * as webrtcService from './webrtcService';
import { savePendingMessage, getPendingMessages, removePendingMessage, getLocalHistory } from './storageService';


// Track sent message IDs for deduplication
const sentMessageIds = new Set();

/**
 * Initialize messaging services
 */
export function initMessaging() {
    // Initialize WebRTC service (sets up signal listener)
    webrtcService.init();
}

/**
 * Register user with the messaging network
 * @param {string} address - Wallet address
 * @param {string} publicKey - Encryption public key
 */
export async function registerUser(address, publicKey) {
    socketService.initSocket();
    await socketService.register(address, publicKey);

    localStorage.setItem('decentrachat_address', address);
}

/**
 * Send an encrypted message to a recipient
 * Uses P2P if connected, falls back to server relay
 * @param {string} senderAddress - Sender's wallet address
 * @param {string} recipientAddress - Recipient's wallet address
 * @param {string} plainText - The message content
 * @param {Object} replyTo - Optional reply context { id, content, senderUsername }
 * @param {Object} metadata - Metadata (group routing, media type)
 * @param {string} fallbackPubKey - (Optional) Pre-cached public key from device memory if server drops the user
 * @returns {Promise<Object>} The sent message object
 */
export async function sendEncryptedMessage(senderAddress, recipientAddress, plainText, replyTo = null, metadata = {}, fallbackPubKey = null) {
    // Capture timestamp ONCE so all copies of this message share the same value
    const now = Date.now();

    // Get our keys
    const myKeys = await getStoredKeys();
    if (!myKeys) {
        throw new Error('No encryption keys found. Please reconnect your wallet.');
    }

    // Get recipient's public key from server (Primary)
    let recipientPubKey = await socketService.getPublicKey(recipientAddress);

    // Fallback 1: Caller provided a cached key from the UX contacts layer
    if (!recipientPubKey && fallbackPubKey) {
        recipientPubKey = fallbackPubKey;
        console.log('🔑 Server dropped target; recovered key from caller cache');
    }

    // Fallback: If server forgot them due to memory clears (e.g. they've been offline for days)
    // Mine our local history to see if they've ever sent us a message we can extract the key from!
    if (!recipientPubKey) {
        try {
            const history = await getLocalHistory(recipientAddress);
            if (history && history.length > 0) {
                // Find ANY past inbound message from them
                const lastMsgFromRecipient = history.slice().reverse().find(m => 
                    m.from?.toLowerCase() === recipientAddress.toLowerCase() && m.senderPublicKey
                );
                if (lastMsgFromRecipient) {
                    recipientPubKey = lastMsgFromRecipient.senderPublicKey;
                    console.log('🔑 Recovered offline user public key from local history cache!');
                }
            }
        } catch (err) {
            console.warn('Failed to recover public key from local history:', err);
        }
    }

    if (!recipientPubKey) {
        // User is TRULY offline (not registered AND no history) — queue message for later instead of blocking
        const messageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
        const senderUsername = localStorage.getItem('decentrachat_username') || null;

        const outboxMessage = {
            id: messageId,
            from: senderAddress,
            to: recipientAddress,
            content: plainText,
            senderPublicKey: myKeys.publicKey,
            senderUsername: senderUsername,
            replyTo: replyTo,
            timestamp: now,
            status: 'pending',
            transport: 'queued',
            groupId: metadata.groupId,
            groupName: metadata.groupName,
            members: metadata.members,
            type: metadata.type || 'text',
        };
        await savePendingMessage(outboxMessage);

        // Throw a soft info-level error so the UI can display a friendly toast
        const err = new Error('This user is currently offline. Your message will be delivered when they come back online.');
        err.level = 'info';
        throw err;
    }

    // Encrypt the message
    const encryptedData = encryptMessage(plainText, recipientPubKey, myKeys.secretKey);

    // Get sender's username from localStorage
    const senderUsername = localStorage.getItem('decentrachat_username') || null;

    // Build message payload
    const messageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
    const payload = {
        id: messageId,
        encrypted: encryptedData.encrypted,
        nonce: encryptedData.nonce,
        senderPublicKey: myKeys.publicKey,
        senderUsername: senderUsername,
        replyTo: replyTo,
        timestamp: now,
        // Group metadata
        groupId: metadata.groupId,
        groupName: metadata.groupName,
        members: metadata.members,
        from: senderAddress,
        type: metadata.type || 'text', // Default to text
    };

    // Track for deduplication
    sentMessageIds.add(messageId);

    // Try P2P first
    const p2pSent = webrtcService.sendToPeer(recipientAddress, {
        ...payload,
        from: senderAddress,
        to: recipientAddress,
    });

    if (!p2pSent) {
        // Hybrid: Use Relay
        // Prefer Server Relay if connected
        if (socketService.isConnected()) {
            console.log('📡 Using server relay for message delivery');
            socketService.sendMessage(recipientAddress, payload);
        } else {
            // Queue in outbox for later delivery instead of throwing
            console.warn('⚠️ Server unreachable and P2P failed. Queuing message in outbox.');
            const outboxMessage = {
                ...payload,
                from: senderAddress,
                to: recipientAddress,
                content: plainText,
                status: 'pending',
                type: metadata.type || 'text',
            };
            await savePendingMessage(outboxMessage);
            // Return with pending status instead of throwing
            return {
                id: messageId,
                from: senderAddress,
                to: recipientAddress,
                content: plainText,
                encrypted: encryptedData.encrypted,
                nonce: encryptedData.nonce,
                senderPublicKey: myKeys.publicKey,
                senderUsername: senderUsername,
                replyTo: replyTo,
                timestamp: now,
                status: 'pending',
                transport: 'queued',
                groupId: metadata.groupId,
                groupName: metadata.groupName,
                members: metadata.members,
                type: metadata.type || 'text',
            };
        }
    }

    return {
        id: messageId,
        from: senderAddress,
        to: recipientAddress,
        content: plainText,
        encrypted: encryptedData.encrypted,
        nonce: encryptedData.nonce,
        senderPublicKey: myKeys.publicKey,
        senderUsername: senderUsername,
        replyTo: replyTo,
        timestamp: now,
        status: 'sent',
        transport: p2pSent ? 'p2p' : 'relay',
        groupId: metadata.groupId,
        groupName: metadata.groupName,
        members: metadata.members,
        type: metadata.type || 'text',
    };
}

/**
 * Send typing status to a user
 * @param {string} toAddress - User to notify
 * @param {boolean} isTyping - True/False
 * @param {string} groupId - Optional Group ID
 */
export function sendTypingStatus(toAddress, isTyping, groupId = null) {
    if (!socketService.isConnected()) return;

    socketService.sendSignal(toAddress, {
        type: 'typing',
        isTyping,
        groupId
    });
}

/**
 * Subscribe to typing status updates
 * @param {Function} callback - ({ from, isTyping, groupId }) => void
 */
export function onTypingStatus(callback) {
    socketService.onSignal((data) => {
        if (data.signal?.type === 'typing') {
            callback({
                from: data.from,
                isTyping: data.signal.isTyping,
                groupId: data.signal.groupId
            });
        }
    });
}

/**
 * Decrypt a received message
 * @param {Object} encryptedMessage - Message object
 * @param {Object} cachedKeys - Optional cached keys
 * @param {string} myAddress - Optional current user's address for sender detection
 * @returns {Promise<Object>} Decrypted message object
 */
export async function decryptReceivedMessage(encryptedMessage, cachedKeys = null, myAddress = null) {
    if (!encryptedMessage) return null;

    const myKeys = cachedKeys || await getStoredKeys();
    if (!myKeys) {
        throw new Error('No encryption keys found.');
    }

    // Handle status-only updates
    if (!encryptedMessage.encrypted && encryptedMessage.status) {
        return {
            ...encryptedMessage,
            decryptionFailed: false
        };
    }

    // Determine if I'm the sender - use passed address or keys.address
    const walletAddress = myAddress || myKeys.address;
    const iAmSender = walletAddress &&
        encryptedMessage.from?.toLowerCase() === walletAddress.toLowerCase();

    // Get the appropriate public key for decryption
    let otherPartyPublicKey = encryptedMessage.senderPublicKey;

    // If I'm the sender, I need recipient's public key to decrypt
    if (iAmSender) {
        otherPartyPublicKey = await socketService.getPublicKey(encryptedMessage.to);
    }

    if (!otherPartyPublicKey) {
        return {
            ...encryptedMessage,
            content: '[Unable to decrypt: key not found]',
            decryptionFailed: true
        };
    }

    try {
        const decryptedContent = decryptMessage(
            encryptedMessage.encrypted,
            encryptedMessage.nonce,
            otherPartyPublicKey,
            myKeys.secretKey
        );

        return {
            ...encryptedMessage,
            content: decryptedContent,
            decryptionFailed: false,
            type: encryptedMessage.type || 'text'
        };
    } catch (err) {
        console.error('Decryption failed:', err);
        return {
            ...encryptedMessage,
            content: '[Decryption Failed]',
            decryptionFailed: true
        };
    }
}

/**
 * Subscribe to incoming messages (P2P + Server relay)
 * @param {Function} onMessage - Callback for new messages
 * @param {Object} myKeys - User's keys for decryption
 */
export function subscribeToMessages(onMessage, myKeys) {
    const processedIds = new Set();

    const handleMessage = async (msg) => {
        // Skip if we sent this message
        if (sentMessageIds.has(msg.id)) return;

        // Skip duplicates
        if (processedIds.has(msg.id)) return;
        processedIds.add(msg.id);

        const decrypted = await decryptReceivedMessage(msg, myKeys);
        onMessage(decrypted);
    };

    // Listen to server relay
    socketService.onMessage(handleMessage);

    // Listen to P2P
    webrtcService.onData((msg) => {
        handleMessage(msg);
    });
}

/**
 * Try to establish P2P connection with a user
 * @param {string} theirAddress
 */
export async function connectToPeer(theirAddress) {
    return await webrtcService.connectToPeer(theirAddress);
}

/**
 * Get connection type with a peer
 * @param {string} peerAddress
 * @returns {'p2p' | 'relay' | 'offline'}
 */
export function getConnectionType(peerAddress) {
    return webrtcService.getConnectionType(peerAddress);
}

/**
 * Search for a user by address or username
 * @param {string} query - Address (0x...) or username (@username or username)
 * @returns {Promise<Object|null>}
 */
export async function searchUser(query) {
    const trimmed = query.trim();

    // Search by address
    if (trimmed.startsWith('0x') && trimmed.length === 42) {
        return await socketService.getUser(trimmed);
    }

    // Search by Discussion ID (WORD-WORD-NN format)
    if (/^[A-Z]+-[A-Z]+-\d{1,2}$/i.test(trimmed)) {
        const result = await socketService.lookupByDiscussionId(trimmed.toUpperCase());
        if (result) return result;
    }

    // Search by username
    if (trimmed.length >= 3) {
        const username = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;

        // 1. Try Socket
        const socketUser = await socketService.lookupByUsername(username);
        if (socketUser) return socketUser;
    }

    return null;
}

/**
 * Get conversation history with a peer
 * @param {string} peerAddress
 * @returns {Promise<Array>}
 */
export async function getHistory(peerAddress) {
    return await socketService.getHistory(peerAddress);
}

/**
 * Flush pending messages from the outbox
 * Called on reconnect to retry sending queued messages.
 * Messages queued while the recipient was offline only have plaintext,
 * so we must encrypt them now that the recipient's key may be available.
 * @param {string} senderAddress - Current user's address
 * @param {Function} onFlushed - Optional callback for each flushed message { id, status }
 * @returns {Promise<{ sent: number, failed: number }>}
 */
export async function flushPendingMessages(senderAddress, onFlushed = null) {
    const pending = await getPendingMessages();
    if (pending.length === 0) return { sent: 0, failed: 0 };

    console.log(`📤 Flushing ${pending.length} pending messages from outbox...`);
    let sent = 0;
    let failed = 0;

    const myKeys = await getStoredKeys();
    if (!myKeys) {
        console.error('❌ Cannot flush: no encryption keys');
        return { sent: 0, failed: pending.length };
    }

    for (const msg of pending) {
        try {
            if (!socketService.isConnected()) {
                failed++;
                continue;
            }

            let encrypted = msg.encrypted;
            let nonce = msg.nonce;

            // If the message was queued without encryption (recipient was offline),
            // encrypt it now using the recipient's public key
            if (!encrypted && msg.content) {
                const recipientPubKey = await socketService.getPublicKey(msg.to);
                if (!recipientPubKey) {
                    // Recipient still not available — keep in outbox
                    console.log(`⏳ Recipient ${msg.to?.slice(0, 10)} still offline, keeping in outbox`);
                    failed++;
                    continue;
                }

                const encryptedData = encryptMessage(msg.content, recipientPubKey, myKeys.secretKey);
                encrypted = encryptedData.encrypted;
                nonce = encryptedData.nonce;
            }

            const relayPayload = {
                id: msg.id,
                encrypted: encrypted,
                nonce: nonce,
                senderPublicKey: msg.senderPublicKey || myKeys.publicKey,
                senderUsername: msg.senderUsername,
                replyTo: msg.replyTo,
                timestamp: msg.timestamp,
                groupId: msg.groupId,
                groupName: msg.groupName,
                members: msg.members,
                from: msg.from,
                type: msg.type || 'text',
            };

            socketService.sendMessage(msg.to, relayPayload);
            await removePendingMessage(msg.id);
            sent++;
            console.log(`✅ Flushed message ${msg.id} to ${msg.to?.slice(0, 10)}`);
            if (onFlushed) onFlushed({ id: msg.id, status: 'sent' });
        } catch (err) {
            console.error(`❌ Failed to flush message ${msg.id}:`, err);
            failed++;
        }
    }

    console.log(`📤 Outbox flush complete: ${sent} sent, ${failed} failed`);
    return { sent, failed };
}

/**
 * Send a delivery receipt
 * @param {string} senderAddress - Original sender's address
 * @param {string} messageId
 */
export function sendDeliveryReceipt(senderAddress, messageId) {
    socketService.sendReceipt(messageId, senderAddress, 'delivered');
}

/**
 * Send a read receipt
 * @param {string} senderAddress - Original sender's address
 * @param {string} messageId
 */
export function sendReadReceipt(senderAddress, messageId) {
    socketService.sendReceipt(messageId, senderAddress, 'read');
}

/**
 * Subscribe to message receipts
 * @param {Function} callback - Called with { messageId, type, from }
 */
export function onMessageReceipt(callback) {
    socketService.onReceipt(callback);
}

/**
 * Subscribe to connection status changes
 * @param {Function} callback 
 */
export function onConnectionChange(callback) {
    socketService.onConnectionChange(callback);
}

/**
 * Subscribe to user status updates
 * @param {Function} callback 
 */
export function onUserStatus(callback) {
    return socketService.onUserStatus(callback);
}

/**
 * Get status for multiple users
 * @param {string[]} addresses
 */
export async function getUsersStatus(addresses) {
    return await socketService.getUsersStatus(addresses);
}
