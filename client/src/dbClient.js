let DatabaseSync;
try {
  const sqlite = require('node:sqlite');
  DatabaseSync = sqlite.DatabaseSync;
  if (!DatabaseSync) {
    throw new Error('DatabaseSync is not available');
  }
} catch (e) {
  DatabaseSync = class BrowserMockDatabase {
    constructor(dbPath) {
      this.dbPath = dbPath;
      this.tables = {
        key_metadata: [],
        conversations: [],
        messages: [],
        ratchet_sessions: [],
        skipped_message_keys: [],
        one_time_keys: [],
        groups: [],
        group_message_status: []
      };
      this.dbConn = null;
      this.cryptoKey = null;
    }

    async init() {
      if (typeof window === 'undefined') return;
      
      const dbName = 'decentrachat_databases';
      const storeName = 'databases';
      
      this.dbConn = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
          if (!db.objectStoreNames.contains('crypto_keys')) {
            db.createObjectStore('crypto_keys');
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });

      this.cryptoKey = await new Promise((resolve) => {
        const tx = this.dbConn.transaction('crypto_keys', 'readonly');
        const store = tx.objectStore('crypto_keys');
        const getReq = store.get(this.dbPath);
        getReq.onsuccess = async () => {
          if (getReq.result) {
            resolve(getReq.result);
          } else {
            try {
              const newKey = await window.crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                false, // NOT extractable
                ['encrypt', 'decrypt']
              );
              const writeTx = this.dbConn.transaction('crypto_keys', 'readwrite');
              const writeStore = writeTx.objectStore('crypto_keys');
              writeStore.put(newKey, this.dbPath);
              resolve(newKey);
            } catch (err) {
              console.error("Key generation failed:", err);
              resolve(null);
            }
          }
        };
        getReq.onerror = () => resolve(null);
      });

      await this.loadFromStorage();
    }

    async loadFromStorage() {
      if (typeof window === 'undefined' || !this.dbConn) return;
      
      const record = await new Promise((resolve) => {
        const tx = this.dbConn.transaction('databases', 'readonly');
        const store = tx.objectStore('databases');
        const getReq = store.get(this.dbPath);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      });

      // Migrate legacy localStorage database if present
      const legacyKey = `decentrachat_db_${this.dbPath}`;
      const legacyData = window.localStorage.getItem(legacyKey);
      
      if (legacyData) {
        try {
          const parsed = JSON.parse(legacyData);
          this.tables = {
            key_metadata: parsed.key_metadata || [],
            conversations: parsed.conversations || [],
            messages: parsed.messages || [],
            ratchet_sessions: parsed.ratchet_sessions || [],
            skipped_message_keys: parsed.skipped_message_keys || [],
            one_time_keys: parsed.one_time_keys || [],
            groups: parsed.groups || [],
            group_message_status: parsed.group_message_status || []
          };
          await this.saveToStorage();
          window.localStorage.removeItem(legacyKey);
          console.log(`[DB] Successfully migrated legacy db for ${this.dbPath} to encrypted IndexedDB.`);
          return;
        } catch (e) {
          console.error("Failed to migrate legacy db:", e);
        }
      }

      if (record) {
        try {
          const { iv, ciphertext } = record;
          const ivBytes = new Uint8Array(iv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          const encryptedBytes = new Uint8Array(ciphertext.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          
          const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBytes },
            this.cryptoKey,
            encryptedBytes
          );
          
          const dec = new TextDecoder();
          const parsed = JSON.parse(dec.decode(decrypted));
          this.tables = {
            key_metadata: parsed.key_metadata || [],
            conversations: parsed.conversations || [],
            messages: parsed.messages || [],
            ratchet_sessions: parsed.ratchet_sessions || [],
            skipped_message_keys: parsed.skipped_message_keys || [],
            one_time_keys: parsed.one_time_keys || [],
            groups: parsed.groups || [],
            group_message_status: parsed.group_message_status || []
          };
        } catch (e) {
          console.error("Failed to decrypt saved db:", e);
        }
      }
    }

    async saveToStorage() {
      if (typeof window === 'undefined' || !this.dbConn || !this.cryptoKey) return;
      
      try {
        const enc = new TextEncoder();
        const plaintextBytes = enc.encode(JSON.stringify(this.tables));
        
        const ivBytes = new Uint8Array(12);
        window.crypto.getRandomValues(ivBytes);
        
        const encrypted = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: ivBytes },
          this.cryptoKey,
          plaintextBytes
        );
        
        const ivHex = Array.from(ivBytes, b => b.toString(16).padStart(2, '0')).join('');
        const ciphertextHex = Array.from(new Uint8Array(encrypted), b => b.toString(16).padStart(2, '0')).join('');
        
        const record = { iv: ivHex, ciphertext: ciphertextHex };
        
        await new Promise((resolve, reject) => {
          const tx = this.dbConn.transaction('databases', 'readwrite');
          const store = tx.objectStore('databases');
          const putReq = store.put(record, this.dbPath);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        });
      } catch (err) {
        console.error("Failed to encrypt/save db:", err);
      }
    }

    exec(sql) {
      if (sql.includes('DELETE FROM')) {
        if (sql.includes('key_metadata')) this.tables.key_metadata = [];
        if (sql.includes('conversations')) this.tables.conversations = [];
        if (sql.includes('messages')) this.tables.messages = [];
        if (sql.includes('groups')) this.tables.groups = [];
        if (sql.includes('group_message_status')) this.tables.group_message_status = [];
        if (sql.includes('skipped_message_keys')) this.tables.skipped_message_keys = [];
      }
      this.saveToStorage();
    }

    prepare(sql) {
      const self = this;
      const cleanSql = sql.replace(/\s+/g, ' ').trim();

      return {
        run(...params) {
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

          if (cleanSql.includes('INSERT OR REPLACE INTO key_metadata')) {
            const [key, value] = args;
            const idx = self.tables.key_metadata.findIndex(r => r.key === key);
            if (idx !== -1) self.tables.key_metadata[idx].value = value;
            else self.tables.key_metadata.push({ key, value });
          }
          else if (cleanSql.includes('INSERT INTO one_time_keys')) {
            const [key_id, private_key, public_key] = args;
            self.tables.one_time_keys = self.tables.one_time_keys.filter(r => r.key_id !== key_id);
            self.tables.one_time_keys.push({ key_id, private_key, public_key, registered: 0 });
          }
          else if (cleanSql.includes('UPDATE one_time_keys SET registered = 1')) {
            const [key_id] = args;
            const idx = self.tables.one_time_keys.findIndex(r => r.key_id === key_id);
            if (idx !== -1) self.tables.one_time_keys[idx].registered = 1;
          }
          else if (cleanSql.includes('DELETE FROM one_time_keys WHERE key_id = ?')) {
            const [key_id] = args;
            self.tables.one_time_keys = self.tables.one_time_keys.filter(r => r.key_id !== key_id);
          }
          else if (cleanSql.includes('INTO conversations')) {
            let id, username, is_group = 0, last_message_at, created_at, hide_wallet = 0, bio = '', pfp = null;
            if (args.length === 5) {
              if (cleanSql.includes('is_group')) {
                [id, username, is_group, last_message_at, created_at] = args;
              } else {
                [id, username, last_message_at, created_at, hide_wallet] = args;
                is_group = 0;
              }
            } else if (args.length === 4) {
              [id, username, last_message_at, created_at] = args;
              is_group = cleanSql.includes(', 1,') ? 1 : 0;
            } else if (args.length === 6) {
              [id, username, is_group, last_message_at, created_at, hide_wallet] = args;
            } else if (args.length === 7) {
              [id, username, last_message_at, created_at, hide_wallet, bio, pfp] = args;
              is_group = 0;
            } else if (args.length === 8) {
              [id, username, is_group, last_message_at, created_at, hide_wallet, bio, pfp] = args;
            }

            const idx = self.tables.conversations.findIndex(r => r.id === id);
            const row = { id, username, is_group, last_message_at, created_at, hide_wallet, bio, pfp };

            if (cleanSql.includes('INSERT OR REPLACE')) {
              if (idx !== -1) {
                self.tables.conversations[idx] = { ...self.tables.conversations[idx], ...row };
              } else {
                self.tables.conversations.push(row);
              }
            } else {
              // INSERT OR IGNORE
              if (idx === -1) {
                self.tables.conversations.push(row);
              }
            }
          }
          else if (cleanSql.includes('UPDATE conversations SET last_message_at = ? WHERE id = ?')) {
            const [last_message_at, id] = args;
            const idx = self.tables.conversations.findIndex(r => r.id === id);
            if (idx !== -1) self.tables.conversations[idx].last_message_at = last_message_at;
          }
          else if (cleanSql.includes('UPDATE conversations SET username = ?, hide_wallet = ?, bio = ?, pfp = ? WHERE id = ?')) {
            const [username, hide_wallet, bio, pfp, id] = args;
            const idx = self.tables.conversations.findIndex(r => r.id === id);
            if (idx !== -1) {
              self.tables.conversations[idx].username = username;
              self.tables.conversations[idx].hide_wallet = hide_wallet;
              self.tables.conversations[idx].bio = bio;
              self.tables.conversations[idx].pfp = pfp;
            }
          }
          else if (cleanSql.includes('UPDATE conversations SET username = ?, hide_wallet = ? WHERE id = ?')) {
            const [username, hide_wallet, id] = args;
            const idx = self.tables.conversations.findIndex(r => r.id === id);
            if (idx !== -1) {
              // Check if it's the conditional update from Context
              if (cleanSql.includes('AND (username IS NULL OR username LIKE')) {
                const currentUsername = self.tables.conversations[idx].username;
                if (!currentUsername || currentUsername.toLowerCase().startsWith('0x')) {
                  self.tables.conversations[idx].username = username;
                  self.tables.conversations[idx].hide_wallet = hide_wallet;
                }
              } else {
                self.tables.conversations[idx].username = username;
                self.tables.conversations[idx].hide_wallet = hide_wallet;
              }
            }
          }
          else if (cleanSql.includes('INSERT OR REPLACE INTO messages')) {
            let id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata = null, timestamp, status;
            if (args.length === 8) {
              [id, conversation_id, sender_address, recipient_address, ciphertext, body_text, timestamp, status] = args;
            } else {
              [id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status] = args;
            }
            const idx = self.tables.messages.findIndex(r => r.id === id);
            const row = { id, conversation_id, sender_address, recipient_address, ciphertext, body_text, media_metadata, timestamp, status };
            if (idx !== -1) self.tables.messages[idx] = row;
            else self.tables.messages.push(row);
          }
          else if (cleanSql.includes('UPDATE messages SET status = ? WHERE id = ?')) {
            const [status, id] = args;
            const idx = self.tables.messages.findIndex(r => r.id === id);
            if (idx !== -1) self.tables.messages[idx].status = status;
          }
          else if (cleanSql.includes('UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_address != ? AND status = ?')) {
            const [status, conversation_id, sender_address, oldStatus] = args;
            self.tables.messages.forEach(m => {
              if (
                m.conversation_id && m.conversation_id.toLowerCase() === conversation_id.toLowerCase() &&
                m.sender_address && m.sender_address.toLowerCase() !== sender_address.toLowerCase() &&
                m.status === oldStatus
              ) {
                m.status = status;
              }
            });
          }
          else if (cleanSql.includes('INSERT OR REPLACE INTO groups')) {
            const [id, name, group_key, members] = args;
            const idx = self.tables.groups.findIndex(r => r.id === id);
            const row = { id, name, group_key, members };
            if (idx !== -1) self.tables.groups[idx] = row;
            else self.tables.groups.push(row);
          }
          else if (cleanSql.includes('INSERT OR REPLACE INTO group_message_status')) {
            const [message_id, user_address, status, timestamp] = args;
            const idx = self.tables.group_message_status.findIndex(r => r.message_id === message_id && r.user_address === user_address);
            const row = { message_id, user_address, status, timestamp };
            if (idx !== -1) self.tables.group_message_status[idx] = row;
            else self.tables.group_message_status.push(row);
          }
          else if (cleanSql.includes('INSERT OR REPLACE INTO ratchet_sessions')) {
            const [
              peer_address, root_key, sending_chain_key, receiving_chain_key,
              dh_local_private, dh_local_public, dh_remote_public,
              previous_chain_length, sequence_send, sequence_receive
            ] = args;
            const idx = self.tables.ratchet_sessions.findIndex(r => r.peer_address === peer_address);
            const row = {
              peer_address, root_key, sending_chain_key, receiving_chain_key,
              dh_local_private, dh_local_public, dh_remote_public,
              previous_chain_length, sequence_send, sequence_receive
            };
            if (idx !== -1) self.tables.ratchet_sessions[idx] = row;
            else self.tables.ratchet_sessions.push(row);
          }
          else if (cleanSql.includes('INSERT OR REPLACE INTO skipped_message_keys')) {
            const [peer_address, dh_remote_public, sequence_number, message_key, created_at] = args;
            const idx = self.tables.skipped_message_keys.findIndex(r => 
              r.peer_address === peer_address && 
              r.dh_remote_public === dh_remote_public && 
              r.sequence_number === sequence_number
            );
            const row = { peer_address, dh_remote_public, sequence_number, message_key, created_at };
            if (idx !== -1) self.tables.skipped_message_keys[idx] = row;
            else self.tables.skipped_message_keys.push(row);
          }
          else if (cleanSql.includes('DELETE FROM skipped_message_keys WHERE peer_address = ? AND dh_remote_public = ? AND sequence_number = ?')) {
            const [peer_address, dh_remote_public, sequence_number] = args;
            self.tables.skipped_message_keys = self.tables.skipped_message_keys.filter(r => 
              !(r.peer_address === peer_address && r.dh_remote_public === dh_remote_public && r.sequence_number === sequence_number)
            );
          }
          else if (cleanSql.includes('DELETE FROM key_metadata')) {
            self.tables.key_metadata = [];
          }
          else if (cleanSql.includes('DELETE FROM conversations')) {
            self.tables.conversations = [];
          }
          else if (cleanSql.includes('DELETE FROM messages')) {
            self.tables.messages = [];
          }
          else if (cleanSql.includes('DELETE FROM groups')) {
            self.tables.groups = [];
          }
          else if (cleanSql.includes('DELETE FROM skipped_message_keys') && args.length === 0) {
            self.tables.skipped_message_keys = [];
          }

          self.saveToStorage();
          return { changes: 1, lastInsertRowid: Date.now() };
        },

        get(...params) {
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

          if (cleanSql.includes('SELECT value FROM key_metadata WHERE key = ?')) {
            const [key] = args;
            return self.tables.key_metadata.find(r => r.key === key);
          }
          else if (cleanSql.includes('SELECT MAX(key_id) as maxId FROM one_time_keys')) {
            const ids = self.tables.one_time_keys.map(r => r.key_id);
            return { maxId: ids.length > 0 ? Math.max(...ids) : 0 };
          }
          else if (cleanSql.includes('FROM groups WHERE id = ?')) {
            const [id] = args;
            return self.tables.groups.find(r => r.id === id);
          }
          else if (cleanSql.includes('SELECT * FROM ratchet_sessions WHERE peer_address = ?')) {
            const [peer_address] = args;
            return self.tables.ratchet_sessions.find(r => r.peer_address === peer_address);
          }
          else if (cleanSql.includes('SELECT private_key FROM one_time_keys WHERE key_id = ?')) {
            const [key_id] = args;
            return self.tables.one_time_keys.find(r => r.key_id === key_id);
          }
          else if (cleanSql.includes('SELECT message_key FROM skipped_message_keys')) {
            const [peer_address, dh_remote_public, sequence_number] = args;
            return self.tables.skipped_message_keys.find(r => 
              r.peer_address === peer_address && 
              r.dh_remote_public === dh_remote_public && 
              r.sequence_number === sequence_number
            );
          }
          return undefined;
        },

        all(...params) {
          const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          if (cleanSql.includes('SELECT * FROM key_metadata')) {
            return self.tables.key_metadata;
          }
          else if (cleanSql.includes('SELECT * FROM conversations')) {
            return [...self.tables.conversations].sort((a, b) => b.last_message_at - a.last_message_at);
          }
          else if (cleanSql.includes('SELECT * FROM messages WHERE conversation_id = ?')) {
            const [convId] = args;
            console.warn("[MockDB] SELECT * FROM messages WHERE conversation_id = ?", convId, "All messages in DB:", self.tables.messages);
            if (!convId) return [];
            return [...self.tables.messages]
              .filter(m => m.conversation_id && m.conversation_id.toLowerCase() === convId.toLowerCase())
              .sort((a, b) => a.timestamp - b.timestamp);
          }
          else if (cleanSql.includes('SELECT * FROM messages')) {
            console.warn("[MockDB] FALL-THROUGH matched SELECT * FROM messages. cleanSql is:", cleanSql);
            return [...self.tables.messages].sort((a, b) => a.timestamp - b.timestamp);
          }
          else if (cleanSql.includes('SELECT * FROM groups')) {
            return self.tables.groups;
          }
          else if (cleanSql.includes('SELECT * FROM group_message_status WHERE message_id = ?')) {
            const [msgId] = args;
            return self.tables.group_message_status.filter(r => r.message_id === msgId);
          }
          else if (cleanSql.includes('SELECT * FROM group_message_status')) {
            return self.tables.group_message_status;
          }
          return [];
        }
      };
    }

    close() {
      // no-op
    }
  };
}
const path = require('path');

