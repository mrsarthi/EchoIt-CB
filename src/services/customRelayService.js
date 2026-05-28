// Array of your active Render / Oracle relay URLs
// In production, these should be environment variables or user settings.
const RELAYS = [
    'https://dicsussion-relay-mitj.onrender.com',
    'https://dicsussion-relay-wikz.onrender.com',
    'https://dicsussion-relay.onrender.com',
    'https://dicsussion-relay-47ed.onrender.com'
];

/**
 * Wake up all relay servers (Render free tier goes to sleep after inactivity).
 * Call this BEFORE uploading so cold starts happen in parallel with encryption.
 * @returns {Promise<void>}
 */
export async function wakeUpRelays() {
    console.log('[Relay] Waking up relay servers...');
    const wakePromises = RELAYS.map(async (url) => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 45000); // 45s for cold start
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            console.log(`[Relay] ${url} is awake (${response.status})`);
        } catch (err) {
            console.warn(`[Relay] Failed to wake ${url}:`, err.message);
        }
    });
    await Promise.allSettled(wakePromises);
}

/**
 * Uploads a chunk to a specific relay server, with fallback to others on failure.
 * @param {string} chunkId - Unique identifier/hash for this chunk
 * @param {string} base64Data - The encrypted chunk payload
 * @param {string} [token] - Optional JWT authorization token (Task 9)
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<boolean>} True if successfully acknowledged
 */
export async function uploadChunkWithRetry(chunkId, base64Data, token = null, maxRetries = 3) {
    let attempt = 0;
    
    while (attempt < maxRetries) {
        // Pick a random relay to distribute load
        const relayUrl = RELAYS[Math.floor(Math.random() * RELAYS.length)];
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
            
            const headers = { 'Content-Type': 'application/json' };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${relayUrl}/upload/${chunkId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ data: base64Data }),
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            if (response.ok) {
                return true; // Success
            } else if (response.status === 401 || response.status === 403) {
                console.error(`[Relay] Auth failed on ${relayUrl}: ${response.status}`);
                return false; // Don't retry on auth failure
            } else {
                throw new Error(`Server returned ${response.status}`);
            }
        } catch (error) {
            attempt++;
            console.warn(`[Relay] Upload attempt ${attempt} failed for chunk ${chunkId} on ${relayUrl}:`, error.message);
            if (attempt >= maxRetries) {
                console.error(`[Relay] Failed to upload chunk ${chunkId} after ${maxRetries} attempts.`);
                return false;
            }
            // Exponential backoff
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
    }
    return false;
}

/**
 * Fetches a chunk by racing all known relays.
 * The first one to return the chunk wins.
 * @param {string} chunkId - Unique identifier for the chunk
 * @returns {Promise<string|null>} The chunk data, or null if not found
 */
export async function fetchChunkWithTimeout(chunkId) {
    return new Promise((resolve) => {
        let isResolved = false;

        const promises = RELAYS.map(async (relayUrl) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
                
                const response = await fetch(`${relayUrl}/fetch/${chunkId}`, {
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                if (response.ok) {
                    const data = await response.json();
                    if (!isResolved && data.success && data.data) {
                        isResolved = true;
                        resolve(data.data);
                    }
                }
            } catch (err) {
                // Ignore fetch errors from individual nodes, we are racing them
            }
        });

        Promise.allSettled(promises).then(() => {
            if (!isResolved) {
                console.error(`[Relay] Failed to fetch chunk ${chunkId} from all relays.`);
                resolve(null);
            }
        });
    });
}
