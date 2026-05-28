import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    try {
        let result;
        switch (type) {
            case 'encryptSymmetric':
                result = encryptSymmetric(payload.plaintext, payload.key);
                break;
            case 'decryptSymmetric':
                result = decryptSymmetric(payload.ciphertext, payload.nonce, payload.key);
                break;
            case 'hmacSha256':
                result = await hmacSha256(payload.key, payload.data);
                break;
            case 'dhBefore':
                result = dhBefore(payload.publicKeyBase64, payload.secretKeyBase64);
                break;
            case 'generateKeyPair':
                result = generateKeyPair();
                break;
            case 'ratchetEpochKey':
                result = ratchetEpochKey(payload.currentKeyBase64);
                break;
            case 'encryptGroupMessage':
                result = encryptGroupMessage(payload.epochKeyBase64, payload.plaintext, payload.myEd25519SecretBase64, payload.messageId, payload.timestamp);
                break;
            case 'decryptGroupMessage':
                result = decryptGroupMessage(payload.epochKeyBase64, payload.ciphertextBase64, payload.nonceBase64, payload.signatureBase64, payload.senderPublicSignKeyBase64, payload.messageId, payload.timestamp);
                break;
            default:
                throw new Error(`Unknown crypto task type: ${type}`);
        }

        self.postMessage({ id, success: true, result });
    } catch (err) {
        self.postMessage({ id, success: false, error: err.message });
    }
};

function encryptSymmetric(plaintext, keyBase64) {
    const key = decodeBase64(keyBase64);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(decodeUTF8(plaintext), nonce, key);
    
    return {
        ciphertext: encodeBase64(encrypted),
        nonce: encodeBase64(nonce)
    };
}

function decryptSymmetric(ciphertextBase64, nonceBase64, keyBase64) {
    const key = decodeBase64(keyBase64);
    const nonce = decodeBase64(nonceBase64);
    const ciphertext = decodeBase64(ciphertextBase64);
    
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) throw new Error('Decryption failed');
    
    return encodeUTF8(decrypted);
}

async function hmacSha256(keyBase64, data) {
    const key = decodeBase64(keyBase64);
    const dataBuffer = typeof data === 'string' ? decodeUTF8(data) : data;

    const importedKey = await self.crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const signature = await self.crypto.subtle.sign('HMAC', importedKey, dataBuffer);
    return encodeBase64(new Uint8Array(signature));
}

function ratchetEpochKey(currentKeyBase64) {
    const currentKey = decodeBase64(currentKeyBase64);
    const hash = nacl.hash(currentKey);
    const nextKey = hash.slice(0, nacl.secretbox.keyLength);
    return encodeBase64(nextKey);
}

function encryptGroupMessage(epochKeyBase64, plaintext, myEd25519SecretBase64, messageId, timestamp) {
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

function decryptGroupMessage(epochKeyBase64, ciphertextBase64, nonceBase64, signatureBase64, senderPublicSignKeyBase64, messageId, timestamp) {
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

function dhBefore(publicKeyBase64, secretKeyBase64) {
    const pub = decodeBase64(publicKeyBase64);
    const sec = decodeBase64(secretKeyBase64);
    const shared = nacl.box.before(pub, sec);
    return encodeBase64(shared);
}

function generateKeyPair() {
    const kp = nacl.box.keyPair();
    return {
        publicKey: encodeBase64(kp.publicKey),
        secretKey: encodeBase64(kp.secretKey)
    };
}