class FIFOQueue {
  constructor() {
    this.queue = Promise.resolve();
  }

  async enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}

class DBClient {
  constructor(dbPath = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.writeMutex = new FIFOQueue();
    this.initialize();
  }

  initialize() {
    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON');

    // Create tables synchronously
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS key_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        is_group INTEGER DEFAULT 0,
        last_message_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        hide_wallet INTEGER DEFAULT 0,
        bio TEXT,
        pfp TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        ciphertext TEXT,
        body_text TEXT,
        media_metadata TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ratchet_sessions (
        peer_address TEXT PRIMARY KEY,
        root_key TEXT NOT NULL,
        sending_chain_key TEXT NOT NULL,
        receiving_chain_key TEXT NOT NULL,
        dh_local_private TEXT NOT NULL,
        dh_local_public TEXT NOT NULL,
        dh_remote_public TEXT NOT NULL,
        previous_chain_length INTEGER NOT NULL,
        sequence_send INTEGER DEFAULT 0,
        sequence_receive INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS skipped_message_keys (
        peer_address TEXT NOT NULL,
        dh_remote_public TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        message_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (peer_address, dh_remote_public, sequence_number)
      );

      CREATE TABLE IF NOT EXISTS one_time_keys (
        key_id INTEGER PRIMARY KEY,
        private_key TEXT NOT NULL,
        public_key TEXT NOT NULL,
        registered INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_key TEXT NOT NULL,
        members TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_message_status (
        message_id TEXT NOT NULL,
        user_address TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp INTEGER,
        PRIMARY KEY (message_id, user_address)
      );
    `);

    try {
      this.db.exec('ALTER TABLE conversations ADD COLUMN hide_wallet INTEGER DEFAULT 0');
    } catch (e) {
      // Ignore if column already exists
    }
    try {
      this.db.exec('ALTER TABLE conversations ADD COLUMN bio TEXT');
    } catch (e) {
      // Ignore if column already exists
    }
    try {
      this.db.exec('ALTER TABLE conversations ADD COLUMN pfp TEXT');
    } catch (e) {
      // Ignore if column already exists
    }
  }

  // Generic write execution wrapped in the Mutex
  async write(operation) {
    return this.writeMutex.enqueue(async () => {
      return operation(this.db);
    });
  }

  // Generic read execution (direct run without mutex since reads are concurrent-safe in SQLite)
  async read(operation) {
    return operation(this.db);
  }

  async init() {
    if (this.db.init) {
      await this.db.init();
    }
  }

  close() {
    if (this.db.close) {
      this.db.close();
    }
  }
}

module.exports = DBClient;
