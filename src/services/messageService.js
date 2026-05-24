// Message Service - High-level messaging API with hybrid P2P/Relay transport
import { 
    encryptMessage, 
    decryptMessage, 
    generatePreKeyBundle, 
    deriveX3DHSecret,
    deriveX3DHResponderSecret,
    generateKeyPair,
    verifyPreKeySignature
} from '../crypto/crypto';
import { 
    createSession, 
    createSessionResponder,
    encryptRatchet, 
    decryptRatchet,
    storePreKeySecrets,
    consumePreKeySecret
} from '../crypto/doubleRatchet';
import {
    initEpochSession,
    decryptEpoch
} from '../crypto/epochRatchet';
import { getStoredKeys } from '../crypto/keyManager';
import * as socketService from './socketService';
import { encodeBase64 } from 'tweetnacl-util';
import * as webrtcService from './webrtcService';
import * as wakuService from './wakuService';
import { savePendingMessage, getPendingMessages, removePendingMessage } from './storageService';
import { generateEpochKey, ratchetEpochKey, encryptGroupMessage, decryptGroupMessage } from '../crypto/groupRatchet';
import { saveGroupEpochKey, getActiveGroupEpochKey } from './groupKeyStore';

import { handleIncomingVector, handleIncomingUpdate } from './swarmSync';

// Track sent message IDs for deduplication
const sentMessageIds = new Set();

/**
 * Initialize messaging services and upload pre-keys for Task 12
 */
export async function initMessaging() {
    // Initialize WebRTC service (sets up signal listener)
    webrtcService.init();

    // Initialize Waku mesh network (Layer 4)
    wakuService.initWaku();

    // --- TASK 12: Upload Pre-Key Bundle for Double Ratchet ---
    const myKeys = await getStoredKeys();
    if (myKeys) {
        // Sign bundle with Ed25519 signing secret key
        const bundle = generatePreKeyBundle(myKeys.signingSecretKey, 30);

        // Store secret keys locally (needed when WE are the X3DH responder)
        await storePreKeySecrets(bundle.oneTimePreKeys.map(pk => ({
            id: pk.id,
            secretKey: pk.secretKey
        })));

        // Upload ONLY public keys AND signatures to the server
        socketService.uploadPreKeys(bundle.oneTimePreKeys.map(pk => ({
            keyId: pk.id,
            publicKey: pk.publicKey,
            signature: pk.signature
        })));

        console.log('🔐 Task 12: Uploaded signed pre-key bundle for X3DH');
    }
}

/**
 * Register user with the messaging network
 * @param {string} address - Wallet address
 * @param {string} publicKey - Encryption public key
 */
export async function registerUser(address, publicKey, signingPublicKey, username, avatar, status, signMessage, getPoW, pushToken) {
    socketService.initSocket();
    await socketService.register(address, publicKey, signingPublicKey, username, avatar, status, signMessage, getPoW, pushToken);

    localStorage.setItem('decentrachat_address', address);
}

/**
 * Send an encrypted message to a recipient
 * Uses P2P if connected, falls back to server relay
 * Now supports Double Ratchet / PFS (Task 12)
 */
