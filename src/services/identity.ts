/**
 * Identity & Storage Key Service
 *
 * Handles:
 * - BIP-39 12-word mnemonic generation and validation
 * - Deterministic derivation of the local database encryption key (storageKey)
 *   from the recovery phrase
 * - Secure persistence and retrieval from the OS Keychain (Windows Credential Manager / Android Keystore)
 */

import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { bytesToBase64 } from "@dicsussion/core/crypto";
import { keychain, STORAGE_KEY_ACCOUNT } from "../keychain";

/** Salt / Passphrase for storage key derivation */
const STORAGE_KEY_PASSPHRASE = "echoit:storage-key:v1";

/**
 * Generate a fresh 12-word BIP-39 mnemonic phrase.
 */
export function generateRecoveryPhrase(): string {
  // 128 bits of entropy -> 12 words
  return generateMnemonic(wordlist, 128);
}

/**
 * Validate a candidate 12-word mnemonic phrase.
 */
export function validateRecoveryPhrase(mnemonic: string): boolean {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  const words = normalized.split(" ");
  if (words.length !== 12 && words.length !== 24) {
    return false;
  }
  return validateMnemonic(normalized, wordlist);
}

/**
 * Deterministically derive the 256-bit storageKey from the recovery phrase.
 *
 * Uses BIP-39 PBKDF2 seed derivation with custom salt, returning 32 bytes
 * as an opaque base64 string.
 */
export function deriveStorageKey(mnemonic: string): string {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  const seedBytes = mnemonicToSeedSync(normalized, STORAGE_KEY_PASSPHRASE);
  return bytesToBase64(seedBytes.subarray(0, 32));
}

/**
 * Check whether the OS keychain is available on this device/platform.
 */
export async function isKeychainAvailable(): Promise<boolean> {
  return await keychain.isAvailable();
}

/**
 * Retrieve the cached storage key from the OS keychain.
 *
 * Resolves to `null` on first run (no key found).
 * Rejects if keychain access itself failed.
 */
export async function getStoredStorageKey(): Promise<string | null> {
  return await keychain.get(STORAGE_KEY_ACCOUNT);
}

/**
 * Save the storage key into the OS keychain.
 */
export async function storeStorageKey(storageKey: string): Promise<void> {
  await keychain.set(STORAGE_KEY_ACCOUNT, storageKey);
}

/**
 * Delete the stored storage key (used for account reset / logout).
 */
export async function clearStorageKey(): Promise<void> {
  await keychain.delete(STORAGE_KEY_ACCOUNT);
}
