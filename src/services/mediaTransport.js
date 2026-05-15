import { generateSymmetricKey, encryptSymmetric, decryptSymmetric } from '../crypto/crypto';
import { uploadChunkWithRetry, fetchChunkWithTimeout, wakeUpRelays } from './customRelayService';

const CHUNK_SIZE = 256 * 1024; // 256 KB chunks
const CONCURRENCY_LIMIT = 4; // limit simultaneous relay network calls

// Robust concurrency queue that handles errors properly
async function runWithConcurrency(tasks, limit) {
    const results = [];
    const executing = new Set();

    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);

        const cleanup = () => executing.delete(p);
        p.then(cleanup, cleanup); // Remove from executing on BOTH success and failure

        executing.add(p);
        if (executing.size >= limit) {
            // Wait for ANY task to finish (success or failure) before starting next
            await Promise.race(executing).catch(() => {});
        }
    }

    return Promise.all(results);
}

/**
 * Encrypts a media payload, splits it into chunks, and uploads them to the custom relay pool.
 * @param {string} base64Data - Full-res image data
 * @param {string} mimeType - e.g., 'image/jpeg'
 * @param {Function} onProgress - Callback with percentage (0-100)
 * @returns {Promise<Object>} The manifest pointer to be sent over signaling channel
 */
export async function sliceAndTransmitMedia(base64Data, mimeType, onProgress) {
    console.log('[MediaTransport] Starting upload pipeline...');
    console.log(`[MediaTransport] Payload size: ${(base64Data.length / 1024).toFixed(1)} KB`);

    // Wake up relay servers in parallel while we encrypt (handles Render cold starts)
    const wakePromise = wakeUpRelays();

    console.log('[MediaTransport] Generating key and encrypting payload...');
    const ephemeralKey = generateSymmetricKey();
    const { encrypted, nonce } = encryptSymmetric(base64Data, ephemeralKey);
    console.log(`[MediaTransport] Encrypted size: ${(encrypted.length / 1024).toFixed(1)} KB`);

    const totalChunks = Math.ceil(encrypted.length / CHUNK_SIZE);
    const manifest = {
        mediaId: `media_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        mimeType,
        totalChunks,
        ephemeralKey,
        nonce,
        chunkHashes: []
    };

    console.log(`[MediaTransport] Slicing into ${totalChunks} chunks...`);
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, encrypted.length);
        const chunkData = encrypted.slice(start, end);
        const chunkId = `${manifest.mediaId}_chunk_${i}`;
        manifest.chunkHashes.push(chunkId);
        chunks.push({ id: chunkId, data: chunkData });
    }

    // Wait for relay wake-up to finish before uploading
    try {
        await wakePromise;
        console.log('[MediaTransport] Relays are awake and ready.');
    } catch (e) {
        console.warn('[MediaTransport] Relay wake-up had issues, proceeding anyway:', e.message);
    }

    console.log(`[MediaTransport] Uploading ${totalChunks} chunks to relays (Concurrency: ${CONCURRENCY_LIMIT})...`);
    let uploadedCount = 0;

    const uploadTasks = chunks.map(chunk => async () => {
        const success = await uploadChunkWithRetry(chunk.id, chunk.data);
        if (!success) {
            throw new Error(`Failed to upload chunk ${chunk.id}`);
        }
        uploadedCount++;
        if (onProgress) {
            onProgress(Math.round((uploadedCount / totalChunks) * 100));
        }
        console.log(`[MediaTransport] Chunk ${uploadedCount}/${totalChunks} uploaded.`);
    });

    await runWithConcurrency(uploadTasks, CONCURRENCY_LIMIT);
    console.log('[MediaTransport] All chunks uploaded successfully!');

    return manifest;
}

/**
 * Downloads chunks from the relay pool and decrypts them back into a media blob.
 * @param {Object} manifest - The manifest object received over the signaling channel
 * @param {Function} onProgress - Callback with percentage (0-100)
 * @returns {Promise<string>} The decrypted base64 data
 */
export async function fetchAndReconstructMedia(manifest, onProgress) {
    const { totalChunks, chunkHashes, ephemeralKey, nonce } = manifest;

    // Wake up relays before fetching
    try {
        await wakeUpRelays();
    } catch (e) {
        console.warn('[MediaTransport] Relay wake-up had issues, proceeding anyway.');
    }

    console.log(`[MediaTransport] Fetching ${totalChunks} chunks from relays...`);
    let downloadedCount = 0;

    const fetchTasks = chunkHashes.map(chunkId => async () => {
        const chunkData = await fetchChunkWithTimeout(chunkId);
        if (!chunkData) {
            throw new Error(`Failed to fetch chunk ${chunkId}`);
        }
        downloadedCount++;
        if (onProgress) {
            onProgress(Math.round((downloadedCount / totalChunks) * 100));
        }
        return chunkData;
    });

    const downloadedChunks = await runWithConcurrency(fetchTasks, CONCURRENCY_LIMIT);

    console.log('[MediaTransport] Reassembling chunks and decrypting...');
    const encryptedPayload = downloadedChunks.join('');

    const decryptedBase64 = decryptSymmetric(encryptedPayload, nonce, ephemeralKey);
    if (!decryptedBase64) {
        throw new Error('Failed to decrypt media payload');
    }

    console.log('[MediaTransport] Media reconstructed and decrypted successfully!');
    return decryptedBase64;
}
