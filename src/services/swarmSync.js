/**
 * Swarm Sync Service (Layer 5)
 * Handles direct device-to-device synchronization of Yjs CRDT states.
 * Uses State Vectors to identify missing updates and exchange them over P2P/Mesh.
 */
import * as Y from 'yjs';
import { getActiveEpoch, getLoadedMessages } from './stateEngine';
import * as webrtcService from './webrtcService';
import * as wakuService from './wakuService';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8 } from 'tweetnacl-util';
import { getStoredKeys } from '../crypto/keyManager';
import * as socketService from './socketService';

const SYNC_INTERVAL = 60000; // 60 seconds (conservative for V3)
const activeSyncs = new Map();

/**
 * Initialize swarm sync for a specific conversation.
 * For groups, it periodically broadcasts a state vector to the group topic.
 */
export async function initSwarmSync(chatId, myAddress, peerAddress, isGroup = false) {
    const syncKey = `${chatId}_${peerAddress || 'group'}`;
    if (activeSyncs.has(syncKey)) return activeSyncs.get(syncKey).cleanup;

    console.log(`🐝 SwarmSync: Initializing for ${chatId.slice(0, 10)} ${isGroup ? '(Group)' : `with peer ${peerAddress.slice(0, 10)}`}`);

    const syncState = {
        chatId,
        myAddress,
        peerAddress,
        isGroup,
        interval: null
    };

    // 1. Initial Sync Request
    await sendStateVector(chatId, myAddress, peerAddress, isGroup);

    // 2. Periodic Sync (Keep-alive)
    syncState.interval = setInterval(async () => {
        // If 1-1, only sync if P2P is connected or periodically via Waku
        if (!isGroup) {
            await sendStateVector(chatId, myAddress, peerAddress, false);
        } else {
            // Groups periodically broadcast to the swarm
            await sendStateVector(chatId, myAddress, chatId, true);
        }
    }, SYNC_INTERVAL);

    const cleanup = () => {
        clearInterval(syncState.interval);
        activeSyncs.delete(syncKey);
    };

    activeSyncs.set(syncKey, { cleanup });
    return cleanup;
}

/**
 * Generate and send our current Yjs State Vector to a peer or group.
 */
async function sendStateVector(chatId, myAddress, peerAddress, isGroup) {
    try {
        const epoch = await getActiveEpoch(chatId);
        const stateVector = Y.encodeStateVector(epoch.doc);
        const vectorBase64 = btoa(String.fromCharCode(...stateVector));
        
        const signature = await signCrdtPayload(chatId, 'SWARM_SYNC_VECTOR', vectorBase64);
        
        const payload = {
            type: 'SWARM_SYNC_VECTOR',
            chatId,
            vector: vectorBase64,
            from: myAddress,
            isGroup,
            signature
        };

        if (isGroup) {
            // Group vectors always go to the group Waku topic
            await wakuService.sendViaWaku(payload, chatId, myAddress, true);
        } else {
            // Prioritize WebRTC (P2P) for 1-1 sync
            const p2pSent = webrtcService.sendToPeer(peerAddress, payload);
            if (!p2pSent) {
                await wakuService.sendViaWaku(payload, peerAddress, myAddress, false);
            }
        }
    } catch (err) {
        console.warn('🐝 SwarmSync: Failed to send state vector:', err);
    }
}

/**
 * Handle an incoming State Vector from a peer.
 * If we have updates they are missing, send them back.
 */
export async function handleIncomingVector(payload, myAddress) {
    const { chatId, vector, from: peerAddress, signature, isGroup } = payload;
    
    // Safety: Don't respond to ourselves
    if (peerAddress?.toLowerCase() === myAddress?.toLowerCase()) return;

    const isValid = await verifyCrdtPayload(chatId, 'SWARM_SYNC_VECTOR', vector, signature, peerAddress);
    if (!isValid) {
        console.warn(`🐝 SwarmSync: REJECTED invalid vector signature from ${peerAddress}`);
        return;
    }

    const epoch = await getActiveEpoch(chatId);

    try {
        const remoteVector = Uint8Array.from(atob(vector), c => c.charCodeAt(0));
        const missingUpdate = Y.encodeStateAsUpdate(epoch.doc, remoteVector);

        // 2 bytes is an empty Yjs update (0x00 0x00)
        if (missingUpdate.length > 2) {
            console.log(`🐝 SwarmSync: Providing ${missingUpdate.length} bytes of history to ${peerAddress.slice(0, 10)}`);
            
            const updateBase64 = btoa(String.fromCharCode(...missingUpdate));
            const signature = await signCrdtPayload(chatId, 'SWARM_SYNC_UPDATE', updateBase64);
            
            const response = {
                type: 'SWARM_SYNC_UPDATE',
                chatId,
                update: updateBase64,
                from: myAddress,
                signature
            };

            // If it was a group vector, we still reply to the sender (either P2P or Waku)
            const p2pSent = webrtcService.sendToPeer(peerAddress, response);
            if (!p2pSent) {
                // Reply specifically to the peer's discovery/conversation topic
                await wakuService.sendViaWaku(response, peerAddress, myAddress, false);
            }
        }
    } catch (err) {
        console.error('🐝 SwarmSync: Failed to process incoming vector:', err);
    }
}

/**
 * Handle incoming Yjs updates from Swarm Sync.
 */
export async function handleIncomingUpdate(payload, onUpdate) {
    const { chatId, update, from, signature } = payload;
    
    const isValid = await verifyCrdtPayload(chatId, 'SWARM_SYNC_UPDATE', update, signature, from);
    if (!isValid) {
        console.warn(`🐝 SwarmSync: REJECTED invalid update signature from ${from}`);
        return;
    }

    const epoch = await getActiveEpoch(chatId);

    try {
        const updateArr = Uint8Array.from(atob(update), c => c.charCodeAt(0));
        
        // Apply the update to the Yjs doc
        Y.applyUpdate(epoch.doc, updateArr);
        
        console.log(`🐝 SwarmSync: Applied update for ${chatId.slice(0, 10)} from ${from.slice(0, 10)}`);
        
        // Notify UI to refresh message list
        if (onUpdate) {
            onUpdate({ type: 'SWARM_SYNC_BATCH', chatId });
        }
    } catch (err) {
        console.error('🐝 SwarmSync: Failed to apply incoming update:', err);
    }
}

// --- Signature Helpers ---

async function signCrdtPayload(chatId, type, dataBase64) {
    const keys = await getStoredKeys();
    if (!keys || !keys.signingSecretKey) return null;
    const msg = encodeUTF8(`${chatId}:${type}:${dataBase64}`);
    const signature = nacl.sign.detached(msg, decodeBase64(keys.signingSecretKey));
    return encodeBase64(signature);
}

async function verifyCrdtPayload(chatId, type, dataBase64, signatureBase64, fromAddress) {
    if (!signatureBase64 || !fromAddress) return false;
    
    try {
        const peerInfo = await socketService.getUser(fromAddress);
        if (!peerInfo || !peerInfo.signingPublicKey) return false;
        
        const msg = encodeUTF8(`${chatId}:${type}:${dataBase64}`);
        const sig = decodeBase64(signatureBase64);
        const pub = decodeBase64(peerInfo.signingPublicKey);
        return nacl.sign.detached.verify(msg, sig, pub);
    } catch (err) {
        console.warn('🐝 SwarmSync: Signature verification error:', err);
        return false;
    }
}
