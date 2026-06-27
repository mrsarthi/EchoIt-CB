const crypto = require('crypto');

// Array of active Render homing relays used to transfer media in chunks
const RELAYS = [
  'https://dicsussion-relay-mitj.onrender.com',
  'https://dicsussion-relay-wikz.onrender.com',
  'https://dicsussion-relay.onrender.com',
  'https://dicsussion-relay-47ed.onrender.com'
];

/**
 * Encrypts a file buffer using AES-256-GCM with a randomly generated key and IV.
 * @param {Buffer} fileBuffer Plain file binary contents
 * @returns {Object} { ciphertext: string (base64), key: string (hex), iv: string (hex) }
 */
function encryptMedia(fileBuffer) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combine ciphertext and tag
  const combined = Buffer.concat([encrypted, tag]);

  return {
    ciphertext: combined.toString('base64'),
    key: key.toString('hex'),
    iv: iv.toString('hex')
  };
}

/**
 * Decrypts a base64 encoded encrypted file string using the provided key and IV.
 * @param {string} ciphertextBase64 Base64 encoded ciphertext + tag
 * @param {string} keyHex Symmetric key in hex format
 * @param {string} ivHex Initialization vector in hex format
 * @returns {Buffer} Decrypted file binary contents
 */
function decryptMedia(ciphertextBase64, keyHex, ivHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const combined = Buffer.from(ciphertextBase64, 'base64');

  const tagLength = 16;
  if (combined.length < tagLength) {
    throw new Error("Encrypted media content too short.");
  }

  const encrypted = combined.subarray(0, combined.length - tagLength);
  const tag = combined.subarray(combined.length - tagLength);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

async function asyncPool(concurrency, array, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item, array));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

async function selectBestRelay(signal = null) {
  const pings = RELAYS.map(async (url) => {
    const start = Date.now();
    const cts = new AbortController();
    const timeout = setTimeout(() => cts.abort(), 2000);
    const onParentAbort = () => cts.abort();
    
    if (signal) signal.addEventListener('abort', onParentAbort);
    
    try {
      const res = await fetch(url, { 
        method: 'GET', 
        signal: cts.signal 
      });
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      return { url, ok: res.ok || res.status < 500, duration: Date.now() - start };
    } catch {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      return { url, ok: false, duration: Infinity };
    }
  });

  const results = await Promise.all(pings);
  const awake = results.filter(r => r.ok).sort((a, b) => a.duration - b.duration);
  if (awake.length > 0) {
    console.log(`[Media] Selected fastest awake relay: ${awake[0].url} (${awake[0].duration}ms)`);
    return awake[0].url;
  }
  
  const fallback = RELAYS[Math.floor(Math.random() * RELAYS.length)];
  console.log(`[Media] No awake relays. Using fallback: ${fallback}`);
  return fallback;
}

/**
 * Encrypts a media file buffer, slices it into 1MB chunks, and uploads them to the homing relays.
 * @param {Buffer} fileBuffer Plain file binary contents
 * @param {string} mimeType File MIME type
 * @param {Function} [onProgress] Callback function for upload progress (0-100)
 * @param {AbortSignal} [signal] Optional abort signal
 * @returns {Promise<Object>} The encrypted media manifest
 */
