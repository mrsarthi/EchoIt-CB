import localforage from 'localforage';
import { insertMessage } from './stateEngine';
import { setStorageSessionKey, encryptContent, decryptContent } from './storageEncryption';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

// Configure localforage for mobile stability
localforage.config({
    name: 'decentrachat',
    driver: localforage.INDEXEDDB, // Force IndexedDB for robustness
    description: 'Unified storage for DecentraChat messages and sessions'
});

const messageStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'messages',
});

const individualMessageStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'messages_v2',
});

const mediaStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'media_cache',
});

const settingsStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'settings',
});

const chatIndexStore = localforage.createInstance({
    name: 'decentrachat',
    storeName: 'chat_indices',
});

/**
 * Internal helper to update the message index for a chat.
 * This avoids expensive .keys() scans for pagination.
 */
async function addToChatIndex(chatId, messageKey, timestamp) {
    const lowerChatId = chatId.toLowerCase();
    const mutex = getMutex(`index_${lowerChatId}`);
    return mutex.lock(async () => {
        const index = (await chatIndexStore.getItem(lowerChatId)) || [];
        // Prevent duplicates
        if (index.some(entry => entry.key === messageKey)) return;
        
        index.push({ key: messageKey, ts: timestamp });
        // Keep index sorted by timestamp
        index.sort((a, b) => a.ts - b.ts);
        
        // Optional: limit index size to MAX_HISTORY_PER_CHAT if needed
        await chatIndexStore.setItem(lowerChatId, index);
    });
}

/**
 * Rebuild the index for a chat if it's missing.
 */
async function rebuildChatIndex(chatId) {
    const lowerChatId = chatId.toLowerCase();
    const allKeys = await individualMessageStore.keys();
    const prefix = `msg_${lowerChatId}_`;
    const chatKeys = allKeys.filter(k => k.startsWith(prefix));
    
    const index = chatKeys.map(key => {
        const suffix = key.substring(prefix.length);
        const ts = parseInt(suffix.split('_')[0]);
        return { key, ts };
    }).sort((a, b) => a.ts - b.ts);
    
    await chatIndexStore.setItem(lowerChatId, index);
    return index;
}

class Mutex {
    constructor() {
        this.queue = Promise.resolve();
    }
    lock(callback) {
        const next = this.queue.then(() => callback().catch(console.error));
        this.queue = next; 
        return next;
    }
}

const storageMutexes = {}; 

function getMutex(key) {
    if (!storageMutexes[key]) {
        storageMutexes[key] = new Mutex();
    }
    return storageMutexes[key];
}

const MAX_HISTORY_PER_CHAT = 10000; 

function messageSort(a, b) {
    const aTime = a.savedAt || a.timestamp;
    const bTime = b.savedAt || b.timestamp;
    const timeDiff = aTime - bTime;
    if (timeDiff !== 0) return timeDiff;
    return (a.id || '').localeCompare(b.id || '');
}

