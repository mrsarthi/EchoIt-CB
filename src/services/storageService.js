import localforage from 'localforage';

const messageStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'messages',
});

// New store for individual message entries (Infinite History)
const individualMessageStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'messages_v2',
});

// New store for large media blobs (Images/Files)
const mediaStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'media_cache',
});

const contactStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'contacts',
});

const outboxStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'outbox',
});

// Store for app settings and user metadata (joinedAt, migration flags, etc.)
const settingsStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'settings',
});

// Mutex for atomic operations
class Mutex {
    constructor() {
        this.queue = Promise.resolve();
    }
    lock(callback) {
        const next = this.queue.then(() => callback().catch(console.error));
        this.queue = next; // Chain it
        return next;
    }
}

const storageMutexes = {}; // key -> Mutex

function getMutex(key) {
    if (!storageMutexes[key]) {
        storageMutexes[key] = new Mutex();
    }
    return storageMutexes[key];
}

const MAX_HISTORY_PER_CHAT = 10000; // Increased limit for legacy store, but v2 is infinite

/**
 * Sort comparator: use savedAt (local device time) for ordering,
 * falling back to timestamp for legacy messages without savedAt.
 */
function messageSort(a, b) {
    const aTime = a.savedAt || a.timestamp;
    const bTime = b.savedAt || b.timestamp;
    const timeDiff = aTime - bTime;
    if (timeDiff !== 0) return timeDiff;
    return (a.id || '').localeCompare(b.id || '');
}

/**
 * Save a message to local history (Individual Entry V2)
 * @param {string} chatId
 * @param {Object} message
 */
export async function saveMessage(chatId, message) {
    const key = `chat_${chatId.toLowerCase()}`;
    return getMutex(key).lock(async () => {
        try {
            const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const timestamp = message.timestamp || Date.now();
            
            // Save to New Individual Store (V2)
            // Key format: chat_<chatId>_<timestamp>_<id>
            // This allows lexicographical sorting by timestamp
            const v2Key = `msg_${chatId.toLowerCase()}_${timestamp}_${id}`;
            await individualMessageStore.setItem(v2Key, { ...message, id, timestamp, chatId: chatId.toLowerCase() });

            // Backward compatibility: Save to Legacy Store (V1)
            const legacyKey = `chat_${chatId.toLowerCase()}`;
            const history = (await messageStore.getItem(legacyKey)) || [];
            const exists = history.findIndex(m => m.id === id);

            if (exists !== -1) {
                history[exists] = message;
            } else {
                history.push(message);
            }

            const newHistory = history.slice(-MAX_HISTORY_PER_CHAT);
            await messageStore.setItem(legacyKey, newHistory);
            
            return id;
        } catch (err) {
            console.error('Failed to save message:', err);
            throw err;
        }
    });
}

/**
 * Get paginated history for a chat
 * @param {string} chatId 
 * @param {number} limit 
 * @param {number} beforeTimestamp 
 */
export async function getMessagesPaginated(chatId, limit = 50, beforeTimestamp = null) {
    const messages = [];
    const lowerChatId = chatId.toLowerCase();
    
    await individualMessageStore.iterate((value, key) => {
        if (key.startsWith(`msg_${lowerChatId}_`)) {
            if (!beforeTimestamp || value.timestamp < beforeTimestamp) {
                messages.push(value);
            }
        }
    });

    // Sort descending (newest first) for easier slicing
    messages.sort((a, b) => b.timestamp - a.timestamp);
    
    return messages.slice(0, limit).reverse(); // Return oldest to newest for the UI
}

/**
 * Save media blob to cache
 */
export async function saveMedia(messageId, base64Data) {
    await mediaStore.setItem(messageId, base64Data);
}

/**
 * Get media blob from cache
 */
export async function getMedia(messageId) {
    return await mediaStore.getItem(messageId);
}



/**
 * Get local history for a chat (V2 with V1 fallback)
 * @param {string} chatId
 * @returns {Promise<Array>}
 */
export async function getLocalHistory(chatId) {
    if (!chatId) return [];
    try {
        // Try V2 first (paginated)
        const v2History = await getMessagesPaginated(chatId, 100);
        if (v2History.length > 0) return v2History;

        // Fallback to V1 legacy store
        const key = `chat_${chatId.toLowerCase()}`;
        const history = (await messageStore.getItem(key)) || [];
        console.debug(`📂 Loaded ${history.length} messages from legacy ${key}`);
        return history;
    } catch (err) {
        console.error('Failed to load local history:', err);
        return [];
    }
}