export async function sendEncryptedMessage(senderAddress, recipientAddress, plainText, replyTo = null, metadata = {}, fallbackPubKey = null) {
    // Capture timestamp ONCE
    const now = Date.now();

    // Get our keys (Identity Keys)
    const myKeys = await getStoredKeys();
    if (!myKeys) {
        throw new Error('No encryption keys found. Please reconnect your wallet.');
    }

    // --- TASK 12 & 13: Double Ratchet Flow (Restoring Future Secrecy) ---
    
    // 1. Check for established DR session
    let ratchetData = await encryptRatchet(recipientAddress, plainText);
    let x3dhHeader = null;

    // 2. If no session, perform X3DH Handshake
    if (!ratchetData) {
        console.log(`🤝 Initiating X3DH handshake with ${recipientAddress.slice(0, 10)}...`);
        try {
            const preKey = await socketService.fetchPreKey(recipientAddress);
            const peerInfo = await socketService.getUser(recipientAddress);
            const peerIK = peerInfo?.publicKey;
            const peerSigningKey = peerInfo?.signingPublicKey;
            
            if (peerIK && peerSigningKey) {
                // Verify pre-key signature if available (MITM protection)
                if (preKey?.signature) {
                    const isValid = verifyPreKeySignature(preKey.publicKey, preKey.signature, peerSigningKey);
                    if (!isValid) {
                        console.error('🛡️ MITM ALERT: Pre-key signature verification FAILED!');
                        throw new Error('Security Error: Potential identity hijacking detected.');
                    }
                }

                const ephemeralKey = generateKeyPair();
                const sharedSecret = deriveX3DHSecret(
                    myKeys,         // my IK
                    ephemeralKey,   // my EK
                    peerIK,         // peer IK
                    peerIK,         // peer SPK (using IK as fallback)
                    preKey?.publicKey // peer OPK
                );

                x3dhHeader = {
                    ephemeralKey: ephemeralKey.publicKey,
                    preKeyId: preKey?.keyId
                };

                await createSession(recipientAddress, sharedSecret, peerIK, x3dhHeader);
                ratchetData = await encryptRatchet(recipientAddress, plainText);
            }
        } catch (err) {
            console.warn('X3DH handshake failed:', err.message);
        }
    }

    // 3. Prepare Payload
    const messageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
    const senderUsername = localStorage.getItem('decentrachat_username') || null;

    const payload = {
        id: messageId,
        senderUsername,
        replyTo,
        timestamp: now,
        groupId: metadata.groupId,
        groupName: metadata.groupName,
        members: metadata.members,
        from: senderAddress,
        type: metadata.type || 'text',
        mediaId: metadata.mediaId,
        manifest: metadata.manifest,
        x3dh: x3dhHeader
    };

    if (ratchetData) {
        payload.ratchet = ratchetData;
        payload.senderPublicKey = myKeys.publicKey;
    } else {
        // Fallback: Legacy static encryption (only if X3DH fails and session is lost)
        let recipientPubKey = await socketService.getPublicKey(recipientAddress) || fallbackPubKey;
        
        if (!recipientPubKey) {
            // Queue for offline delivery in outbox (plaintext - re-encrypt on flush)
            const outboxMsg = { ...payload, to: recipientAddress, content: plainText, status: 'pending', transport: 'queued' };
            await savePendingMessage(outboxMsg);
            const err = new Error('User is offline and has no pre-keys. Message queued.');
            err.level = 'info';
            throw err;
        }

        const legacy = encryptMessage(plainText, recipientPubKey, myKeys.secretKey);
        payload.encrypted = legacy.encrypted;
        payload.nonce = legacy.nonce;
        payload.senderPublicKey = myKeys.publicKey;
    }

    // Track for deduplication
    sentMessageIds.add(messageId);
    if (sentMessageIds.size > 5000) {
        sentMessageIds.delete(sentMessageIds.keys().next().value);
    }

    // 4. Dispatch (P2P, Waku, or Relay)
    const p2pSent = webrtcService.sendToPeer(recipientAddress, { ...payload, to: recipientAddress });

    // Always use Waku as a redundant transport for reliability and metadata privacy
    const wakuSent = await wakuService.sendViaWaku({ ...payload, to: recipientAddress }, recipientAddress, senderAddress, false);
    
    if (!p2pSent && !wakuSent) {
        if (socketService.isConnected()) {
            console.log('📡 Using server relay for message delivery');
            socketService.sendMessage(recipientAddress, payload);
        } else {
            console.warn('⚠️ All transports failed. Queuing in outbox.');
            const outboxMessage = { ...payload, to: recipientAddress, content: plainText, status: 'pending' };
            await savePendingMessage(outboxMessage);
            return { ...outboxMessage, status: 'pending', transport: 'queued' };
        }
    }

    return { 
        ...payload, 
        to: recipientAddress, 
        content: plainText, 
        status: 'sent', 
        transport: p2pSent ? 'p2p' : 'relay' 
    };
}