async function uploadMediaInChunks(fileBuffer, mimeType, onProgress = null, signal = null) {
  // 1. Encrypt media
  const encrypted = encryptMedia(fileBuffer);
  
  // 2. Prepare metadata
  const mediaId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const ciphertext = encrypted.ciphertext;
  
  // 3. Slice ciphertext (base64 string) into 1MB character chunks
  const CHUNK_SIZE = 1024 * 1024; // 1MB characters
  const totalSize = ciphertext.length;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
  
  // 4. Select the best relay (fastest awake one)
  const relayUrl = await selectBestRelay(signal);
  
  if (signal && signal.aborted) {
    throw new Error("Upload aborted by user.");
  }
  
  // Create chunk jobs
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    chunks.push({
      index: i,
      chunkData: ciphertext.substring(start, end),
      chunkId: `${mediaId}_${i}`
    });
  }

  let completedChunks = 0;

  const uploadChunk = async (chunk) => {
    if (signal && signal.aborted) {
      throw new Error("Upload aborted by user.");
    }

    let success = false;
    let attempts = 0;
    const maxAttempts = 5;
    while (!success && attempts < maxAttempts) {
      if (signal && signal.aborted) {
        throw new Error("Upload aborted by user.");
      }
      try {
        const response = await fetch(`${relayUrl}/upload/${chunk.chunkId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: chunk.chunkData }),
          signal: signal
        });
        if (response.ok) {
          success = true;
        } else {
          throw new Error(`Server returned status ${response.status}`);
        }
      } catch (err) {
        attempts++;
        console.warn(`[Media] Upload chunk ${chunk.chunkId} failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to upload chunk ${chunk.chunkId} after ${maxAttempts} attempts.`);
        }
        await new Promise(r => setTimeout(r, attempts * 1000));
      }
    }
    
    completedChunks++;
    if (onProgress) {
      onProgress(Math.round((completedChunks / totalChunks) * 100));
    }
  };

  // Upload chunks concurrently (limit to 3 concurrent uploads)
  await asyncPool(3, chunks, uploadChunk);
  
  return {
    mediaId,
    mimeType,
    key: encrypted.key,
    iv: encrypted.iv,
    totalChunks
  };
}

/**
 * Downloads all chunks of an encrypted media file from the homing relays, reassembles them, and decrypts them.
 * @param {Object} manifest The encrypted media manifest
 * @param {Function} [onProgress] Callback function for download progress (0-100)
 * @param {AbortSignal} [signal] Optional abort signal
 * @returns {Promise<Buffer>} The decrypted plain file binary contents
 */
async function downloadMediaAndDecrypt(manifest, onProgress = null, signal = null) {
  const { mediaId, key, iv, totalChunks } = manifest;
  
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 1000) {
    throw new Error(`SECURITY: Invalid or unbounded totalChunks count (${totalChunks})`);
  }
  
  const chunkResults = new Array(totalChunks);
  
  let preferredRelayUrl = null;

  const fetchChunk = async (chunkId) => {
    if (signal && signal.aborted) {
      throw new Error("Download aborted by user.");
    }

    if (preferredRelayUrl) {
      const cts = new AbortController();
      const timeout = setTimeout(() => cts.abort(), 1500);
      const onParentAbort = () => cts.abort();
      
      if (signal) signal.addEventListener('abort', onParentAbort);
      
      try {
        const res = await fetch(`${preferredRelayUrl}/fetch/${chunkId}`, { signal: cts.signal });
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onParentAbort);
        
        if (res.ok) {
          const resJson = await res.json();
          if (resJson.success && resJson.data) {
            return resJson.data;
          }
        }
      } catch {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onParentAbort);
      }
    }

    // Race all relays in parallel
    const controllers = RELAYS.map(() => new AbortController());
    const onParentAbort = () => {
      controllers.forEach(c => c.abort());
    };
    if (signal) signal.addEventListener('abort', onParentAbort);

    const promises = RELAYS.map(async (relayUrl, idx) => {
      try {
        const res = await fetch(`${relayUrl}/fetch/${chunkId}`, { signal: controllers[idx].signal });
        if (res.ok) {
          const resJson = await res.json();
          if (resJson.success && resJson.data) {
            controllers.forEach((c, cIdx) => { if (cIdx !== idx) c.abort(); });
            preferredRelayUrl = relayUrl;
            return resJson.data;
          }
        }
        throw new Error("No data");
      } catch (err) {
        throw err;
      }
    });

    try {
      const winnerData = await Promise.any(promises);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      return winnerData;
    } catch (err) {
      if (signal) signal.removeEventListener('abort', onParentAbort);
      throw new Error(`Failed to download chunk ${chunkId} from all relays.`);
    }
  };

  const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
  let completedChunks = 0;

  const downloadWorker = async (index) => {
    const chunkId = `${mediaId}_${index}`;
    let chunkData = null;
    let attempts = 0;
    const maxAttempts = 3;
    while (!chunkData && attempts < maxAttempts) {
      if (signal && signal.aborted) {
        throw new Error("Download aborted by user.");
      }
      try {
        chunkData = await fetchChunk(chunkId);
      } catch (err) {
        attempts++;
        console.warn(`[Media] Download chunk ${chunkId} failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);
        if (attempts >= maxAttempts) {
          throw err;
        }
        await new Promise(r => setTimeout(r, attempts * 1000));
      }
    }
    chunkResults[index] = chunkData;
    completedChunks++;
    if (onProgress) {
      onProgress(Math.round((completedChunks / totalChunks) * 100));
    }
  };

  await asyncPool(3, chunkIndices, downloadWorker);
  
  const reconstructedCiphertext = chunkResults.join('');
  return decryptMedia(reconstructedCiphertext, key, iv);
}

module.exports = {
  encryptMedia,
  decryptMedia,
  uploadMediaInChunks,
  downloadMediaAndDecrypt,
  RELAYS
};
