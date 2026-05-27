import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

let useArgon2Fallback = false;

export async function hashArgon2(challenge, salt) {
    if (useArgon2Fallback) {
        return runArgon2Locally(challenge, salt);
    }

    return new Promise((resolve, reject) => {
        let worker;
        const timeout = setTimeout(() => {
            console.warn("⚠️ Argon2 worker timed out. Running Argon2 on main thread.");
            useArgon2Fallback = true;
            if (worker) {
                try { worker.terminate(); } catch (e) {}
            }
            runArgon2Locally(challenge, salt).then(resolve).catch(reject);
        }, 1500);

        try {
            worker = new Worker(new URL('../workers/argon2.worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => {
                clearTimeout(timeout);
                const { success, hash, error } = e.data;
                try { worker.terminate(); } catch (e) {}
                if (success) resolve(hash);
                else reject(new Error(error));
            };
            worker.onerror = (err) => {
                clearTimeout(timeout);
                console.error("Argon2 Worker Error:", err);
                useArgon2Fallback = true;
                try { worker.terminate(); } catch (e) {}
                runArgon2Locally(challenge, salt).then(resolve).catch(reject);
            };
            worker.postMessage({ challenge, salt });
        } catch (err) {
            clearTimeout(timeout);
            console.error("Failed to instantiate Argon2 worker:", err);
            useArgon2Fallback = true;
            runArgon2Locally(challenge, salt).then(resolve).catch(reject);
        }
    });
}

async function runArgon2Locally(challenge, salt) {
    try {
        const result = await argon2.hash({
            pass: challenge,
            salt: salt,
            time: 2,
            mem: 16384,
            hashLen: 32,
            parallelism: 1,
            type: argon2.ArgonType.Argon2id
        });
        return btoa(String.fromCharCode.apply(null, result.hash));
    } catch (err) {
        console.error("Local Argon2 hash failed:", err);
        throw err;
    }
}
