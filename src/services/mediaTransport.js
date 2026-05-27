import { generateSymmetricKey, encryptSymmetric, decryptSymmetric } from '../crypto/crypto';
import * as webrtcService from './webrtcService';
import * as wakuService from './wakuService';
import { uploadToIPFS, fetchFromIPFS } from './ipfsService';
import localforage from 'localforage';

const WEBRTC_PACKET_SIZE = 16 * 1024; // 16 KB packets for P2P Data Channels
const PINATA_JWT_KEY = 'decentrachat_pinata_jwt';

const mediaStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'media_cache',
});

/**
 * Encrypts a media payload and transmits it.
 * Tries direct WebRTC P2P first, falls back to IPFS (via Pinata).
 */
export async function sliceAndTransmitMedia(base64Data, mimeType, onProgress, recipientAddress = null) {
    console.log('[MediaTransport] Starting upload pipeline...');
    
    const ephemeralKey = generateSymmetricKey();
    const { encrypted, nonce } = encryptSymmetric(base64Data, ephemeralKey);

    const manifest = {
        mediaId: `media_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        mimeType,
        ephemeralKey,
        nonce
    };

    // --- Layer 6: Try Direct P2P Pipe first ---
    if (recipientAddress && webrtcService.isPeerConnected(recipientAddress)) {
        console.log(`[MediaTransport] Peer ${recipientAddress.slice(0, 10)} connected. Attempting P2P direct pipe...`);
        try {
            const p2pSuccess = await pipeMedia(recipientAddress, manifest.mediaId, encrypted, onProgress, 'p2p');
            if (p2pSuccess) {
                manifest.isP2P = true;
                return manifest;
            }
        } catch (err) {
            console.warn('[MediaTransport] P2P pipe failed, falling back to Waku/IPFS:', err.message);
        }
    }

    // --- Layer 6 Fallback 1: Stateless Waku/MQTT Fallback (Chunked) ---
    // If file is reasonably small (< 500KB), try chunked Waku delivery
    if (recipientAddress && encrypted.length < 512000) {
        console.log('[MediaTransport] Attempting chunked Waku delivery...');
        try {
            const wakuSuccess = await pipeMedia(recipientAddress, manifest.mediaId, encrypted, onProgress, 'waku');
            if (wakuSuccess) {
                manifest.isWaku = true;
                return manifest;
            }
        } catch (err) {
            console.warn('[MediaTransport] Waku delivery failed:', err);
        }
    }

    // --- Layer 6 Fallback 2: IPFS (Pinata) ---
    console.log('[MediaTransport] Uploading to IPFS...');
    if (onProgress) onProgress(10); 

    const pinataJwt = localStorage.getItem(PINATA_JWT_KEY);
    if (!pinataJwt) {
        throw new Error("Pinata JWT not found in Settings. Please configure it to send media when peers are offline.");
    }

    try {
        const cid = await uploadToIPFS(encrypted, pinataJwt);
        manifest.cid = cid;
        manifest.isIPFS = true;
        
        if (onProgress) onProgress(100);
        return manifest;
    } catch (err) {
        console.error('[MediaTransport] IPFS Upload failed:', err);
        throw err;
    }
}

/**
 * Directly pipes media data over WebRTC or Waku in small fragments.
 */
async function pipeMedia(peerAddress, mediaId, data, onProgress, transport = 'p2p') {
    const totalSize = data.length;
    const totalPackets = Math.ceil(totalSize / WEBRTC_PACKET_SIZE);
    
    for (let i = 0; i < totalPackets; i++) {
        const start = i * WEBRTC_PACKET_SIZE;
        const end = Math.min(start + WEBRTC_PACKET_SIZE, totalSize);
        const packet = data.slice(start, end);
        
        const payload = {
            type: 'MEDIA_CHUNK',
            mediaId,
            index: i,
            total: totalPackets,
            data: packet
        };

        let success = false;
        if (transport === 'p2p') {
            success = webrtcService.sendToPeer(peerAddress, payload);
        } else {
            // Waku fallback (stateless)
            success = await wakuService.sendViaWaku({ ...payload, to: peerAddress }, peerAddress, null, false);
        }

        if (!success) return false;

        if (onProgress && i % 5 === 0) {
            onProgress(Math.round((i / totalPackets) * 100));
        }
        
        // Prevent flooding
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 20));
    }

    if (onProgress) onProgress(100);
    return true;
}

/**
 * Downloads and decrypts media from manifest.
 */
export async function fetchAndReconstructMedia(manifest, onProgress) {
    // 1. Check Local P2P/Waku Buffer (Persisted in localforage)
    if (manifest.isP2P || manifest.isWaku) {
        console.log('[MediaTransport] Reassembling from local persistent buffer...');
        const buffered = await getMediaBuffer(manifest.mediaId);
        if (buffered) {
            return decryptSymmetric(buffered, manifest.nonce, manifest.ephemeralKey);
        }
    }

    // 2. Check IPFS Fallback
    if (manifest.isIPFS && manifest.cid) {
        console.log('[MediaTransport] Fetching from IPFS CID:', manifest.cid);
        if (onProgress) onProgress(20);
        
        const encryptedData = await fetchFromIPFS(manifest.cid);
        
        if (onProgress) onProgress(80);
        
        const base64Content = encryptedData.split(',')[1];
        const decrypted = decryptSymmetric(base64Content, manifest.nonce, manifest.ephemeralKey);
        if (onProgress) onProgress(100);
        return decrypted;
    }

    throw new Error('Media not available (Offline or still downloading)');
}

/**
 * Handle incoming media chunks and persist them.
 */
export async function handleIncomingMediaChunk(payload) {
    const { mediaId, index, total, data } = payload;
    
    // Key format: chunk_{mediaId}_{index}
    const chunkKey = `chunk_${mediaId}_${index}`;
    await mediaStore.setItem(chunkKey, data);

    // Track progress in meta
    const metaKey = `meta_${mediaId}`;
    const meta = (await mediaStore.getItem(metaKey)) || { received: [], total };
    
    if (!meta.received.includes(index)) {
        meta.received.push(index);
        await mediaStore.setItem(metaKey, meta);
    }

    if (meta.received.length === total) {
        console.log(`[MediaTransport] Media ${mediaId} fully received (${total} chunks)`);
        // Notify UI if needed (could use an event emitter here)
    }
}

async function getMediaBuffer(mediaId) {
    const metaKey = `meta_${mediaId}`;
    const meta = await mediaStore.getItem(metaKey);
    
    if (!meta || meta.received.length < meta.total) {
        console.warn(`[MediaTransport] Media ${mediaId} incomplete: ${meta?.received.length || 0}/${meta?.total || 0}`);
        return null;
    }

    // Reconstruct
    let fullData = '';
    for (let i = 0; i < meta.total; i++) {
        const chunk = await mediaStore.getItem(`chunk_${mediaId}_${i}`);
        if (!chunk) return null;
        fullData += chunk;
    }

    // Cleanup (Optional - maybe keep for a while?)
    // await cleanupMedia(mediaId, meta.total);

    return fullData;
}

async function cleanupMedia(mediaId, total) {
    await mediaStore.removeItem(`meta_${mediaId}`);
    for (let i = 0; i < total; i++) {
        await mediaStore.removeItem(`chunk_${mediaId}_${i}`);
    }
}
