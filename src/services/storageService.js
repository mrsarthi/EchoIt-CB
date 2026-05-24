import localforage from 'localforage';
import { insertMessage } from './stateEngine';
import { encryptSymmetric, decryptSymmetric } from '../crypto/crypto';

// In-memory session key for local storage encryption (volatile)
let storageSessionKey = null;

/**
 * Set the session key for local storage encryption (derived from PIN)
 * @param {string} pin 
 */
export async function setStorageSessionKey(pin) {
    if (!pin) {
        storageSessionKey = null;
        return;
    }

    // Derive a strong 32-byte key from the PIN using Argon2
    // Use the user's wallet address as salt for the hash
    const address = localStorage.getItem('decentrachat_address') || 'default_salt';
    
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/argon2.worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
            const { success, hash, error } = e.data;
            worker.terminate();
            if (success) {
                // The hash returned from the worker is the encoded version
                // We use the raw 32 bytes for our symmetric key
                storageSessionKey = hash; 
                console.debug('🔐 Storage session key derived via Argon2 and cached');
                resolve();
            } else {
                reject(new Error(error));
            }
        };
        worker.onerror = (err) => {
            worker.terminate();
            reject(err);
        };
        worker.postMessage({ challenge: pin, salt: address.slice(0, 16) });
    });
}

/**
 * Internal helper to encrypt message content before saving
 */
export function encryptContent(message) {
    if (!storageSessionKey || !message.content || message._isEncrypted) return message;
    
    const { encrypted, nonce } = encryptSymmetric(message.content, storageSessionKey);
    return {
        ...message,
        content: encrypted,
        storageNonce: nonce,
        _isEncrypted: true
    };
}

/**
 * Internal helper to decrypt message content after loading
 */
export function decryptContent(message) {
    if (!storageSessionKey || !message._isEncrypted || !message.storageNonce) return message;
    
    try {
        const decrypted = decryptSymmetric(message.content, message.storageNonce, storageSessionKey);
        if (decrypted) {
            return {
                ...message,
                content: decrypted,
                _isEncrypted: false
            };
        }
    } catch (err) {
        console.error('Failed to decrypt local message:', err);
    }
    return { ...message, content: '[Decryption Failed]' };
}

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
    const allKeys = await individualMessageStore.keys();

    let chatKeys = allKeys.filter(k => k.startsWith(`msg_${lowerChatId}_`));

    if (beforeTimestamp) {
        const prefix = `msg_${lowerChatId}_`;
        chatKeys = chatKeys.filter(k => {
            const suffix = k.substring(prefix.length);
            const ts = parseInt(suffix.split('_')[0]);
            return ts < beforeTimestamp;
        });
    }

    chatKeys.sort().reverse();
    const pageKeys = chatKeys.slice(0, limit);

    const messages = await Promise.all(pageKeys.map(async (k) => {
        const msg = await individualMessageStore.getItem(k);
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
            const allKeys = await individualMessageStore.keys();
            const chatKeys = allKeys.filter(k => k.startsWith(`msg_${lowerChatId}_`));
            
            const prefix = `msg_${lowerChatId}_`;
            const keysToUpdate = chatKeys.filter(k => {
                const suffix = k.substring(prefix.length); 
                const firstUnderscore = suffix.indexOf('_');
                const id = suffix.substring(firstUnderscore + 1); 
                return messageIds.includes(id);
            });

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

            const allKeys = await individualMessageStore.keys();
            const chatPrefix = lowerChatId ? `msg_${lowerChatId}_` : 'msg_';
            const targetKeys = allKeys.filter(key => key.startsWith(chatPrefix));
            
            const keysToUpdate = targetKeys.filter(key => {
                const suffix = key.substring(chatPrefix.length);
                const firstUnderscore = suffix.indexOf('_');
                const id = suffix.substring(firstUnderscore + 1);
                return messageIds.includes(id);
            });

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
            const minimized = contacts.map(c => ({
                address: c.address,
                username: c.username,
                publicKey: c.publicKey,
                isGroup: c.isGroup,
                members: c.members,
                admins: c.admins,
                lastMessageTime: c.lastMessageTime,
                unreadCount: c.unreadCount,
                avatar: c.avatar,
                status: c.status,
                isVerified: c.isVerified,
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
    storageSessionKey = null;
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
