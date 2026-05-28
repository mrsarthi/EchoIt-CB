import * as Y from 'yjs';
import localforage from 'localforage';
import { decryptContent } from './storageEncryption';
import nacl from 'tweetnacl';

const EPOCH_SIZE = 500;
const activeDocs = new Map(); 

// Unified database for all metadata and Yjs updates
const epochMetaStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'epoch_metadata',
});

const yjsUpdateStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'yjs_updates',
});

// Legacy stores for migration
const individualMessageStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'messages_v2',
});

/**
 * Returns the highest epoch index for a chat.
 */
export async function getLatestEpochIndex(chatId) {
    const meta = await epochMetaStore.getItem(chatId.toLowerCase());
    return meta ? meta.latestIndex : 0;
}

export async function setLatestEpochIndex(chatId, index) {
    await epochMetaStore.setItem(chatId.toLowerCase(), { latestIndex: index });
}

/**
 * Custom Persistence Provider for Yjs using a unified localforage store.
 * This prevents creating thousands of IndexedDB databases (one per chat) which
 * crashes Android WebViews.
 */
class UnifiedPersistence {
    constructor(name, doc) {
        this.name = name;
        this.doc = doc;
        this.synced = false;
        this.saveQueue = Promise.resolve();
        this.initPromise = this._init();
    }

    async _init() {
        try {
            // Load existing updates from unified store
            const rawUpdates = await yjsUpdateStore.getItem(this.name);
            if (rawUpdates) {
                // Ensure it's a Uint8Array
                const updates = new Uint8Array(rawUpdates);
                Y.applyUpdate(this.doc, updates);
            }
            
            // Listen for changes and queue saves to prevent race conditions
            this.doc.on('update', (update) => {
                this.saveQueue = this.saveQueue.then(async () => {
                    try {
                        const currentRaw = await yjsUpdateStore.getItem(this.name);
                        let merged;
                        if (currentRaw) {
                            const current = new Uint8Array(currentRaw);
                            merged = Y.mergeUpdates([current, update]);
                        } else {
                            merged = update;
                        }
                        await yjsUpdateStore.setItem(this.name, merged);
                    } catch (err) {
                        console.error(`UnifiedPersistence save error for ${this.name}:`, err);
                    }
                });
            });

            this.synced = true;
        } catch (err) {
            console.error(`❌ UnifiedPersistence init failed for ${this.name}:`, err);
            // Don't hang the app if load fails
            this.synced = true;
        }
    }

    async whenSynced() {
        return this.initPromise;
    }

    destroy() {
        // Nothing explicitly needed for offing an anonymous lambda,
        // but normally we'd keep a reference if we wanted to removeListener.
    }
}

/**
 * Get or load a Y.Doc for a specific chat and epoch
 */
export async function getEpochDoc(chatId, epochIndex) {
    const key = `${chatId.toLowerCase()}_epoch_${epochIndex}`;
    if (activeDocs.has(key)) return activeDocs.get(key);

    const doc = new Y.Doc();
    const provider = new UnifiedPersistence(key, doc);
    
    await provider.whenSynced();

    const ymap = doc.getMap('messages');
    
    activeDocs.set(key, { doc, provider, ymap, epochIndex, chatId: chatId.toLowerCase() });
    
    // Memory leak fix: limit active docs
    if (activeDocs.size > 20) {
        const firstKey = activeDocs.keys().next().value;
        const context = activeDocs.get(firstKey);
        try {
            context.provider.destroy();
            context.doc.destroy();
        } catch (e) {}
        activeDocs.delete(firstKey);
    }
    
    return activeDocs.get(key);
}

/**
 * Get the current active (latest) epoch document for a chat.
 * If it's full (> EPOCH_SIZE), it rolls over to a new epoch.
 */
export async function getActiveEpoch(chatId) {
    let latestIndex = await getLatestEpochIndex(chatId);
    let current = await getEpochDoc(chatId, latestIndex);

    // Roll over to a new epoch if the current one is full
    if (current.ymap.size >= EPOCH_SIZE) {
        latestIndex += 1;
        await setLatestEpochIndex(chatId, latestIndex);
        current = await getEpochDoc(chatId, latestIndex);
    }
    return current;
}

/**
 * Hashes a message object deterministically for Merkle DAG chaining.
 */
export async function hashMessage(message) {
    if (!message) return 'genesis';
    // We only hash core immutable fields to ensure deterministic results across peers
    const core = {
        id: message.id,
        from: message.from,
        chatId: message.chatId?.toLowerCase(),
        content: message.content,
        timestamp: message.timestamp,
        parentHash: message.parentHash || 'genesis',
        type: message.type || 'text',
        groupId: message.groupId
    };
    const dataToHash = new TextEncoder().encode(JSON.stringify(core));
    
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        try {
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataToHash);
            return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
        } catch (e) {
            // Fallback if subtle crypto throws
        }
    }
    
    // Fallback to TweetNaCl SHA-512 (truncated to 32 bytes to match SHA-256 size expectations)
    const hashBuffer = nacl.hash(dataToHash).slice(0, 32);
    return btoa(String.fromCharCode(...hashBuffer));
}

