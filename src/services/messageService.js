import { 
    encryptMessage, 
    decryptMessage, 
    generatePreKeyBundle, 
    deriveX3DHSecret,
    deriveX3DHResponderSecret,
    generateKeyPair,
    verifyPreKeySignature
} from '../crypto/crypto';
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';
import { cryptoWorker } from '../crypto/cryptoWorkerClient';
import {
    initEpochSession,
    encryptEpoch,
    decryptEpoch
} from '../crypto/epochRatchet';
import { getStoredKeys } from '../crypto/keyManager';
import * as socketService from './socketService';
import * as webrtcService from './webrtcService';
import * as wakuService from './wakuService';
import { savePendingMessage, getPendingMessages, removePendingMessage, getLocalHistory } from './storageService';
import { getLatestMessageHash } from './stateEngine';
import { generateEpochKey, ratchetEpochKey, encryptGroupMessage, decryptGroupMessage } from '../crypto/groupRatchet';
import { saveGroupEpochKey, getActiveGroupEpochKey } from './groupKeyStore';

import { handleIncomingVector, handleIncomingUpdate } from './swarmSync';

// Track sent message IDs for deduplication
const sentMessageIds = new Set();
const pendingHandshakes = new Map();

/**
 * Initialize messaging services and upload pre-keys
 */
