// secureStorage.js: OS Keychain/Keystore Binding Simulation

export const getSecureKey = async (alias) => {
  try {
    // If Capacitor is running on a native device with Preferences, use it.
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: alias });
      if (value) return value;
      
      // Generate a new secure 256-bit key if not found
      const newKey = generateSecureRandomKey();
      await Preferences.set({ key: alias, value: newKey });
      return newKey;
    }
  } catch (e) {
    console.warn("[SecureStorage] Capacitor preferences import failed, using localStorage fallback:", e.message);
  }

  // Fallback for standard browsers using IndexedDB instead of localStorage
  const localKey = `secure_alias_${alias}`;
  let value = await getIDBValue(localKey);
  if (!value) {
    // Migrate legacy keys if present
    value = localStorage.getItem(localKey);
    if (value) {
      await setIDBValue(localKey, value);
      localStorage.removeItem(localKey);
    } else {
      value = generateSecureRandomKey();
      await setIDBValue(localKey, value);
    }
  }
  return value;
};

// Simple async IndexedDB helper functions
function getIDBValue(key) {
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
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function setIDBValue(key, value) {
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
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => resolve(false);
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// Generates a 256-bit secure hex key
function generateSecureRandomKey() {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('[FATAL] Secure randomness is required for key generation.');
}
