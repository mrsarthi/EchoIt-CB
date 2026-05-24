/**
 * Swarm Sync Service (Layer 4)
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

const SYNC_INTERVAL = 30000; // 30 seconds
const activeSyncs = new Set();

/**
 * Initialize swarm sync for a specific conversation.
 */
export async function initSwarmSync(chatId, myAddress, peerAddress, isGroup = false) {
    const syncKey = `${chatId}_${peerAddress}`;
    if (activeSyncs.has(syncKey)) return;
    activeSyncs.add(syncKey);

    console.log(`🐝 SwarmSync: Initialized for ${chatId.slice(0, 10)} with peer ${peerAddress.slice(0, 10)}`);

    // 1. Initial Sync Request
    await sendStateVector(chatId, myAddress, peerAddress, isGroup);

    // 2. Periodic Sync (Keep-alive)
    const interval = setInterval(async () => {
        if (webrtcService.isPeerConnected(peerAddress)) {
            await sendStateVector(chatId, myAddress, peerAddress, isGroup);
        }
    }, SYNC_INTERVAL);

    return () => {
        clearInterval(interval);
        activeSyncs.delete(syncKey);
    };
}

/**
 * Generate and send our current Yjs State Vector to a peer.
 */
async function sendStateVector(chatId, myAddress, peerAddress, isGroup) {
    const epoch = await getActiveEpoch(chatId);
    const stateVector = Y.encodeStateVector(epoch.doc);
    const vectorBase64 = btoa(String.fromCharCode(...stateVector));
    
    const signature = await signCrdtPayload(chatId, 'SWARM_SYNC_VECTOR', vectorBase64);
    
    const payload = {
        type: 'SWARM_SYNC_VECTOR',
        chatId,
        vector: vectorBase64,
        from: myAddress,
        signature
    };

    // Prioritize WebRTC (P2P) for sync, fallback to Waku
    const p2pSent = webrtcService.sendToPeer(peerAddress, payload);
    if (!p2pSent) {
        await wakuService.sendViaWaku(payload, peerAddress, myAddress, isGroup);
    }
}

/**
 * Handle an incoming State Vector from a peer.
 * If we have updates they are missing, send them back.
 */
export async function handleIncomingVector(payload, myAddress) {
    const { chatId, vector, from: peerAddress, signature } = payload;
    
    const isValid = await verifyCrdtPayload(chatId, 'SWARM_SYNC_VECTOR', vector, signature, peerAddress);
    if (!isValid) {
        console.error(`🐝 SwarmSync: REJECTED invalid vector signature from ${peerAddress}`);
        return;
    }

    const epoch = await getActiveEpoch(chatId);

    try {
        const remoteVector = Uint8Array.from(atob(vector), c => c.charCodeAt(0));
        const missingUpdate = Y.encodeStateAsUpdate(epoch.doc, remoteVector);

        if (missingUpdate.length > 2) { // 2 bytes is an empty update
            console.log(`🐝 SwarmSync: Sending ${missingUpdate.length} bytes of missing updates to ${peerAddress.slice(0, 10)}`);
            
            const updateBase64 = btoa(String.fromCharCode(...missingUpdate));
            const signature = await signCrdtPayload(chatId, 'SWARM_SYNC_UPDATE', updateBase64);
            
            const response = {
                type: 'SWARM_SYNC_UPDATE',
                chatId,
                update: updateBase64,
                from: myAddress,
                signature
            };

            const p2pSent = webrtcService.sendToPeer(peerAddress, response);
            if (!p2pSent) {
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
export async function handleIncomingUpdate(payload, onNewMessages) {
    const { chatId, update, from, signature } = payload;
    
    const isValid = await verifyCrdtPayload(chatId, 'SWARM_SYNC_UPDATE', update, signature, from);
    if (!isValid) {
        console.error(`🐝 SwarmSync: REJECTED invalid update signature from ${from}`);
        return;
    }

    const epoch = await getActiveEpoch(chatId);

    try {
        const updateArr = Uint8Array.from(atob(update), c => c.charCodeAt(0));
        Y.applyUpdate(epoch.doc, updateArr);
        
        console.log(`🐝 SwarmSync: Applied incoming update for ${chatId.slice(0, 10)}`);
        
        // Trigger UI refresh
        if (onNewMessages) {
            onNewMessages(chatId, getLoadedMessages(chatId));
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
    const peerInfo = await socketService.getUser(fromAddress);
    if (!peerInfo || !peerInfo.signingPublicKey) return false;
    
    try {
        const msg = encodeUTF8(`${chatId}:${type}:${dataBase64}`);
        const sig = decodeBase64(signatureBase64);
        const pub = decodeBase64(peerInfo.signingPublicKey);
        return nacl.sign.detached.verify(msg, sig, pub);
    } catch {
        return false;
    }
}