export async function saveMessage(chatId, message) {
    const key = `chat_${chatId.toLowerCase()}`;
    return getMutex(key).lock(async () => {
        try {
            const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const timestamp = message.timestamp || Date.now();
            
            const encryptedMessage = encryptContent(message);

            const v2Key = `msg_${chatId.toLowerCase()}_${timestamp}_${id}`;
            const messageWithId = { ...encryptedMessage, id, timestamp, chatId: chatId.toLowerCase() };
            await individualMessageStore.setItem(v2Key, messageWithId);
            await addToChatIndex(chatId, v2Key, timestamp);

            await insertMessage(chatId, { ...message, id, timestamp, chatId: chatId.toLowerCase() });

            const legacyKey = `chat_${chatId.toLowerCase()}`;
            const history = (await messageStore.getItem(legacyKey)) || [];
            const exists = history.findIndex(m => m.id === id);

            if (exists !== -1) {
                history[exists] = encryptedMessage;
            } else {
                history.push(encryptedMessage);
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

export async function getMessagesPaginated(chatId, limit = 50, beforeTimestamp = null) {
    const lowerChatId = chatId.toLowerCase();
    
    // Attempt to use the fast index first
    let index = await chatIndexStore.getItem(lowerChatId);
    if (!index) {
        console.debug(`🔍 Index missing for ${lowerChatId}, rebuilding...`);
        index = await rebuildChatIndex(chatId);
    }

    let chatEntries = index;

    if (beforeTimestamp) {
        chatEntries = chatEntries.filter(entry => entry.ts < beforeTimestamp);
    }

    // Sort descending by timestamp for pagination
    chatEntries.sort((a, b) => b.ts - a.ts);
    const pageEntries = chatEntries.slice(0, limit);

    const messages = await Promise.all(pageEntries.map(async (entry) => {
        const msg = await individualMessageStore.getItem(entry.key);
        return msg ? decryptContent(msg) : null;
    }));

    return messages.filter(m => m !== null).reverse();
}

export async function saveMedia(messageId, base64Data) {
    await mediaStore.setItem(messageId, base64Data);
}

export async function getMedia(messageId) {
    return await mediaStore.getItem(messageId);
}

export async function hasMedia(messageId) {
    if (!messageId) return false;
    const item = await mediaStore.getItem(messageId);
    return !!item;
}

export async function getLocalHistory(chatId) {
    if (!chatId) return [];
    try {
        const v2History = await getMessagesPaginated(chatId, 100);
        if (v2History.length > 0) return v2History;

        const key = `chat_${chatId.toLowerCase()}`;
        const history = (await messageStore.getItem(key)) || [];
        const decryptedHistory = history.map(decryptContent);
        console.debug(`📂 Loaded ${decryptedHistory.length} messages from legacy ${key}`);
        return decryptedHistory;
    } catch (err) {
        console.error('Failed to load local history:', err);
        return [];
    }
}

export async function saveMessagesBulk(chatId, messages) {
    if (!chatId || !messages.length) return;
    const legacyKey = `chat_${chatId.toLowerCase()}`;

    return getMutex(legacyKey).lock(async () => {
        try {
            const v2Promises = messages.map(async (msg) => {
                const id = msg.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const timestamp = msg.timestamp || Date.now();
                const v2Key = `msg_${chatId.toLowerCase()}_${timestamp}_${id}`;
                
                const encryptedMessage = encryptContent(msg);
                const messageWithId = { ...encryptedMessage, id, timestamp, chatId: chatId.toLowerCase() };
                
                await insertMessage(chatId, { ...msg, id, timestamp, chatId: chatId.toLowerCase() });
                
                await addToChatIndex(chatId, v2Key, timestamp);
                return individualMessageStore.setItem(v2Key, messageWithId);
            });
            await Promise.all(v2Promises);

            const encryptedMessages = messages.map(encryptContent);
            const history = (await messageStore.getItem(legacyKey)) || [];
            const existingIds = new Set(history.map(m => m.id));
            const toAdd = encryptedMessages.filter(m => !existingIds.has(m.id));

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

export async function updateMessageStatus(chatId, messageIds, status) {
    if (!chatId || !messageIds || messageIds.length === 0) return;
    const legacyKey = `chat_${chatId.toLowerCase()}`;

    return getMutex(legacyKey).lock(async () => {
        try {
            const lowerChatId = chatId.toLowerCase();
            
            let index = await chatIndexStore.getItem(lowerChatId);
            if (!index) index = await rebuildChatIndex(chatId);
            
            const keysToUpdate = index.filter(entry => {
                const parts = entry.key.split('_');
                const id = parts.slice(3).join('_'); // V2 key: msg_{chatId}_{timestamp}_{messageId}
                return messageIds.includes(id);
            }).map(entry => entry.key);

            await Promise.all(keysToUpdate.map(async (key) => {
                const value = await individualMessageStore.getItem(key);
                if (value) {
                    await individualMessageStore.setItem(key, { ...value, status });
                }
            }));

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

export async function updateMessageReceipt(chatId, messageIds, fromAddress, type) {
    if (!messageIds || messageIds.length === 0 || !fromAddress) return;
    const lowerFrom = fromAddress.toLowerCase();
    const lowerChatId = chatId?.toLowerCase();

    const legacyKey = lowerChatId ? `chat_${lowerChatId}` : null;
    const mutex = legacyKey ? getMutex(legacyKey) : null;

    const runUpdate = async () => {
        try {
            if (legacyKey) {
                const history = (await messageStore.getItem(legacyKey)) || [];
                let updated = false;
                const newHistory = history.map(m => {
                    if (messageIds.includes(m.id)) {
                        updated = true;
                        const receipts = m.receipts || {};
                        receipts[lowerFrom] = type;
                        return { ...m, receipts };
                    }
                    return m;
                });
                if (updated) {
                    await messageStore.setItem(legacyKey, newHistory);
                }
            }

            let keysToUpdate = [];
            if (lowerChatId) {
                let index = await chatIndexStore.getItem(lowerChatId);
                if (!index) index = await rebuildChatIndex(lowerChatId);
                keysToUpdate = index.filter(entry => {
                    const parts = entry.key.split('_');
                    const id = parts.slice(3).join('_');
                    return messageIds.includes(id);
                }).map(entry => entry.key);
            } else {
                // Fallback for when chatId isn't known (rare)
                const allKeys = await individualMessageStore.keys();
                keysToUpdate = allKeys.filter(key => {
                    const parts = key.split('_');
                    const id = parts.slice(3).join('_');
                    return messageIds.includes(id);
                });
            }

            for (const key of keysToUpdate) {
                const msg = await individualMessageStore.getItem(key);
                if (msg) {
                    const receipts = msg.receipts || {};
                    receipts[lowerFrom] = type;
                    await individualMessageStore.setItem(key, { ...msg, receipts });
                }
            }
        } catch (err) {
            console.error('Failed atomic write for message receipt:', err);
        }
    };

    if (mutex) {
        return mutex.lock(runUpdate);
    } else {
        return runUpdate();
    }
}

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

export async function getJoinedAt() {
    return await settingsStore.getItem('joined_at');
}

export async function setJoinedAt(timestamp) {
    const existing = await getJoinedAt();
    if (!existing) {
        await settingsStore.setItem('joined_at', timestamp);
    }
}

export async function getSavedContacts() {
    return getMutex('visible_contacts').lock(async () => {
        try {
            const contacts = (await messageStore.getItem('visible_contacts')) || [];
            const unique = [];
            const seen = new Set();
            for (const c of contacts) {
                if (!seen.has(c.address.toLowerCase())) {
                    seen.add(c.address.toLowerCase());
                    if (c.avatar && c.avatar.startsWith('file://')) {
                        try {
                            c.avatar = Capacitor.convertFileSrc(c.avatar);
                        } catch (e) { }
                    }
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

export async function saveContacts(contacts) {
    if (!contacts) return;
    return getMutex('visible_contacts').lock(async () => {
        try {
            const minimized = await Promise.all(contacts.map(async c => {
                let avatarUri = c.avatar;
                if (avatarUri && avatarUri.startsWith('data:image')) {
                    try {
                        const base64Content = avatarUri.split(',')[1];
                        const ext = avatarUri.substring("data:image/".length, avatarUri.indexOf(";base64"));
                        const fileName = `avatar_${c.address}.${ext}`;
                        const result = await Filesystem.writeFile({
                            path: `avatars/${fileName}`,
                            data: base64Content,
                            directory: Directory.Cache,
                            recursive: true
                        });
                        avatarUri = result.uri;
                    } catch (e) {
                        console.error('Failed to cache avatar to disk:', e);
                    }
                }
                return {
                    address: c.address,
                    username: c.username,
                    publicKey: c.publicKey,
                    isGroup: c.isGroup,
                    members: c.members,
                    admins: c.admins,
                    lastMessageTime: c.lastMessageTime,
                    unreadCount: c.unreadCount,
                    avatar: avatarUri,
                    status: c.status,
                    isVerified: c.isVerified,
                };
            }));
            await messageStore.setItem('visible_contacts', minimized);
        } catch (err) {
            console.error('Failed to save contacts:', err);
        }
    });
}

export async function clearHistory(chatId) {
    if (!chatId) return;
    const lowerChatId = chatId.toLowerCase();

    await messageStore.removeItem(`chat_${lowerChatId}`);
    
    const allKeys = await individualMessageStore.keys();
    const keysToDelete = allKeys.filter(k => k.startsWith(`msg_${lowerChatId}_`));
    
    await Promise.all(keysToDelete.map(k => individualMessageStore.removeItem(k)));
    
    const messageIds = keysToDelete.map(k => k.split('_').pop());
    await Promise.all(messageIds.map(id => mediaStore.removeItem(id)));
    
    console.debug(`🗑️ History and media cleared for ${lowerChatId}`);
}

export async function clearAllData() {
    await messageStore.clear();
    await individualMessageStore.clear();
    await mediaStore.clear();
    await setStorageSessionKey(null);
    console.log('🗑️ All local chat data cleared');
}

const OUTBOX_KEY = 'pending_outbox';
const outboxMutex = new Mutex();

export async function savePendingMessage(message) {
    if (!message?.id) return;
    return outboxMutex.lock(async () => {
        try {
            const outbox = (await messageStore.getItem(OUTBOX_KEY)) || [];
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

export async function getPendingMessages() {
    try {
        return (await messageStore.getItem(OUTBOX_KEY)) || [];
    } catch (err) {
        console.error('Failed to load outbox:', err);
        return [];
    }
}

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

export async function getPendingMessagesForRecipient(address) {
    const outbox = await getPendingMessages();
    return outbox.filter(m => m.to?.toLowerCase() === address.toLowerCase());
}

// ====== MEDIA WATCH LIST ======

const WATCH_LIST_KEY = 'media_watch_list';

export async function addMediaToWatchList(chatId, mediaId) {
    const list = await settingsStore.getItem(WATCH_LIST_KEY) || [];
    if (!list.find(item => item.mediaId === mediaId)) {
        list.push({ chatId, mediaId, timestamp: Date.now() });
        await settingsStore.setItem(WATCH_LIST_KEY, list);
    }
}

export async function removeMediaFromWatchList(mediaId) {
    const list = await settingsStore.getItem(WATCH_LIST_KEY) || [];
    const filtered = list.filter(item => item.mediaId !== mediaId);
    if (filtered.length !== list.length) {
        await settingsStore.setItem(WATCH_LIST_KEY, filtered);
    }
}

export async function getMediaWatchList() {
    return await settingsStore.getItem(WATCH_LIST_KEY) || [];
}
