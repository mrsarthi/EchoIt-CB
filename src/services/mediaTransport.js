import { generateSymmetricKey, encryptSymmetric, decryptSymmetric } from '../crypto/crypto';
import * as webrtcService from './webrtcService';
import { uploadToIPFS, fetchFromIPFS } from './ipfsService';

const WEBRTC_PACKET_SIZE = 16 * 1024; // 16 KB packets for P2P Data Channels
const PINATA_JWT_KEY = 'decentrachat_pinata_jwt';

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

    // --- Layer 4: Try Direct P2P Pipe first ---
    if (recipientAddress && webrtcService.isPeerConnected(recipientAddress)) {
        console.log(`[MediaTransport] Peer ${recipientAddress.slice(0, 10)} connected. Attempting P2P direct pipe...`);
        try {
            const p2pSuccess = await pipeMediaViaWebRTC(recipientAddress, manifest.mediaId, encrypted, onProgress);
            if (p2pSuccess) {
                manifest.isP2P = true;
                return manifest;
            }
        } catch (err) {
            console.warn('[MediaTransport] P2P pipe failed, falling back to IPFS:', err.message);
        }
    }

    // --- Layer 6 Fallback: IPFS (Pinata) ---
    console.log('[MediaTransport] Uploading to IPFS...');
    if (onProgress) onProgress(10); // Start progress

    const pinataJwt = localStorage.getItem(PINATA_JWT_KEY);
    if (!pinataJwt) {
        throw new Error("Pinata JWT not found in Settings. Please configure it to send media when peers are offline.");
    }

    try {
        // Since we already have the encrypted blob as a base64 string from encryptSymmetric
        // we can pass it directly to uploadToIPFS.
        // Wait, encryptSymmetric returns a base64 string? Let me check crypto.js
        // No, encryptSymmetric in crypto.js returns { encrypted, nonce }. 
        // Let's check what 'encrypted' is. In crypto.js, it's encodeBase64(nacl.secretbox(...))
        
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
 * Directly pipes media data over WebRTC in small 16KB fragments.
 */
async function pipeMediaViaWebRTC(peerAddress, mediaId, data, onProgress) {
    const totalSize = data.length;
    const totalPackets = Math.ceil(totalSize / WEBRTC_PACKET_SIZE);
    
    for (let i = 0; i < totalPackets; i++) {
        const start = i * WEBRTC_PACKET_SIZE;
        const end = Math.min(start + WEBRTC_PACKET_SIZE, totalSize);
        const packet = data.slice(start, end);
        
        const success = webrtcService.sendToPeer(peerAddress, {
            type: 'MEDIA_CHUNK',
            mediaId,
            index: i,
            total: totalPackets,
            data: packet
        });

        if (!success) return false;

        if (onProgress && i % 5 === 0) {
            onProgress(Math.round((i / totalPackets) * 100));
        }
        
        // Minor delay to prevent flooding the data channel buffer
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
    }

    if (onProgress) onProgress(100);
    return true;
}

/**
 * Downloads and decrypts media from manifest.
 */
export async function fetchAndReconstructMedia(manifest, onProgress) {
    // 1. Check P2P Buffer
    if (manifest.isP2P) {
        console.log('[MediaTransport] P2P Media Reassembling from local buffer...');
        const buffered = await getP2PMediaBuffer(manifest.mediaId);
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
        
        // The data returned from fetchFromIPFS (via FileReader.readAsDataURL) 
        // is a data URL. We need the base64 part.
        const base64Content = encryptedData.split(',')[1];
        
        const decrypted = decryptSymmetric(base64Content, manifest.nonce, manifest.ephemeralKey);
        if (onProgress) onProgress(100);
        return decrypted;
    }

    throw new Error('Media not available (Peer offline and no IPFS fallback found)');
}

// Memory buffer for incoming P2P chunks
const p2pBuffers = new Map(); // mediaId -> { packets: [], received: 0, total: 0 }

export function handleIncomingMediaChunk(payload) {
    const { mediaId, index, total, data } = payload;
    if (!p2pBuffers.has(mediaId)) {
        p2pBuffers.set(mediaId, { packets: new Array(total), received: 0, total });
    }
    const buffer = p2pBuffers.get(mediaId);
    if (!buffer.packets[index]) {
        buffer.packets[index] = data;
        buffer.received++;
    }
}

async function getP2PMediaBuffer(mediaId) {
    const buffer = p2pBuffers.get(mediaId);
    if (!buffer || buffer.received < buffer.total) return null;
    const fullData = buffer.packets.join('');
    p2pBuffers.delete(mediaId);
    return fullData;
}
