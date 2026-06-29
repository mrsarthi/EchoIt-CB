const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Pool, Client } = require('pg');
const net = require('net');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("FATAL: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

class IPv4Client extends Client {
  constructor(config) {
    const socket = new net.Socket();
    const originalConnect = socket.connect.bind(socket);
    socket.connect = function(options, callback) {
      let opt = options;
      if (typeof opt === 'number') {
        opt = { port: arguments[0], host: arguments[1] };
        callback = arguments[2];
      }
      opt.family = 4; // Force IPv4 to bypass unreachable local IPv6 routing
      return originalConnect(opt, callback);
    };
    super({
      ...config,
      stream: socket
    });
  }
}

const pool = new Pool({
  connectionString,
  Client: IPv4Client,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false
});

// Resiliency wrapper for pool.query and pool.connect to handle Neon DB cold start delays / timeouts
const originalQuery = pool.query.bind(pool);
pool.query = async function (text, params) {
  let retries = 3;
  let delay = 1500;
  while (retries > 0) {
    try {
      return await originalQuery(text, params);
    } catch (err) {
      const isConnectionError = 
        err.message.includes("timeout") || 
        err.message.includes("terminated") || 
        err.message.includes("connection") ||
        err.code === 'ECONNRESET' ||
        err.code === '57P01';
      
      if (isConnectionError && retries > 1) {
        console.warn(`[Database] Query failed (remaining retries: ${retries - 1}): ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries--;
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
};

const originalConnect = pool.connect.bind(pool);
pool.connect = function (callback) {
  if (callback && typeof callback === 'function') {
    return originalConnect(callback);
  }
  return new Promise(async (resolve, reject) => {
    let retries = 5;
    let delay = 1500;
    while (retries > 0) {
      try {
        const client = await originalConnect();
        resolve(client);
        return;
      } catch (err) {
        const isConnectionError = 
          err.message.includes("timeout") || 
          err.message.includes("terminated") || 
          err.message.includes("connection") ||
          err.code === 'ECONNRESET';
          
        if (isConnectionError && retries > 1) {
          console.warn(`[Database] Connect failed (remaining retries: ${retries - 1}): ${err.message}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries--;
          delay *= 2;
        } else {
          reject(err);
          return;
        }
      }
    }
  });
};


const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
      address VARCHAR(42) PRIMARY KEY,
      username VARCHAR(30) UNIQUE NOT NULL,
      identity_key TEXT NOT NULL,       
      signed_pre_key TEXT NOT NULL,     
      pre_key_signature TEXT NOT NULL,  
      push_token TEXT,                  
      registered_at BIGINT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`,
  `CREATE TABLE IF NOT EXISTS one_time_keys (
      address VARCHAR(42) REFERENCES users(address) ON DELETE CASCADE,
      key_id INT NOT NULL,
      public_key TEXT NOT NULL,         
      PRIMARY KEY (address, key_id)
  );`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash VARCHAR(64) PRIMARY KEY,
      address VARCHAR(42) REFERENCES users(address) ON DELETE CASCADE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS outbox (
      id UUID PRIMARY KEY,
      sender_address VARCHAR(42) NOT NULL,
      recipient_address VARCHAR(42) REFERENCES users(address) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,         
      iv VARCHAR(24) NOT NULL,          
      dh_public TEXT NOT NULL,          
      sequence_number INT NOT NULL,     
      timestamp BIGINT NOT NULL,
      x3dh_info TEXT,
      group_id TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_recipient ON outbox(recipient_address);`,
  `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS x3dh_info TEXT;`,
  `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS group_id TEXT;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS stealth_mode BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_wallet BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pfp TEXT;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changes_count INT DEFAULT 0;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_username_change_at BIGINT;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_signing_key TEXT;`
];

async function runMigrations() {
  console.log("Running PostgreSQL migrations...");
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const query of migrations) {
      await client.query(query);
    }
    await client.query('COMMIT');
    console.log("Migrations successfully completed.");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Migration transaction aborted. Rollback executed.", err);
    throw err;
  } finally {
    client.release();
  }
}

// Run migrations immediately if file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("Database initialized.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Database initialization failed:", err);
      process.exit(1);
    });
}

module.exports = {
  pool,
  runMigrations
};