export async function initMessaging() {
    // Initialize WebRTC service (sets up signal listener)
    webrtcService.init();

    // Initialize Waku mesh network (Layer 4)
    wakuService.initWaku();

    // --- X3DH setup: Upload Pre-Key Bundle ---
    const myKeys = await getStoredKeys();
    if (myKeys) {
        // Sign bundle with Ed25519 signing secret key
        const bundle = generatePreKeyBundle(myKeys.signingSecretKey, 30);

        // Upload ONLY public keys AND signatures to the server
        socketService.uploadPreKeys(bundle.oneTimePreKeys.map(pk => ({
            keyId: pk.id,
            publicKey: pk.publicKey,
            signature: pk.signature
        })));

        console.log('🔐 Messaging initialized: Uploaded signed pre-key bundle for X3DH');
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
 * Routes exclusively through Epoch Ratchet
 */
export async function sendEncryptedMessage(senderAddress, recipientAddress, plainText, replyTo = null, metadata = {}, fallbackPubKey = null) {
    // Capture timestamp ONCE
    const now = Date.now();

    // Get our keys (Identity Keys)
    const myKeys = await getStoredKeys();
    if (!myKeys) {
        throw new Error('No encryption keys found. Please reconnect your wallet.');
    }

    // --- Layer 3: Epoch Ratchet Flow ---
    
    // 1. Try Epoch Ratchet (Primary V3 transport)
    let epochData = await encryptEpoch(`${recipientAddress}_tx`, plainText);
    let x3dhHeader = null;

    // 2. If no session exists, perform X3DH Handshake
    if (!epochData) {
        if (pendingHandshakes.has(recipientAddress)) {
            console.log(`⏳ Waiting for existing X3DH handshake with ${recipientAddress.slice(0, 10)}...`);
            await pendingHandshakes.get(recipientAddress);
            // Retry encryption after handshake
            epochData = await encryptEpoch(`${recipientAddress}_tx`, plainText);
        }
        
        if (!epochData) {
            console.log(`🤝 Initiating X3DH handshake with ${recipientAddress.slice(0, 10)}...`);
            const handshakePromise = (async () => {
                try {
                    const preKey = await socketService.fetchPreKey(recipientAddress); // This is the OPK
                    const peerInfo = await socketService.getUser(recipientAddress);
                    const peerIK = peerInfo?.publicKey;
                    const peerSigningKey = peerInfo?.signingPublicKey;
                    
                    if (peerIK && peerSigningKey) {
                        // --- V3 Hardening: Distinct SPK ---
                        const peerSPK = peerInfo?.signedPreKey;
                        const peerSPKSignature = peerInfo?.signedPreKeySignature;

                        if (!peerSPK) {
                            console.error('🛡️ Security Error: Peer does not have a distinct Signed Pre-Key (SPK).');
                            throw new Error('Peer requires a security update to receive messages.');
                        }

                        // Verify SPK signature (MITM protection)
                        if (peerSPKSignature) {
                            const isValid = verifyPreKeySignature(peerSPK, peerSPKSignature, peerSigningKey);
                            if (!isValid) {
                                console.error('🛡️ MITM ALERT: SPK signature verification FAILED!');
                                throw new Error('Security Error: Potential identity hijacking detected.');
                            }
                        }

                        // If we also fetched an OPK, verify its signature too
                        if (preKey?.signature) {
                            const isValid = verifyPreKeySignature(preKey.publicKey, preKey.signature, peerSigningKey);
                            if (!isValid) {
                                console.error('🛡️ MITM ALERT: OPK signature verification FAILED!');
                                throw new Error('Security Error: Potential identity hijacking detected.');
                            }
                        }

                        const ephemeralKey = generateKeyPair();
                        
                        const sharedSecret = await deriveX3DHSecret(
                            myKeys,         // my IK
                            ephemeralKey,   // my EK
                            peerIK,         // peer IK
                            peerSPK,        // peer SPK (distinct from IK)
                            preKey?.publicKey || null // peer OPK (optional)
                        );
                        console.log(`🔑 X3DH Initiator: sharedSecret[0:4] = ${encodeBase64(sharedSecret.slice(0, 4))}`);

                        x3dhHeader = {
                            ephemeralKey: ephemeralKey.publicKey,
                            preKeyId: preKey?.keyId
                        };

                        // Initialize Epoch session
                        const sharedB64 = encodeBase64(sharedSecret.slice(0, 32));
                        const myAddr = localStorage.getItem('decentrachat_address') || senderAddress;
                        const isSmaller = myAddr.toLowerCase() < recipientAddress.toLowerCase();
                        const txLabel = isSmaller ? 'epoch_A_tx' : 'epoch_B_tx';
                        const rxLabel = isSmaller ? 'epoch_B_tx' : 'epoch_A_tx';
                        
                        const txRoot = await cryptoWorker.hmacSha256(sharedB64, txLabel);
                        const rxRoot = await cryptoWorker.hmacSha256(sharedB64, rxLabel);

                        await initEpochSession(`${recipientAddress}_tx`, txRoot);
                        await initEpochSession(`${recipientAddress}_rx`, rxRoot);
                        
                        // V3 Hardening: Add a small "settling buffer" for mobile IndexedDB.
                        await new Promise(r => setTimeout(r, 150));
                        return { x3dhHeader };
                    }
                } catch (err) {
                    console.warn('X3DH handshake failed:', err.message);
                    throw err;
                }
            })();
            pendingHandshakes.set(recipientAddress, handshakePromise);
            
            try {
                const res = await handshakePromise;
                if (res) x3dhHeader = res.x3dhHeader;
            } catch (err) {
                // Handshake error already logged inside
            } finally {
                pendingHandshakes.delete(recipientAddress);
            }
            
            if (x3dhHeader) {
                // Encrypt with new Epoch session
                epochData = await encryptEpoch(`${recipientAddress}_tx`, plainText);
            }
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
        x3dh: x3dhHeader,
        parentHash: await getLatestMessageHash(recipientAddress) // Attach Merkle DAG parent
    };

    if (epochData) {
        payload.epochRatchet = epochData;
        payload.senderPublicKey = myKeys.publicKey;
    } else {
        // Fallback: Legacy static encryption (only if X3DH fails and session is lost)
        let recipientPubKey = await socketService.getPublicKey(recipientAddress) || fallbackPubKey;
        
        if (!recipientPubKey) {
            // Queue for offline delivery in outbox (plaintext - re-encrypt on flush)
            const outboxMsg = { ...payload, to: recipientAddress, content: plainText, status: 'pending', transport: 'queued' };
            await savePendingMessage(outboxMsg);
            const err = new Error('User is offline and has no pre-keys. Message queued.');
            console.warn(err.message);
            return { ...outboxMsg, queued: true };
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

    // 4. Sequential Dispatch (Hardened for Mobile Reliability)
    console.log(`📤 Dispatching message to ${recipientAddress.slice(0, 10)}...`);
    
    // First, try live WebRTC (Best performance, no relay)
    const p2pSent = webrtcService.sendToPeer(recipientAddress, { ...payload, to: recipientAddress });
    if (p2pSent) {
        console.log('✅ Also delivered via direct P2P');
    }

    // Use Waku (Gossip) sequentially
    const isNewSession = !!x3dhHeader;
    const wakuTopicAddress = isNewSession ? null : senderAddress;
    const wakuSent = await wakuService.sendViaWaku({ ...payload, to: recipientAddress }, recipientAddress, wakuTopicAddress, false);
    
    // V3 Hardening: If new session, also broadcast to the Discovery topic fallback
    if (isNewSession && wakuSent) {
        await wakuService.sendViaWaku({ ...payload, to: recipientAddress }, recipientAddress, null, false);
    }

    // Final Redundancy: Server Relay
    let relaySent = false;
    if (socketService.isConnected()) {
        console.log('📡 Using server relay for redundant delivery');
        socketService.sendMessage(recipientAddress, payload);
        relaySent = true;
    } 

    if (!wakuSent && !relaySent && !p2pSent) {
        console.warn('⚠️ All transports failed. Queuing in outbox.');
        const outboxMessage = { ...payload, to: recipientAddress, content: plainText, status: 'pending' };
        await savePendingMessage(outboxMessage);
        return { ...outboxMessage, status: 'pending', transport: 'queued' };
    }

    return { 
        ...payload, 
        to: recipientAddress, 
        content: plainText, 
        status: 'sent', 
        transport: p2pSent ? 'p2p' : (wakuSent ? 'mesh' : 'relay') 
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
    const history = await getLocalHistory(groupId);
    let msgCount = history.length;

    if (!epochKey || (msgCount > 0 && msgCount % 100 === 0)) {
        // Generate new Epoch Key
        epochKey = generateEpochKey();
        await saveGroupEpochKey(groupId, epochKey, msgCount); // Save locally
        isNewKey = true;
        console.log(`🔐 Generated new Symmetric Epoch Key for group ${groupId} at sequence ${msgCount}`);
    }

    // If new key, distribute it to all members securely
    if (isNewKey) {
        console.log(`📡 Distributing new Epoch Key to ${members.length - 1} members...`);
        const distributionPromises = members
            .filter(m => m.toLowerCase() !== myKeys.address.toLowerCase())
            .map(memberAddr => sendEncryptedMessage(
                myKeys.address,
                memberAddr,
                epochKey, // Send the key itself
                null,
                { type: 'EPOCH_KEY_DISTRIBUTION', groupId, sequence: msgCount }
            ));
        
        await Promise.allSettled(distributionPromises);
    }

    // 1. Ratchet the key FORWARD for Forward Secrecy before encrypting this message
    const nextKey = await ratchetEpochKey(epochKey);
    await saveGroupEpochKey(groupId, nextKey, msgCount + 1);

    // 2. Encrypt the message payload O(1) time
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
            senderSigningPublicKey: myKeys.signingPublicKey, // Used for signature verification
            sequence: msgCount
        },
        mediaId: metadata.mediaId,
        manifest: metadata.manifest,
        replyTo,
        parentHash: await getLatestMessageHash(groupId) // Attach Merkle DAG parent
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
 */
export function sendTypingStatus(toAddress, isTyping, groupId = null) {
    if (!socketService.isConnected()) return;
    socketService.sendTypingStatus(toAddress, isTyping, groupId);
}

/**
 * Subscribe to typing status updates
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
 * Decrypt a received message with Ratchet support
 */
export async function decryptReceivedMessage(encryptedMessage, cachedKeys = null, myAddress = null) {
    if (!encryptedMessage) return null;

    const myKeys = cachedKeys || await getStoredKeys();
    if (!myKeys) throw new Error('No encryption keys found.');

    // Handle status-only updates
    if (!encryptedMessage.encrypted && !encryptedMessage.epochRatchet && !encryptedMessage.groupRatchet && encryptedMessage.status) {
        return { ...encryptedMessage, decryptionFailed: false };
    }

    // --- Task 3: O(1) Group Encryption (Symmetric Epoch Keys) ---
    if (encryptedMessage.groupRatchet) {
        const { ciphertext, nonce, signature, senderSigningPublicKey, sequence } = encryptedMessage.groupRatchet;
        
        let epochKey = await getActiveGroupEpochKey(encryptedMessage.groupId);
        
        if (epochKey && sequence !== undefined) {
            const history = await getLocalHistory(encryptedMessage.groupId);
            const localSequence = history.length;
            
            if (sequence > localSequence) {
                const diff = sequence - localSequence;
                console.log(`🔄 Catching up group ratchet by ${diff} steps for group ${encryptedMessage.groupId}...`);
                for (let i = 0; i < diff; i++) {
                    epochKey = await ratchetEpochKey(epochKey);
                }
                await saveGroupEpochKey(encryptedMessage.groupId, epochKey, sequence);
            }
        }
        
        if (epochKey) {
            const decrypted = await decryptGroupMessage(epochKey, ciphertext, nonce, signature, senderSigningPublicKey, encryptedMessage.id, encryptedMessage.timestamp);
            if (decrypted) {
                return { ...encryptedMessage, content: decrypted, decryptionFailed: false, type: encryptedMessage.type || 'text' };
            }
        }
        
        return { ...encryptedMessage, content: '[Unable to decrypt group message: Missing Epoch Key]', decryptionFailed: true };
    }

    // --- X3DH / Layer 3 Epoch ---
    // 1. Process X3DH Handshake if present
    if (encryptedMessage.x3dh) {
        try {
            const { ephemeralKey, preKeyId } = encryptedMessage.x3dh;
            console.log(`🤝 Responding to X3DH handshake from ${encryptedMessage.from.slice(0, 10)}...`);
            
            const peerIK = encryptedMessage.senderPublicKey || await socketService.getPublicKey(encryptedMessage.from);

            const sharedSecret = await deriveX3DHResponderSecret(
                myKeys,                      // my IK
                { secretKey: myKeys.signedPreKeySecret || myKeys.secretKey }, // my SPK
                null,                         // OPK secret
                peerIK,                       // peer IK
                ephemeralKey                  // peer EK (from payload)
            );
            console.log(`🔑 X3DH Responder: sharedSecret[0:4] = ${encodeBase64(sharedSecret.slice(0, 4))}`);

            // Always seed the Epoch session immediately after X3DH
            const sharedB64 = encodeBase64(sharedSecret.slice(0, 32));
            const myAddr = localStorage.getItem('decentrachat_address') || encryptedMessage.to;
            const isSmaller = myAddr.toLowerCase() < encryptedMessage.from.toLowerCase();
            const txLabel = isSmaller ? 'epoch_A_tx' : 'epoch_B_tx';
            const rxLabel = isSmaller ? 'epoch_B_tx' : 'epoch_A_tx';
            
            const txRoot = await cryptoWorker.hmacSha256(sharedB64, txLabel);
            const rxRoot = await cryptoWorker.hmacSha256(sharedB64, rxLabel);

            await initEpochSession(`${encryptedMessage.from}_tx`, txRoot);
            await initEpochSession(`${encryptedMessage.from}_rx`, rxRoot);
        } catch (err) {
            console.error('X3DH handshake response failed:', err);
        }
    }

    // 2. Check for Epoch Ratchet Data
    if (encryptedMessage.epochRatchet) {
        try {
            const decrypted = await decryptEpoch(`${encryptedMessage.from}_rx`, encryptedMessage.epochRatchet);
            if (decrypted) {
                return { ...encryptedMessage, content: decrypted, decryptionFailed: false };
            }
            console.warn(`🛠️ Epoch decryption failed for ${encryptedMessage.from.slice(0, 10)}.`);
        } catch (err) {
            console.error('Epoch Ratchet decryption failed:', err);
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
            const seq = encryptedMessage.sequence || 0;
            await saveGroupEpochKey(encryptedMessage.groupId, decryptedContent, seq);
            return null; // Don't show in UI
        }

        return { ...encryptedMessage, content: decryptedContent, decryptionFailed: false, type };
    } catch {
        return { ...encryptedMessage, content: '[Decryption Error]', decryptionFailed: true };
    }
}

/**
 * Verify if recipient key changed
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
 * Subscribe to incoming messages
 */
export function subscribeToMessages(onMessage, myKeys) {
    const processedIds = new Set();
    const handleMessage = async (msg) => {
        if (sentMessageIds.has(msg.id)) return;
        if (processedIds.has(msg.id)) return;
        
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
        if (processedIds.size > 5000) processedIds.delete(processedIds.keys().next().value);

        const decrypted = await decryptReceivedMessage(msg, myKeys);
        if (decrypted) onMessage(decrypted);
    };

    socketService.onMessage(handleMessage);
    socketService.onGroupMessage(handleMessage);
    wakuService.onWakuMessage(handleMessage);
    webrtcService.onData(handleMessage);
}

/**
 * P2P helpers
 */
export async function connectToPeer(theirAddress) { return await webrtcService.connectToPeer(theirAddress); }
export function getConnectionType(peerAddress) { return webrtcService.getConnectionType(peerAddress); }

/**
 * Search user
 */
export async function searchUser(query) {
    const trimmed = query.trim();
    if (trimmed.startsWith('0x') && trimmed.length === 42) return await socketService.getUser(trimmed);
    if (trimmed.length >= 3) {
        const username = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
        return await socketService.lookupByUsername(username);
    }
    return null;
}

/**
 * Get history
 */
export async function getHistory(peerAddress) { return await socketService.getHistory(peerAddress); }

/**
 * Flush pending messages
 */
export async function flushPendingMessages(senderAddress, onFlushed = null) {
    const pending = await getPendingMessages();
    if (pending.length === 0) return { sent: 0, failed: 0 };
    let sent = 0; let failed = 0;
    const myKeys = await getStoredKeys();
    if (!myKeys) return { sent: 0, failed: pending.length };

    for (const msg of pending) {
        try {
            if (!socketService.isConnected()) { failed++; continue; }
            let encrypted = msg.encrypted;
            let nonce = msg.nonce;

            if (!encrypted && msg.content && !msg.epochRatchet) {
                const recipientPubKey = await socketService.getPublicKey(msg.to);
                if (!recipientPubKey) { failed++; continue; }
                const encryptedData = encryptMessage(msg.content, recipientPubKey, myKeys.secretKey);
                encrypted = encryptedData.encrypted; nonce = encryptedData.nonce;
            }

            const relayPayload = { ...msg, encrypted, nonce, senderPublicKey: msg.senderPublicKey || myKeys.publicKey };
            socketService.sendMessage(msg.to, relayPayload);
            await removePendingMessage(msg.id);
            sent++;
            if (onFlushed) onFlushed({ id: msg.id, status: 'sent' });
        } catch (err) { failed++; }
    }
    return { sent, failed };
}

/**
 * Receipts
 */
export function sendDeliveryReceipt(senderAddress, messageId, chatId = null) { socketService.sendReceipt(messageId, senderAddress, 'delivered', chatId); }
export function sendReadReceipt(senderAddress, messageId, chatId = null) { socketService.sendReceipt(messageId, senderAddress, 'read', chatId); }
export function onMessageReceipt(callback) { socketService.onReceipt(callback); }
export function onConnectionChange(callback) { socketService.onConnectionChange(callback); }
export function onUserStatus(callback) { return socketService.onUserStatus(callback); }
export async function getUsersStatus(addresses) { return await socketService.getUsersStatus(addresses); }
