import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

let worker = null;
const pendingTasks = new Map();
let nextTaskId = 0;
let useFallback = false;

// Local fallback implementations of crypto operations to run in the main thread
function localEncryptSymmetric(plaintext, keyBase64) {
    const key = decodeBase64(keyBase64);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(decodeUTF8(plaintext), nonce, key);
    return {
        ciphertext: encodeBase64(encrypted),
        nonce: encodeBase64(nonce)
    };
}

function localDecryptSymmetric(ciphertextBase64, nonceBase64, keyBase64) {
    const key = decodeBase64(keyBase64);
    const nonce = decodeBase64(nonceBase64);
    const ciphertext = decodeBase64(ciphertextBase64);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) throw new Error('Decryption failed');
    return encodeUTF8(decrypted);
}

async function localHmacSha256(keyBase64, data) {
    const key = decodeBase64(keyBase64);
    const dataBuffer = typeof data === 'string' ? decodeUTF8(data) : data;
    const subtle = typeof window !== 'undefined' ? (window.crypto?.subtle || window.crypto?.webkitSubtle) : null;
    if (!subtle) {
        throw new Error('Web Crypto Subtle API is not available on this device');
    }
    const importedKey = await subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await subtle.sign('HMAC', importedKey, dataBuffer);
    return encodeBase64(new Uint8Array(signature));
}

function localDhBefore(publicKeyBase64, secretKeyBase64) {
    const pub = decodeBase64(publicKeyBase64);
    const sec = decodeBase64(secretKeyBase64);
    const shared = nacl.box.before(pub, sec);
    return encodeBase64(shared);
}

function localGenerateKeyPair() {
    const kp = nacl.box.keyPair();
    return {
        publicKey: encodeBase64(kp.publicKey),
        secretKey: encodeBase64(kp.secretKey)
    };
}

function localRatchetEpochKey(currentKeyBase64) {
    const currentKey = decodeBase64(currentKeyBase64);
    const hash = nacl.hash(currentKey);
    const nextKey = hash.slice(0, nacl.secretbox.keyLength);
    return encodeBase64(nextKey);
}

async function localDeriveEpochKey(rootKey, epochIndex) {
    const label = `epoch_derivation_${epochIndex}`;
    const key = typeof rootKey === 'string' ? rootKey : encodeBase64(rootKey);
    return await localHmacSha256(key, label);
}

async function localRatchetMessageKey(chainKeyBase64) {
    const messageKeyBase64 = await localHmacSha256(chainKeyBase64, 'message_key');
    const nextChainKeyBase64 = await localHmacSha256(chainKeyBase64, 'next_chain_key');
    
    return {
        messageKey: messageKeyBase64,
        nextChainKey: nextChainKeyBase64
    };
}

function localEncryptGroupMessage(epochKeyBase64, plaintext, myEd25519SecretBase64, messageId, timestamp) {
    const epochKey = decodeBase64(epochKeyBase64);
    const mySecret = decodeBase64(myEd25519SecretBase64);
    const plaintextUint8 = decodeUTF8(plaintext);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

    const ciphertext = nacl.secretbox(plaintextUint8, nonce, epochKey);

    const metaBytes = decodeUTF8(`${messageId}:${timestamp}`);
    const payloadToSign = new Uint8Array(nonce.length + ciphertext.length + metaBytes.length);
    payloadToSign.set(nonce);
    payloadToSign.set(ciphertext, nonce.length);
    payloadToSign.set(metaBytes, nonce.length + ciphertext.length);
    
    const signature = nacl.sign.detached(payloadToSign, mySecret);

    return {
        ciphertext: encodeBase64(ciphertext),
        nonce: encodeBase64(nonce),
        signature: encodeBase64(signature)
    };
}

function localDecryptGroupMessage(epochKeyBase64, ciphertextBase64, nonceBase64, signatureBase64, senderPublicSignKeyBase64, messageId, timestamp) {
    const epochKey = decodeBase64(epochKeyBase64);
    const ciphertext = decodeBase64(ciphertextBase64);
    const nonce = decodeBase64(nonceBase64);
    const signature = decodeBase64(signatureBase64);
    const senderPubKey = decodeBase64(senderPublicSignKeyBase64);

    const metaBytes = decodeUTF8(`${messageId}:${timestamp}`);
    const payloadToVerify = new Uint8Array(nonce.length + ciphertext.length + metaBytes.length);
    payloadToVerify.set(nonce);
    payloadToVerify.set(ciphertext, nonce.length);
    payloadToVerify.set(metaBytes, nonce.length + ciphertext.length);

    const isValid = nacl.sign.detached.verify(payloadToVerify, signature, senderPubKey);
    if (!isValid) throw new Error('Invalid Sender Signature');

    const decrypted = nacl.secretbox.open(ciphertext, nonce, epochKey);
    if (!decrypted) throw new Error('Invalid MAC');

    return encodeUTF8(decrypted);
}