/**
 * Task 3: O(1) Send Group Message using Symmetric Epoch Keys
 */
export async function sendGroupMessage(groupId, plainText, members, replyTo = null, metadata = {}) {
    const myKeys = await getStoredKeys();
    if (!myKeys) throw new Error('No encryption keys found');

    let epochKey = await getActiveGroupEpochKey(groupId);
    let isNewKey = false;

    // Trigger auto-rotation tripwire (e.g. 100 messages) 
    // We'll store message count in localStorage for simplicity
    const tripwireKey = `tripwire_${groupId}`;
    let msgCount = parseInt(localStorage.getItem(tripwireKey) || '0');

    if (!epochKey || msgCount >= 100) {
        // Generate new Epoch Key
        epochKey = generateEpochKey();
        await saveGroupEpochKey(groupId, epochKey, msgCount); // Save locally
        isNewKey = true;
        localStorage.setItem(tripwireKey, '0');
        console.log(`🔐 Generated new Symmetric Epoch Key for group ${groupId}`);
    } else {
        localStorage.setItem(tripwireKey, (msgCount + 1).toString());
    }

    // If new key, distribute it to all members securely via pairwise Double Ratchet
    if (isNewKey) {
        console.log(`📡 Distributing new Epoch Key to ${members.length - 1} members...`);
        const distributionPromises = members
            .filter(m => m.toLowerCase() !== myKeys.address.toLowerCase())
            .map(memberAddr => sendEncryptedMessage(
                myKeys.address,
                memberAddr,
                epochKey, // Send the key itself
                null,
                { type: 'EPOCH_KEY_DISTRIBUTION', groupId }
            ));
        
        await Promise.allSettled(distributionPromises);
    }

    // 1. Ratchet the key FORWARD for Forward Secrecy before encrypting this message
    const nextKey = await ratchetEpochKey(epochKey);
    await saveGroupEpochKey(groupId, nextKey, msgCount + 1);

    // 2. Encrypt the message payload O(1) time
    // FIX: Use signingSecretKey for Ed25519 signatures
    const now = Date.now();
    const messageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;
    const { ciphertext, nonce, signature } = await encryptGroupMessage(nextKey, plainText, myKeys.signingSecretKey, messageId, now);
    
    const payload = {
        id: messageId,
        senderUsername: localStorage.getItem('decentrachat_username') || null,
        timestamp: now,
        groupId,
        groupName: metadata.groupName,
        from: myKeys.address,
        type: metadata.type || 'text',
        groupRatchet: {
            ciphertext,
            nonce,
            signature,
            senderSigningPublicKey: myKeys.signingPublicKey // Used for signature verification
        },
        mediaId: metadata.mediaId,
        manifest: metadata.manifest,
        replyTo
    };

    // Track for deduplication
    sentMessageIds.add(payload.id);

    // 3. O(1) Transmission: Try Waku first, fallback to Server Fan-out
    const wakuSent = await wakuService.sendViaWaku(payload, groupId, myKeys.address, true);
    
    if (!wakuSent) {
        if (socketService.isConnected()) {
            socketService.sendGroupMessage(groupId, members, payload);
        } else {
            // Queue for offline delivery
            const outboxMsg = { ...payload, to: groupId, content: plainText, status: 'pending', transport: 'queued' };
            await savePendingMessage(outboxMsg);
            return { ...outboxMsg, status: 'pending', transport: 'queued' };
        }
    }

    return { 
        ...payload, 
        to: groupId, 
        content: plainText, 
        status: 'sent', 
        transport: 'relay' 
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

    socketService.sendTypingStatus(toAddress, isTyping, groupId);
}

/**
 * Subscribe to typing status updates
 * @param {Function} callback - ({ from, isTyping, groupId }) => void
 */
export function onTypingStatus(callback) {
    socketService.onTypingStatus((data) => {
        callback({
            from: data.from,
            isTyping: data.signal.isTyping,
            groupId: data.signal.groupId
        });
    });
}

/**
 * Decrypt a received message with Ratchet support (Task 12)
 */
export async function decryptReceivedMessage(encryptedMessage, cachedKeys = null, myAddress = null) {
    if (!encryptedMessage) return null;

    const myKeys = cachedKeys || await getStoredKeys();
    if (!myKeys) throw new Error('No encryption keys found.');

    // Handle status-only updates
    if (!encryptedMessage.encrypted && !encryptedMessage.ratchet && !encryptedMessage.groupRatchet && encryptedMessage.status) {
        return { ...encryptedMessage, decryptionFailed: false };
    }

    // --- Task 3: O(1) Group Encryption (Symmetric Epoch Keys) ---
    if (encryptedMessage.groupRatchet) {
        const { ciphertext, nonce, signature, senderSigningPublicKey } = encryptedMessage.groupRatchet;
        
        // 1. Fetch the active epoch key for this group
        let epochKey = await getActiveGroupEpochKey(encryptedMessage.groupId);
        
        if (epochKey) {
            // FIX: Use senderSigningPublicKey for Ed25519 verification
            const decrypted = await decryptGroupMessage(epochKey, ciphertext, nonce, signature, senderSigningPublicKey, encryptedMessage.id, encryptedMessage.timestamp);
            
            if (decrypted) {
                return { ...encryptedMessage, content: decrypted, decryptionFailed: false, type: encryptedMessage.type || 'text' };
            }
        }
        
        return { ...encryptedMessage, content: '[Unable to decrypt group message: Missing Epoch Key]', decryptionFailed: true };
    }

    // --- TASK 12: Handle Ratchet / X3DH / Layer 3 Epoch ---
    // 1. Process X3DH Handshake if present
    if (encryptedMessage.x3dh) {
        try {
            const { ephemeralKey, preKeyId } = encryptedMessage.x3dh;
            console.log(`🤝 Responding to X3DH handshake from ${encryptedMessage.from.slice(0, 10)}...`);
            
            // Retrieve the OPK secret that the server consumed
            let opkSecret = null;
            if (preKeyId !== undefined && preKeyId !== null) {
                opkSecret = await consumePreKeySecret(preKeyId);
            }

            const peerIK = encryptedMessage.senderPublicKey || await socketService.getPublicKey(encryptedMessage.from);

            // As responder, derive the same X3DH secret using the responder variant
            const sharedSecret = deriveX3DHResponderSecret(
                myKeys,                      // my IK
                { secretKey: myKeys.secretKey }, // my SPK (using IK as fallback)
                opkSecret || null,            // my OPK secret
                peerIK,                       // peer IK
                ephemeralKey                  // peer EK (from payload)
            );

            // If a Double Ratchet payload was provided, initialize the DR session responder
            if (encryptedMessage.ratchet) {
                await createSessionResponder(
                    encryptedMessage.from,
                    sharedSecret,
                    encryptedMessage.ratchet.header.ratchetKey,
                    myKeys.secretKey // Pass Bob's IK (used as SPK fallback)
                );
            }

            // Always seed the Epoch session immediately after X3DH
            await initEpochSession(encryptedMessage.from, encodeBase64(sharedSecret.slice(0, 32)));
        } catch (err) {
            console.error('X3DH handshake response failed:', err);
        }
    }

    // 2. Check for Epoch Ratchet Data
    if (encryptedMessage.epochRatchet) {
        try {
            const decrypted = await decryptEpoch(encryptedMessage.from, encryptedMessage.epochRatchet);
            if (decrypted) {
                return { ...encryptedMessage, content: decrypted, decryptionFailed: false };
            }
        } catch (err) {
            console.error('Epoch Ratchet decryption failed:', err);
        }
    }

    // 3. Check for Double Ratchet Data
    if (encryptedMessage.ratchet) {
        try {
            const decrypted = await decryptRatchet(encryptedMessage.from, encryptedMessage.ratchet);
            if (decrypted) {
                return { ...encryptedMessage, content: decrypted, decryptionFailed: false };
            }
        } catch (err) {
            console.error('Ratchet decryption failed:', err);
        }
    }

    // --- Legacy Decryption Fallback ---
    const walletAddress = myAddress || myKeys.address;
    const iAmSender = walletAddress && encryptedMessage.from?.toLowerCase() === walletAddress.toLowerCase();
    
    let otherPartyPublicKey = encryptedMessage.senderPublicKey;
    if (iAmSender) otherPartyPublicKey = await socketService.getPublicKey(encryptedMessage.to);

    if (!otherPartyPublicKey) {
        return { ...encryptedMessage, content: '[Unable to decrypt: sender key not found]', decryptionFailed: true };
    }

    try {
        const decryptedContent = decryptMessage(
            encryptedMessage.encrypted,
            encryptedMessage.nonce,
            otherPartyPublicKey,
            myKeys.secretKey
        );

        if (!decryptedContent) {
            return { ...encryptedMessage, content: '[Unable to decrypt message - Key mismatch]', decryptionFailed: true };
        }

        const type = encryptedMessage.type || 'text';

        // Intercept EPOCH_KEY_DISTRIBUTION control messages
        if (type === 'EPOCH_KEY_DISTRIBUTION' && encryptedMessage.groupId) {
            console.log(`🔐 Received new Epoch Key for group ${encryptedMessage.groupId}`);
            await saveGroupEpochKey(encryptedMessage.groupId, decryptedContent, 0);
            return null; // Don't show in UI
        }

        return { ...encryptedMessage, content: decryptedContent, decryptionFailed: false, type };
    } catch {
        return { ...encryptedMessage, content: '[Decryption Error]', decryptionFailed: true };
    }
}

/**
 * Proactively verify if a recipient's public key has changed on the server
 * @param {string} address - Recipient address
 * @param {Object} localContact - Current local contact record
 * @returns {Promise<boolean>} True if key changed, false otherwise
 */
export async function verifyRecipientKey(address, localContact) {
    if (!address || !socketService.isConnected()) return false;

    try {
        const serverKey = await socketService.getPublicKey(address);
        if (serverKey && localContact && serverKey !== localContact.publicKey) {
            console.warn(`🔐 Security Key Change detected for ${address?.slice(0, 10)}!`);
            return true;
        }
    } catch (err) {
        console.warn('Failed to verify recipient key:', err);
    }
    return false;
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
        
        // --- Layer 4: Swarm Sync Routing ---
        if (msg.type === 'SWARM_SYNC_VECTOR') {
            const myKeys = await getStoredKeys();
            handleIncomingVector(msg, myKeys.address);
            return;
        }
        if (msg.type === 'SWARM_SYNC_UPDATE') {
            handleIncomingUpdate(msg, onMessage);
            return;
        }

        processedIds.add(msg.id);
        if (processedIds.size > 5000) {
            processedIds.delete(processedIds.keys().next().value);
        }

        const decrypted = await decryptReceivedMessage(msg, myKeys);
        if (decrypted) {
            onMessage(decrypted);
        }
    };

    // Listen to server relay
    socketService.onMessage(handleMessage);
    
    // Listen to group messages
    socketService.onGroupMessage(handleMessage);

    // Listen to Waku mesh
    wakuService.onWakuMessage(handleMessage);

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
            if (!encrypted && msg.content && !msg.ratchet) {
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
                ...msg,
                encrypted: encrypted,
                nonce: nonce,
                senderPublicKey: msg.senderPublicKey || myKeys.publicKey,
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
 * @param {string} chatId - (Optional) Conversation container ID
 */
export function sendDeliveryReceipt(senderAddress, messageId, chatId = null) {
    socketService.sendReceipt(messageId, senderAddress, 'delivered', chatId);
}

/**
 * Send a read receipt
 * @param {string} senderAddress - Original sender's address
 * @param {string} messageId
 * @param {string} chatId - (Optional) Conversation container ID
 */
export function sendReadReceipt(senderAddress, messageId, chatId = null) {
    socketService.sendReceipt(messageId, senderAddress, 'read', chatId);
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
