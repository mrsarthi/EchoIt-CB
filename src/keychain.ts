/**
 * OS keychain, as seen from the webview (milestone M2.2.2).
 *
 * Backed by Windows Credential Manager and the Android Keystore through
 * `src-tauri/src/keychain.rs`. Read that module's header for what this does and
 * does not protect against — the short version is that it defends against a
 * stolen device, not against malware running as the signed-in user, and UI copy
 * must not claim otherwise.
 *
 * ## The key is derived, not generated here
 *
 * EchoIt's at-rest encryption key comes from the user's recovery phrase. This
 * is a cache: it exists so the key-derivation function runs once at setup
 * rather than on every launch. Losing its contents costs a re-derivation, not
 * the user's history.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Account name for the database encryption key.
 *
 * Stable across releases — changing it strands the key already stored on every
 * existing install, which presents as "my history won't open" rather than as an
 * error anyone can act on.
 */
export const STORAGE_KEY_ACCOUNT = 'storage-key';

export interface Keychain {
  /**
   * Whether a real backend is compiled and usable on this platform.
   *
   * Check before promising the user anything about how their key is held. This
   * never throws: a false answer is the answer.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Read a secret.
   *
   * Resolves to `null` when no entry exists — the ordinary first-launch case —
   * and **rejects** when the keychain itself failed. These must not be
   * collapsed: treating a failure as "no key yet" leads to re-deriving over
   * good data, and treating "no key yet" as a failure blocks first launch.
   */
  get(account: string): Promise<string | null>;

  /** Write a secret, replacing any previous value for `account`. */
  set(account: string, secret: string): Promise<void>;

  /** Remove a secret. Deleting something already absent succeeds. */
  delete(account: string): Promise<void>;
}

export const keychain: Keychain = {
  async isAvailable() {
    try {
      return await invoke<boolean>('keychain_available');
    } catch {
      // The command is missing or the IPC is unavailable — either way there is
      // no keychain here, which is exactly what this function reports.
      return false;
    }
  },

  get(account) {
    // Rust returns `Option<String>`, which arrives as `string | null`.
    return invoke<string | null>('keychain_get', { account });
  },

  set(account, secret) {
    return invoke<void>('keychain_set', { account, secret });
  },

  delete(account) {
    return invoke<void>('keychain_delete', { account });
  },
};