/**
 * Save multiple messages (bulk import)
 * @param {string} chatId 
 * @param {Array} messages 
 */
export async function saveMessagesBulk(chatId, messages) {
    if (!chatId || !messages.length) return;
    const legacyKey = `chat_${chatId.toLowerCase()}`;

    return getMutex(legacyKey).lock(async () => {
        try {
            // Save to Individual Store (V2)
            const v2Promises = messages.map(msg => {
                const id = msg.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const timestamp = msg.timestamp || Date.now();
                const v2Key = `msg_${chatId.toLowerCase()}_${timestamp}_${id}`;
                return individualMessageStore.setItem(v2Key, { ...msg, id, timestamp, chatId: chatId.toLowerCase() });
            });
            await Promise.all(v2Promises);

            // Backward compatibility: Update Legacy Store (V1)
            const history = (await messageStore.getItem(legacyKey)) || [];
            const existingIds = new Set(history.map(m => m.id));
            const toAdd = messages.filter(m => !existingIds.has(m.id));

            if (toAdd.length > 0) {
                const newHistory = [...history, ...toAdd]
                    .sort(messageSort)
                    .slice(-MAX_HISTORY_PER_CHAT);
                await messageStore.setItem(legacyKey, newHistory);
            }
            
            console.debug(`✅ Bulk saved ${messages.length} msgs to ${chatId}`);
        } catch (err) {
            console.error('Failed to save bulk messages:', err);
        }
    });
}

/**
 * Update message status in both stores
 */
export async function updateMessageStatus(chatId, messageIds, status) {
    if (!chatId || !messageIds || messageIds.length === 0) return;
    const legacyKey = `chat_${chatId.toLowerCase()}`;

    return getMutex(legacyKey).lock(async () => {
        try {
            // Update V2 Individual Store
            const lowerChatId = chatId.toLowerCase();
            await individualMessageStore.iterate(async (value, key) => {
                if (key.startsWith(`msg_${lowerChatId}_`) && messageIds.includes(value.id)) {
                    await individualMessageStore.setItem(key, { ...value, status });
                }
            });

            // Update V1 Legacy Store
            const history = (await messageStore.getItem(legacyKey)) || [];
            let updated = false;
            const newHistory = history.map(m => {
                if (messageIds.includes(m.id)) {
                    updated = true;
                    return { ...m, status };
                }
                return m;
            });

            if (updated) {
                await messageStore.setItem(legacyKey, newHistory);
            }
        } catch (err) {
            console.error('Failed to update message status:', err);
        }
    });
}

/**
 * Migrate old history to individual storage (V2)
 */
export async function migrateOldHistory() {
    const isMigrated = await settingsStore.getItem('is_v2_migrated');
    if (isMigrated) return;

    console.log('🚀 Starting Storage Migration to V2...');
    try {
        const keys = await messageStore.keys();
        const chatKeys = keys.filter(k => k.startsWith('chat_'));

        for (const key of chatKeys) {
            const chatId = key.replace('chat_', '');
            const history = await messageStore.getItem(key);
            if (Array.isArray(history) && history.length > 0) {
                console.log(`📦 Migrating ${history.length} messages for ${chatId}...`);
                await saveMessagesBulk(chatId, history);
            }
        }

        await settingsStore.setItem('is_v2_migrated', true);
        console.log('✅ Storage Migration to V2 Complete!');
    } catch (err) {
        console.error('❌ Storage Migration failed:', err);
    }
}

/**
 * Get/Set Member Since date
 */
export async function getJoinedAt() {
    return await settingsStore.getItem('joined_at');
}

export async function setJoinedAt(timestamp) {
    const existing = await getJoinedAt();
    if (!existing) {
        await settingsStore.setItem('joined_at', timestamp);
    }
}

// ... existing imports and code ...

/**
 * Get all saved contacts/groups
 */
export async function getSavedContacts() {
    return getMutex('visible_contacts').lock(async () => {
        try {
            const contacts = (await messageStore.getItem('visible_contacts')) || [];
            // Deduplicate just in case
            const unique = [];
            const seen = new Set();
            for (const c of contacts) {
                if (!seen.has(c.address.toLowerCase())) {
                    seen.add(c.address.toLowerCase());
                    unique.push(c);
                }
            }
            console.debug(`👥 Loaded ${unique.length} contacts from storage`);
            return unique;
        } catch (err) {
            console.error('Failed to load contacts:', err);
            return [];
        }
    });
}

