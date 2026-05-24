import localforage from 'localforage';

// Configure a dedicated IndexedDB instance for Group Epoch Keys
const keyStore = localforage.createInstance({
    name: 'DecentraChat_V3',
    storeName: 'group_epoch_keys'
});

/**
 * Save an Epoch Key for a group.
 * Maintains a history of keys for the group so older messages can still be decrypted.
 * 
 * @param {string} groupId 
 * @param {string} epochKeyBase64 
 * @param {number} messageSequence Start sequence or epoch index this key is valid for
 */
export async function saveGroupEpochKey(groupId, epochKeyBase64, messageSequence = 0) {
    try {
        const existingHistory = await keyStore.getItem(groupId) || [];
        
        // Push the new key into the history
        existingHistory.push({
            key: epochKeyBase64,
            sequence: messageSequence,
            timestamp: Date.now()
        });

        // Keep it sorted by sequence number descending (newest first)
        existingHistory.sort((a, b) => b.sequence - a.sequence);

        await keyStore.setItem(groupId, existingHistory);
        console.log(`🔐 Saved new Epoch Key for group ${groupId}`);
    } catch (err) {
        console.error('Failed to save group epoch key:', err);
    }
}

/**
 * Get the currently active Epoch Key for a group (the newest one).
 * @param {string} groupId 
 * @returns {Promise<string|null>}
 */
export async function getActiveGroupEpochKey(groupId) {
    try {
        const history = await keyStore.getItem(groupId);
        if (!history || history.length === 0) return null;
        
        // The first item is the newest due to descending sort
        return history[0].key;
    } catch (err) {
        console.error('Failed to get active group epoch key:', err);
        return null;
    }
}

/**
 * Get an older Epoch Key for a group, based on a specific sequence number or timestamp.
 * (Used when lazy-loading older epochs that were encrypted with a previous key).
 * 
 * @param {string} groupId 
 * @param {number} targetSequence 
 * @returns {Promise<string|null>}
 */
export async function getHistoricalGroupEpochKey(groupId, targetSequence) {
    try {
        const history = await keyStore.getItem(groupId);
        if (!history || history.length === 0) return null;

        // Find the key that was active at the time of targetSequence
        // Since history is sorted descending, we find the first key where sequence <= targetSequence
        const keyData = history.find(k => k.sequence <= targetSequence);
        return keyData ? keyData.key : history[history.length - 1].key;
    } catch (err) {
        console.error('Failed to get historical group epoch key:', err);
        return null;
    }
}

/**
 * Clear all keys for a group (e.g. when leaving or deleting the group)
 */
export async function deleteGroupKeys(groupId) {
    try {
        await keyStore.removeItem(groupId);
    } catch (err) {
        console.error('Failed to delete group keys:', err);
    }
}
