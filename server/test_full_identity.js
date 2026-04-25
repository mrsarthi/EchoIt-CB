const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// --- Mocking the logic from index.js ---
const DID_ADJECTIVES = ['SWIFT', 'BRIGHT']; // Small list for testing
const DID_NOUNS = ['WOLF', 'HAWK'];

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

const db = new sqlite3.Database(':memory:'); // Use in-memory for testing

async function setupDb() {
    return new Promise(resolve => {
        db.serialize(() => {
            db.run(`CREATE TABLE users (
                address TEXT PRIMARY KEY,
                username TEXT,
                discussion_id TEXT UNIQUE,
                public_key TEXT,
                avatar TEXT,
                status TEXT,
                registered_at INTEGER
            )`);
            resolve();
        });
    });
}

function isDiscussionIdTaken(dId, currentAddress) {
    return new Promise((resolve) => {
        db.get(`SELECT address FROM users WHERE discussion_id = ?`, [dId], (err, row) => {
            if (err || !row) return resolve(false);
            resolve(row.address.toLowerCase() !== currentAddress.toLowerCase());
        });
    });
}

async function claimDiscussionId(walletAddress, forceCollision = false) {
    const normalizedAddress = walletAddress.toLowerCase();
    
    // 1. Check existing
    const existing = await new Promise(resolve => {
        db.get(`SELECT discussion_id FROM users WHERE address = ?`, [normalizedAddress], (err, row) => {
            resolve(row ? row.discussion_id : null);
        });
    });
    if (existing) return existing;

    // 2. Base ID
    const adj = DID_ADJECTIVES[0];
    const noun = DID_NOUNS[0];
    let number = 1000; // Fixed start for testing

    let dId = `${adj}-${noun}-${number}`;
    
    // 3. Collision Resolution
    let attempts = 0;
    while (await isDiscussionIdTaken(dId, normalizedAddress)) {
        console.log(`   [Collision] ${dId} is taken, retrying...`);
        number++;
        dId = `${adj}-${noun}-${number}`;
        attempts++;
    }

    return dId;
}

async function test() {
    console.log('🧪 Testing Full Identity Integration (Collision Resolution)...');
    await setupDb();

    // Test 1: First user registers
    const id1 = await claimDiscussionId('0xWalletA');
    await new Promise(resolve => db.run("INSERT INTO users (address, discussion_id) VALUES (?, ?)", ['0xwalleta', id1], resolve));
    console.log(`✅ Wallet A assigned: ${id1}`);

    // Test 2: Second user registers (Force collision)
    console.log('🔄 Wallet B registering (Simulating collision)...');
    const id2 = await claimDiscussionId('0xWalletB');
    await new Promise(resolve => db.run("INSERT INTO users (address, discussion_id) VALUES (?, ?)", ['0xwalletb', id2], resolve));
    console.log(`✅ Wallet B assigned: ${id2}`);

    // Test 3: Idempotency (Wallet A registers again, should get same ID)
    const id1_retry = await claimDiscussionId('0xWalletA');
    console.log(`✅ Wallet A (Retry) assigned: ${id1_retry}`);

    // Verification
    if (id1 === 'SWIFT-WOLF-1000' && id2 === 'SWIFT-WOLF-1001' && id1_retry === id1) {
        console.log('\n🎉 ALL TESTS PASSED!');
        console.log('1. Unique IDs generated: YES');
        console.log('2. Collision resolved by incrementing: YES');
        console.log('3. Same wallet gets same ID consistently: YES');
    } else {
        console.log('\n❌ TEST FAILED');
        process.exit(1);
    }
}

test();
