/**
 * Crypto Worker Utility
 * Offloads heavy cryptographic operations to a background thread.
 */

let worker = null;
const pendingTasks = new Map();
let nextTaskId = 0;

function getWorker() {
    if (!worker) {
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
        };
    }
    return worker;
}

function runTask(type, payload) {
    return new Promise((resolve, reject) => {
        const id = nextTaskId++;
        pendingTasks.set(id, { resolve, reject });
        getWorker().postMessage({ id, type, payload });
    });
}

export const cryptoWorker = {
    encryptSymmetric: (plaintext, key) => runTask('encryptSymmetric', { plaintext, key }),
    decryptSymmetric: (ciphertext, nonce, key) => runTask('decryptSymmetric', { ciphertext, nonce, key }),
    hmacSha256: (key, data) => runTask('hmacSha256', { key, data })
};