// Routes task either to the worker or executes it locally if worker fails or is disabled
async function runTaskLocally(type, payload) {
    switch (type) {
        case 'encryptSymmetric':
            return localEncryptSymmetric(payload.plaintext, payload.key);
        case 'decryptSymmetric':
            return localDecryptSymmetric(payload.ciphertext, payload.nonce, payload.key);
        case 'hmacSha256':
            return await localHmacSha256(payload.key, payload.data);
        case 'dhBefore':
            return localDhBefore(payload.publicKeyBase64, payload.secretKeyBase64);
        case 'generateKeyPair':
            return localGenerateKeyPair();
        case 'ratchetEpochKey':
            return localRatchetEpochKey(payload.currentKeyBase64);
        case 'deriveEpochKey':
            return await localDeriveEpochKey(payload.rootKey, payload.epochIndex);
        case 'ratchetMessageKey':
            return await localRatchetMessageKey(payload.chainKeyBase64);
        case 'encryptGroupMessage':
            return localEncryptGroupMessage(payload.epochKeyBase64, payload.plaintext, payload.myEd25519SecretBase64, payload.messageId, payload.timestamp);
        case 'decryptGroupMessage':
            return localDecryptGroupMessage(
                payload.epochKeyBase64,
                payload.ciphertextBase64,
                payload.nonceBase64,
                payload.signatureBase64,
                payload.senderPublicSignKeyBase64,
                payload.messageId,
                payload.timestamp
            );
        default:
            throw new Error(`Unknown local task type: ${type}`);
    }
}

function getWorker() {
    if (useFallback) return null;
    if (!worker) {
        try {
            // Use string path to avoid Vite's auto-importing issues with WASM/Worker analysis in some environments
            worker = new Worker(new URL('../workers/crypto.worker.js', import.meta.url), { type: 'module' });
            
            worker.onmessage = (e) => {
                const { id, success, result, error } = e.data;
                const task = pendingTasks.get(id);
                if (task) {
                    pendingTasks.delete(id);
                    if (success) task.resolve(result);
                    else task.reject(new Error(error));
                }
            };

            worker.onerror = (err) => {
                console.error('Crypto Worker Error:', err);
                triggerFallback('Worker encountered an error');
            };
        } catch (err) {
            console.error('Failed to create Crypto Worker, falling back to local crypto:', err);
            useFallback = true;
        }
    }
    return worker;
}

function triggerFallback(reason) {
    if (useFallback) return;
    console.warn(`⚠️ Switching to main-thread local crypto: ${reason}`);
    useFallback = true;
    
    // Resolve all pending tasks using local implementations
    const tasks = Array.from(pendingTasks.entries());
    for (const [id, task] of tasks) {
        pendingTasks.delete(id);
        if (task.isPing) {
            task.reject(new Error(reason));
        } else {
            runTaskLocally(task.type, task.payload)
                .then(task.resolve)
                .catch(task.reject);
        }
    }
}

// Perform a ping check on worker initialization
function initWorkerPing() {
    try {
        const testWorker = getWorker();
        if (!testWorker) {
            useFallback = true;
            return;
        }
        
        const pingId = nextTaskId++;
        const pingTimeout = setTimeout(() => {
            triggerFallback('Worker ping timeout');
        }, 500);

        pendingTasks.set(pingId, {
            isPing: true,
            resolve: () => {
                clearTimeout(pingTimeout);
                console.log('✅ Crypto Worker active and responsive.');
            },
            reject: () => {
                clearTimeout(pingTimeout);
            }
        });

        testWorker.postMessage({ id: pingId, type: 'generateKeyPair', payload: {} });
    } catch (err) {
        console.error('Failed to ping Crypto Worker:', err);
        useFallback = true;
    }
}

// Start the worker check immediately
if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') {
        initWorkerPing();
    } else {
        window.addEventListener('load', initWorkerPing);
    }
}

function runTask(type, payload) {
    if (useFallback) {
        return runTaskLocally(type, payload);
    }

    return new Promise((resolve, reject) => {
        const id = nextTaskId++;
        pendingTasks.set(id, { resolve, reject, type, payload });
        try {
            const w = getWorker();
            if (w) {
                w.postMessage({ id, type, payload });
            } else {
                throw new Error('Worker not created');
            }
        } catch (err) {
            // Immediately resolve/reject this and trigger fallback
            pendingTasks.delete(id);
            triggerFallback(`Worker postMessage failed: ${err.message}`);
            resolve(runTaskLocally(type, payload));
        }
    });
}

export const cryptoWorker = {
    encryptSymmetric: (plaintext, key) => runTask('encryptSymmetric', { plaintext, key }),
    decryptSymmetric: (ciphertext, nonce, key) => runTask('decryptSymmetric', { ciphertext, nonce, key }),
    hmacSha256: (key, data) => runTask('hmacSha256', { key, data }),
    dhBefore: (publicKeyBase64, secretKeyBase64) => runTask('dhBefore', { publicKeyBase64, secretKeyBase64 }),
    generateKeyPair: () => runTask('generateKeyPair', {}),
    ratchetEpochKey: (currentKeyBase64) => runTask('ratchetEpochKey', { currentKeyBase64 }),
    deriveEpochKey: (rootKey, epochIndex) => runTask('deriveEpochKey', { rootKey, epochIndex }),
    ratchetMessageKey: (chainKeyBase64) => runTask('ratchetMessageKey', { chainKeyBase64 }),
    encryptGroupMessage: (epochKeyBase64, plaintext, myEd25519SecretBase64, messageId, timestamp) => runTask('encryptGroupMessage', { epochKeyBase64, plaintext, myEd25519SecretBase64, messageId, timestamp }),
    decryptGroupMessage: (epochKeyBase64, ciphertextBase64, nonceBase64, signatureBase64, senderPublicSignKeyBase64, messageId, timestamp) => runTask('decryptGroupMessage', { epochKeyBase64, ciphertextBase64, nonceBase64, signatureBase64, senderPublicSignKeyBase64, messageId, timestamp })
};
