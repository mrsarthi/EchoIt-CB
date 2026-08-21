/**
 * Proves the keychain works *through the IPC*, on the device it will run on.
 *
 * The Rust unit test in `src-tauri/src/keychain.rs` covers the store itself,
 * but only on the host that runs `cargo test` — which is never Android. This
 * check runs inside the app, so plugging in a phone exercises the real Android
 * Keystore path with no extra tooling.
 *
 * It writes under a throwaway account name and removes it again, so it never
 * touches the real storage key.
 */

import { keychain } from './keychain';

const PROBE_ACCOUNT = 'self-test-do-not-use';

export interface KeychainSelfCheck {
  status: 'PASSED' | 'FAILED' | 'UNAVAILABLE';
  /** Which backend answered, as far as the webview can tell. */
  available: boolean;
  error?: string;
}

export async function runKeychainSelfCheck(): Promise<KeychainSelfCheck> {
  try {
    const available = await keychain.isAvailable();
    if (!available) {
      // Not a failure of this check — a platform with no backend compiled in.
      // Reported distinctly so it cannot be misread as the store misbehaving.
      return { status: 'UNAVAILABLE', available: false };
    }

    // Clear any residue from a run that died before cleaning up.
    await keychain.delete(PROBE_ACCOUNT);

    const absent = await keychain.get(PROBE_ACCOUNT);
    if (absent !== null) {
      return {
        status: 'FAILED',
        available,
        error: `a missing entry read as ${JSON.stringify(absent)} instead of null`,
      };
    }

    const secret = `probe-${Date.now()}`;
    await keychain.set(PROBE_ACCOUNT, secret);
    const readBack = await keychain.get(PROBE_ACCOUNT);
    if (readBack !== secret) {
      return {
        status: 'FAILED',
        available,
        error: `read back ${JSON.stringify(readBack)}, expected ${JSON.stringify(secret)}`,
      };
    }

    await keychain.delete(PROBE_ACCOUNT);
    const afterDelete = await keychain.get(PROBE_ACCOUNT);
    if (afterDelete !== null) {
      return {
        status: 'FAILED',
        available,
        error: 'entry survived deletion',
      };
    }

    return { status: 'PASSED', available };
  } catch (err) {
    return {
      status: 'FAILED',
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
