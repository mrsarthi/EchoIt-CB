import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

self.onmessage = async (e) => {
    const { challenge, salt } = e.data;
    
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

        const base64Hash = btoa(String.fromCharCode.apply(null, result.hash));
        self.postMessage({ success: true, hash: base64Hash });
    } catch (err) {
        self.postMessage({ success: false, error: err.message });
    }
};
