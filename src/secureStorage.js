// secureStorage.js: Key Storage and Biometric Authentication
import { BiometricAuth, AndroidBiometryStrength } from '@aparajita/capacitor-biometric-auth';
import { Preferences } from '@capacitor/preferences';
import { argon2id } from 'hash-wasm';
import crypto from 'crypto';
import { Buffer } from 'buffer';

// Helper to detect native Capacitor platform on boot before window.Capacitor injection
export function isNativePlatform() {
  if (typeof window === 'undefined') return false;
  if (window.Capacitor?.isNativePlatform?.()) return true;
  // Fallbacks for early boot detection
  if (navigator.userAgent && (
    navigator.userAgent.includes('DecentraChat-Android') || 
    navigator.userAgent.includes('Capacitor')
  )) {
    return true;
  }
  if (window.location && (
    window.location.protocol === 'capacitor:' || 
    window.location.protocol === 'http-extension:' ||
    (window.location.hostname === 'localhost' && !window.location.port && window.location.protocol === 'https:')
  )) {
    return true;
  }
  return false;
}

// Unified Secure Storage Functions (Preferences-first, falling back to IndexedDB)
export async function getIDBValue(key) {
  try {
    const { value } = await Preferences.get({ key });
    if (value) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
  } catch (e) {
    console.warn(`[secureStorage] Preferences get failed for ${key}, falling back to IndexedDB:`, e);
  }

  // Fallback to IndexedDB (e.g. legacy browser support or fallback)
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('decentrachat_secure_storage', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys');
        }
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('keys', 'readonly');
        const store = tx.objectStore('keys');
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          resolve(getReq.result || null);
          db.close();
        };
        getReq.onerror = () => {
          resolve(null);
          db.close();
        };
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setIDBValue(key, value) {
  try {
    await Preferences.set({ key, value: typeof value === 'string' ? value : JSON.stringify(value) });
  } catch (e) {
    console.warn(`[secureStorage] Preferences set failed for ${key}:`, e);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('decentrachat_secure_storage', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys');
        }
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('keys', 'readwrite');
        const store = tx.objectStore('keys');
        const putReq = store.put(value, key);
        putReq.onsuccess = () => {
          resolve(true);
          db.close();
        };
        putReq.onerror = () => {
          resolve(false);
          db.close();
        };
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function removeIDBValue(key) {
  try {
    await Preferences.remove({ key });
  } catch (e) {
    console.warn(`[secureStorage] Preferences remove failed for ${key}:`, e);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('decentrachat_secure_storage', 1);
      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('keys', 'readwrite');
        const store = tx.objectStore('keys');
        const delReq = store.delete(key);
        delReq.onsuccess = () => {
          resolve(true);
          db.close();
        };
        delReq.onerror = () => {
          resolve(false);
          db.close();
        };
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// Check if biometric authentication is available on this device
export async function isBiometricsAvailable() {
  if (isNativePlatform()) {
    try {
      const result = await BiometricAuth.checkBiometry();
      return result.isAvailable;
    } catch (e) {
      console.warn("Biometrics check failed or unavailable:", e);
      return false;
    }
  }
  return false;
}

let isBiometricPromptActive = false;

// Request biometric verification
export async function authenticateBiometrics(reason = 'Verify your identity to unlock EchoIt') {
  if (isNativePlatform()) {
    if (isBiometricPromptActive) {
      console.warn("Biometric prompt is already active. Ignoring duplicate request.");
      return false;
    }
    isBiometricPromptActive = true;
    try {
      await BiometricAuth.checkBiometry();
      await BiometricAuth.authenticate({
        reason,
        cancelTitle: 'Cancel',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Use Passcode',
        androidTitle: 'Biometric Login',
        androidSubtitle: 'Use fingerprint or FaceID to authenticate',
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
      isBiometricPromptActive = false;
      return true;
    } catch (e) {
      console.warn("Biometric authentication failed:", e);
      isBiometricPromptActive = false;
      return false;
    }
  }
  return false;
}

// Derive cryptographic key from password using Argon2id with native PBKDF2 fallback
async function deriveKDFKey(password, saltHex, kdfType) {
  const saltBytes = Buffer.from(saltHex, 'hex');
  if (kdfType === 'argon2id') {
    try {
      const hashBytes = await argon2id({
        password: password,
        salt: saltBytes,
        iterations: 2,
        memorySize: 16384, // 16MB
        parallelism: 1,
        hashLength: 32,
        outputType: 'binary'
      });
      return Buffer.from(hashBytes);
    } catch (e) {
      console.warn("Argon2id derivation failed, falling back to PBKDF2:", e.message);
      // Fallback to PBKDF2 in case WASM loading failed
      kdfType = 'pbkdf2';
    }
  }

  // Fallback PBKDF2 (Native, zero dependencies)
  return crypto.pbkdf2Sync(password, saltBytes, 100000, 32, 'sha256');
}

// Encrypt plaintext string using password
export async function encryptMnemonicWithPassword(mnemonic, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  let kdfType = 'argon2id';

  let key;
  try {
    key = await deriveKDFKey(password, salt.toString('hex'), kdfType);
  } catch (e) {
    kdfType = 'pbkdf2';
    key = await deriveKDFKey(password, salt.toString('hex'), kdfType);
  }

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('hex'),
    tag: tag.toString('hex'),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    kdfType
  };
}

// Decrypt ciphertext using password
export async function decryptMnemonicWithPassword(bundle, password) {
  const { ciphertext, tag, salt, iv, kdfType } = bundle;
  const key = await deriveKDFKey(password, salt, kdfType);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

// Save encrypted mnemonic to IndexedDB
export async function savePasswordEncryptedMnemonic(mnemonic, password) {
  const bundle = await encryptMnemonicWithPassword(mnemonic, password);
  await setIDBValue('password_encrypted_mnemonic', bundle);
  return bundle;
}

// Load and decrypt mnemonic from IndexedDB using password
export async function loadPasswordEncryptedMnemonic(password) {
  const bundle = await getIDBValue('password_encrypted_mnemonic');
  if (!bundle) throw new Error('No encrypted mnemonic found');
  return await decryptMnemonicWithPassword(bundle, password);
}

// Save encrypted mnemonic for biometrics
export async function saveBiometricEncryptedMnemonic(mnemonic) {
  const biometricKey = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  
  // Encrypt mnemonic with raw biometricKey using PBKDF2/scrypt for simplicity (since it's already high entropy)
  const key = crypto.pbkdf2Sync(biometricKey, salt, 1000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const bundle = {
    ciphertext: encrypted.toString('hex'),
    tag: tag.toString('hex'),
    salt: salt.toString('hex'),
    iv: iv.toString('hex')
  };

  await setIDBValue('biometric_encrypted_mnemonic', bundle);

  // Store biometric key securely in native preferences
  await Preferences.set({ key: 'biometric_key', value: biometricKey });
}

// Load and decrypt mnemonic using biometrics
export async function loadBiometricEncryptedMnemonic() {
  const bundle = await getIDBValue('biometric_encrypted_mnemonic');
  if (!bundle) throw new Error('No biometric credentials set up');

  if (isNativePlatform()) {
    const success = await authenticateBiometrics('Unlock EchoIt with your biometrics');
    if (!success) throw new Error('Biometric authentication failed');
  }

  const { value } = await Preferences.get({ key: 'biometric_key' });
  const biometricKey = value;

  if (!biometricKey) throw new Error('Biometric key not found');

  const { ciphertext, tag, salt, iv } = bundle;
  const key = crypto.pbkdf2Sync(biometricKey, Buffer.from(salt, 'hex'), 1000, 32, 'sha256');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

export async function deleteBiometricCredentials() {
  await removeIDBValue('biometric_encrypted_mnemonic');
  await Preferences.remove({ key: 'biometric_key' });
}