/**
 * Save contacts list to storage
 * @param {Array} contacts 
 */
export async function saveContacts(contacts) {
    if (!contacts) return;
    // Utilize Mutex queue so rapid state updates do not overwrite newer states sequentially on slow mobile bridges
    return getMutex('visible_contacts').lock(async () => {
        try {
            // Only save what's necessary to rebuild the sidebar
            const minimized = contacts.map(c => ({
                address: c.address,
                username: c.username,
                publicKey: c.publicKey, // Required for offline messaging fallbacks
                isGroup: c.isGroup,
                members: c.members, // Crucial for groups
                admins: c.admins,   // Crucial for group admin features
                lastMessageTime: c.lastMessageTime,
                unreadCount: c.unreadCount,
                avatar: c.avatar,   // Persist avatar so offline users still show their pfp
                status: c.status,   // Persist status tagline
                // Don't save online status, meaningless on reload
            }));
            await messageStore.setItem('visible_contacts', minimized);
        } catch (err) {
            console.error('Failed to save contacts:', err);
        }
    });
}

export async function clearHistory(chatId) {
    if (!chatId) return;
    // Clear V1 legacy store
    await messageStore.removeItem(`chat_${chatId.toLowerCase()}`);
    
    // Clear V2 individual entries
    const lowerChatId = chatId.toLowerCase();
    const keysToDelete = [];
    await individualMessageStore.iterate((value, key) => {
        if (key.startsWith(`msg_${lowerChatId}_`)) {
            keysToDelete.push(key);
        }
    });
    for (const key of keysToDelete) {
        await individualMessageStore.removeItem(key);
    }
    
    // Clear media for this chat's messages
    // (media keys are message IDs, we collect them during iteration above)
}

/**
 * Clear ALL local data (messages, contacts, everything)
 * Used for account deletion
 */
export async function clearAllData() {
    await messageStore.clear();
    await individualMessageStore.clear();
    await mediaStore.clear();
    console.log('🗑️ All local chat data cleared');
}

// ========== OUTBOX (Pending Message Queue) ==========

const OUTBOX_KEY = 'pending_outbox';
const outboxMutex = new Mutex();

/**
 * Save a message to the outbox for later delivery
 * @param {Object} message - The full message object (with to/from/id/content)
 */
export async function savePendingMessage(message) {
    if (!message?.id) return;
    return outboxMutex.lock(async () => {
        try {
            const outbox = (await messageStore.getItem(OUTBOX_KEY)) || [];
            // Avoid duplicates
            if (outbox.some(m => m.id === message.id)) {
                console.debug('⚠️ Duplicate outbox message ignored:', message.id);
                return;
            }
            outbox.push({ ...message, queuedAt: Date.now() });
            await messageStore.setItem(OUTBOX_KEY, outbox);
            console.debug(`📤 Queued message ${message.id} in outbox. Total: ${outbox.length}`);
        } catch (err) {
            console.error('Failed to save to outbox:', err);
        }
    });
}

/**
 * Get all pending messages from the outbox
 * @returns {Promise<Array>}
 */
export async function getPendingMessages() {
    try {
        return (await messageStore.getItem(OUTBOX_KEY)) || [];
    } catch (err) {
        console.error('Failed to load outbox:', err);
        return [];
    }
}

/**
 * Remove a message from the outbox after successful send
 * @param {string} messageId
 */
export async function removePendingMessage(messageId) {
    return outboxMutex.lock(async () => {
        try {
            const outbox = (await messageStore.getItem(OUTBOX_KEY)) || [];
            const filtered = outbox.filter(m => m.id !== messageId);
            await messageStore.setItem(OUTBOX_KEY, filtered);
            console.debug(`✅ Removed ${messageId} from outbox. Remaining: ${filtered.length}`);
        } catch (err) {
            console.error('Failed to remove from outbox:', err);
        }
    });
}

/**
 * Get pending messages for a specific recipient
 * @param {string} address - Recipient address
 * @returns {Promise<Array>}
 */
export async function getPendingMessagesForRecipient(address) {
    const outbox = await getPendingMessages();
    return outbox.filter(m => m.to?.toLowerCase() === address.toLowerCase());
}
