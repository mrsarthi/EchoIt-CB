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
export async function sliceAndTransmitMedia(base64Data, mimeType, onProgress, recipientAddress = null, predefinedMediaId = null) {
    console.log('[MediaTransport] Starting upload pipeline...');
    
    const ephemeralKey = generateSymmetricKey();
    const { encrypted, nonce } = encryptSymmetric(base64Data, ephemeralKey);

    const manifest = {
        mediaId: predefinedMediaId || `media_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
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
                // Still upload to relay as backup for others
                console.log('[MediaTransport] P2P Success! Uploading background relay backup...');
            }
        } catch (err) {
            console.warn('[MediaTransport] P2P pipe failed, falling back to Waku/IPFS:', err.message);
        }
    }

    // --- Layer 6 Fallback 2: Multi-Homing Render Relays ---
    console.log('[MediaTransport] Uploading to Multi-Homing Relays...');
    if (onProgress) onProgress(10); 

    try {
        const { wakeUpRelays, uploadChunkWithRetry } = await import('./customRelayService');
        wakeUpRelays(); // Fire and forget
        
        // 1MB chunks are supported by most Express servers (default limit)
        const CHUNK_SIZE = 1024 * 1024; 
        const totalSize = encrypted.length;
        const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
        
        manifest.relayChunks = totalChunks;
        
        // Upload sequentially for better rate-limit stability
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, totalSize);
            const chunkData = encrypted.slice(start, end);
            const chunkId = `${manifest.mediaId}_${i}`;
            
            const success = await uploadChunkWithRetry(chunkId, chunkData, null, 3);
            if (!success) throw new Error(`Relay upload failed at chunk ${i}`);
            
            if (onProgress) onProgress(10 + Math.round(((i + 1) / totalChunks) * 90));
        }
        
        manifest.isRelay = true;
        
        if (onProgress) onProgress(100);
        return manifest;
    } catch (err) {
        console.error('[MediaTransport] Relay Upload failed:', err);
        // Even if relay fails, if p2p worked, we can still send the manifest
        if (manifest.isP2P) return manifest;
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
    const { wakeUpRelays, fetchChunkWithTimeout } = await import('./customRelayService');
    
    // 1. Check Local P2P/Waku Buffer (Persisted in localforage)
    if (manifest.isP2P || manifest.isWaku) {
        console.log('[MediaTransport] Reassembling from local persistent buffer...');
        const buffered = await getMediaBuffer(manifest.mediaId);
        if (buffered) {
            return decryptSymmetric(buffered, manifest.nonce, manifest.ephemeralKey);
        }
    }

    // 2. Check Relay Fallback
    if (manifest.isRelay) {
        console.log('[MediaTransport] Fetching from Multi-Homing Relays...');
        if (onProgress) onProgress(10);
        
        // Trigger wake-up in background
        wakeUpRelays();
        
        const total = manifest.relayChunks || 1;
        const chunkResults = new Array(total);
        const concurrencyLimit = 5;
        let completed = 0;

        for (let i = 0; i < total; i += concurrencyLimit) {
            const batchPromises = [];
            for (let j = 0; j < concurrencyLimit && (i + j) < total; j++) {
                const chunkIndex = i + j;
                const chunkId = `${manifest.mediaId}_${chunkIndex}`;
                
                batchPromises.push(
                    fetchChunkWithTimeout(chunkId).then(data => {
                        if (!data) throw new Error(`Failed to fetch chunk ${chunkIndex}`);
                        chunkResults[chunkIndex] = data;
                        completed++;
                        if (onProgress) onProgress(10 + Math.round((completed / total) * 90));
                    })
                );
            }
            await Promise.all(batchPromises);
        }
        
        const fullData = chunkResults.join('');
        const decrypted = decryptSymmetric(fullData, manifest.nonce, manifest.ephemeralKey);
        if (onProgress) onProgress(100);
        return decrypted;
    }

    // 3. Check Legacy IPFS Fallback
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

export async function reseedMediaToRelays(base64Data, manifest) {
    if (!base64Data || !manifest || !manifest.ephemeralKey || !manifest.nonce) return false;
    
    console.log(`[MediaTransport] Re-seeding media ${manifest.mediaId} to relays...`);
    
    // Re-encrypt the raw data identically to the original sender
    const { encrypted } = encryptSymmetric(base64Data, manifest.ephemeralKey, manifest.nonce);

    // MUST match the exact number of chunks the original manifest specified!
    const totalSize = encrypted.length;
    const totalChunks = manifest.relayChunks || 1;
    const CHUNK_SIZE = Math.ceil(totalSize / totalChunks);

    try {
        const { wakeUpRelays, uploadChunkWithRetry } = await import('./customRelayService');
        wakeUpRelays();
        
        const concurrencyLimit = 5;
        for (let i = 0; i < totalChunks; i += concurrencyLimit) {
            const batchPromises = [];
            for (let j = 0; j < concurrencyLimit && (i + j) < totalChunks; j++) {
                const chunkIndex = i + j;
                const start = chunkIndex * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, totalSize);
                const chunkData = encrypted.slice(start, end);
                const chunkId = `${manifest.mediaId}_${chunkIndex}`;
                
                batchPromises.push(
                    uploadChunkWithRetry(chunkId, chunkData, null, 3).then(success => {
                        if (!success) throw new Error(`Relay upload failed at chunk ${chunkIndex}`);
                    })
                );
            }
            await Promise.all(batchPromises);
        }
        
        console.log(`[MediaTransport] Successfully re-seeded ${manifest.mediaId} (${totalChunks} chunks)`);
        return true;
    } catch (err) {
        console.error('[MediaTransport] Failed to reseed media:', err);
        return false;
    }
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