/**
 * Returns the hash of the latest message in a chat for DAG linking.
 */
export async function getLatestMessageHash(chatId) {
    let index = await getLatestEpochIndex(chatId);
    while (index >= 0) {
        const context = await getEpochDoc(chatId, index);
        const lastId = context.ymap.get('last_id');
        if (lastId) {
            const lastMsg = context.ymap.get(lastId);
            if (lastMsg) return await hashMessage(lastMsg);
        }
        index--;
    }
    return 'genesis';
}

/**
 * Insert or update a message in the state engine.
 * Automatically handles routing to the correct epoch if updating.
 */
export async function insertMessage(chatId, message) {
    if (!message.id) return;
    
    // Check if message already exists in any loaded epoch to update it
    let foundEpoch = null;
    for (const [key, context] of activeDocs.entries()) {
        if (context.chatId === chatId.toLowerCase() && context.ymap.has(message.id)) {
            foundEpoch = context;
            break;
        }
    }

    const targetEpoch = foundEpoch || await getActiveEpoch(chatId);
    
    // Ensure parentHash is present for V3 Merkle DAG (Receiver-side fallback)
    const finalParentHash = message.parentHash || await getLatestMessageHash(chatId);

    targetEpoch.doc.transact(() => {
        const existing = targetEpoch.ymap.get(message.id);
        if (existing) {
            // Merge metadata (receipts, status)
            const merged = { ...existing, ...message };
            if (message.receipts && existing.receipts) {
                merged.receipts = { ...existing.receipts, ...message.receipts };
            }
            targetEpoch.ymap.set(message.id, merged);
        } else {
            // New insert
            const msgToInsert = {
                ...message,
                parentHash: finalParentHash,
                syncedAt: Date.now()
            };
            
            targetEpoch.ymap.set(message.id, msgToInsert);
            targetEpoch.ymap.set('last_id', message.id);
        }
    });

    return targetEpoch;
}

/**
 * Load a previous epoch for pagination (lazy loading).
 */
export async function loadPreviousEpoch(chatId, currentEpochIndex) {
    if (currentEpochIndex <= 0) return null;
    const prevIndex = currentEpochIndex - 1;
    return await getEpochDoc(chatId, prevIndex);
}

/**
 * Get all loaded messages for a chat, sorted by time.
 */
export function getLoadedMessages(chatId) {
    let allMessages = [];
    for (const [key, context] of activeDocs.entries()) {
        if (context.chatId === chatId.toLowerCase()) {
            allMessages = allMessages.concat(Array.from(context.ymap.values()));
        }
    }
    // Decrypt messages from local storage encryption
    const decryptedMessages = allMessages.map(msg => decryptContent(msg));

    // Sort oldest to newest
    return decryptedMessages.sort((a, b) => {
        const aTime = a.savedAt || a.timestamp;
        const bTime = b.savedAt || b.timestamp;
        const timeDiff = aTime - bTime;
        if (timeDiff !== 0) return timeDiff;
        return (a.id || '').localeCompare(b.id || '');
    });
}

/**
 * Perform a full migration from LocalForage (V2/V1) to Yjs Epochs.
 */
export async function migrateToYjs() {
    const metaStore = localforage.createInstance({ name: 'decentrachat', storeName: 'settings' });
    const isMigrated = await metaStore.getItem('is_yjs_migrated');
    if (isMigrated) {
        return; // Already migrated
    }

    console.log('🚀 Starting Yjs State Engine Migration...');

    // 1. Migrate V2 Store
    const v2Keys = await individualMessageStore.keys();
    // Group by chatId
    const chatGroups = {};
    for (const key of v2Keys) {
        // key format: msg_{chatId}_{timestamp}_{id}
        const parts = key.split('_');
        if (parts.length >= 4) {
            const chatId = parts[1];
            if (!chatGroups[chatId]) chatGroups[chatId] = [];
            chatGroups[chatId].push(key);
        }
    }

    for (const chatId of Object.keys(chatGroups)) {
        console.log(`📦 Migrating ${chatGroups[chatId].length} messages for chat ${chatId}...`);
        // Sort keys to maintain chronological order
        chatGroups[chatId].sort(); 
        
        let active = await getActiveEpoch(chatId);
        
        // Transact in chunks to avoid blocking
        const BATCH_SIZE = 100;
        for (let i = 0; i < chatGroups[chatId].length; i += BATCH_SIZE) {
            const batchKeys = chatGroups[chatId].slice(i, i + BATCH_SIZE);
            const msgs = await Promise.all(batchKeys.map(k => individualMessageStore.getItem(k)));
            
            for (const msg of msgs) {
                if (!msg || !msg.id) continue;
                if (active.ymap.size >= EPOCH_SIZE) {
                    active = await getActiveEpoch(chatId); // rolls over
                }
                active.ymap.set(msg.id, msg);
            }
        }
    }

    await metaStore.setItem('is_yjs_migrated', true);
    console.log('✅ Yjs State Engine Migration Complete!');
}
