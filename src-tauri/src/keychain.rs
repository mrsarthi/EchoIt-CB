//! OS keychain access for the webview (milestone M2.2.2).
//!
//! ## What this stores, and what it does not
//!
//! EchoIt's at-rest encryption key is **derived from the user's recovery
//! phrase**, not generated here. This module only *caches* the derived key so
//! that the key-derivation function runs once at setup instead of on every
//! launch, and so the key is not left sitting in ordinary app storage between
//! runs.
//!
//! That distinction matters: the keychain is not the source of truth. Losing
//! its contents costs the user a re-derivation, not their history. The
//! recovery phrase remains the only thing that can reconstruct the key, which
//! is what lets a restored device read old messages.
//!
//! ## What it protects against — stated honestly
//!
//! On Windows the Credential Manager decrypts transparently for the logged-in
//! user, so this does **not** defend against malware running as that user.
//! What it does defend against is a stolen machine without disk encryption,
//! another account copying files, and careless backups.
//!
//! Android is stronger: the wrapping key lives in the Keystore, hardware-backed
//! where the device supports it, and the app sandbox keeps other apps out.
//!
//! Do not let UI copy overstate this (see `design/PRODUCT.md` §4.1).
//!
//! ## Missing is not failing
//!
//! `keychain_get` returns `Ok(None)` when there is no entry, and an `Err` only
//! when the keychain itself misbehaved. First launch is the common path, not an
//! error, and a caller that cannot tell "no key yet" from "the keychain is
//! broken" will either wipe good data or loop on a real fault.

use std::sync::{Arc, Mutex};

use keyring_core::{api::CredentialStore, Entry, Error as KeyringError};

/// Namespace for entries belonging to this app. Matches the bundle identifier
/// so entries are attributable in the Windows Credential Manager UI.
const SERVICE: &str = "io.github.mrsarthi.echoit";

/// The default store is process-global in `keyring-core`, so installing it is
/// done once and guarded. `Once` is not used because installation can fail and
/// we want a later call to be able to retry rather than deadlock on a poisoned
/// one-shot.
static STORE_READY: Mutex<bool> = Mutex::new(false);

/// Build the platform store. Kept separate so the `cfg` mess stays in one place.
fn build_store() -> Result<Arc<CredentialStore>, String> {
    // Each arm returns a concrete `Arc<Store>`; the unsizing coercion to
    // `Arc<CredentialStore>` happens here, at the return, which is why the
    // value is bound first rather than chained straight off `map_err`.
    #[cfg(target_os = "windows")]
    {
        let store = windows_native_keyring_store::Store::new()
            .map_err(|e| format!("windows credential store unavailable: {e}"))?;
        Ok(store)
    }

    #[cfg(target_os = "android")]
    {
        // Uses the crate's default store, which is backed by its own
        // SharedPreferences file and a dedicated Keystore entry. Tauri Mobile
        // initialises the `ndk-context` this depends on, so no Kotlin shim is
        // needed on our side.
        let store = android_native_keyring_store::Store::new()
            .map_err(|e| format!("android keystore unavailable: {e}"))?;
        Ok(store)
    }

    // Deliberately no fallback store. An in-memory or plaintext stand-in would
    // let a build that cannot protect the key look exactly like one that can.
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        Err("no keychain backend is compiled for this platform".to_string())
    }
}

fn ensure_store() -> Result<(), String> {
    let mut ready = STORE_READY
        .lock()
        .map_err(|_| "keychain store lock poisoned".to_string())?;
    if *ready {
        return Ok(());
    }
    keyring_core::set_default_store(build_store()?);
    *ready = true;
    Ok(())
}

fn entry(account: &str) -> Result<Entry, String> {
    ensure_store()?;
    Entry::new(SERVICE, account).map_err(|e| format!("keychain entry unavailable: {e}"))
}

/// Store `secret` under `account`, replacing any previous value.
///
/// `secret` is opaque text. Callers holding raw key bytes should base64 them;
/// this layer neither encodes nor validates, so that the stored form is decided
/// in exactly one place — the caller.
#[tauri::command]
pub fn keychain_set(account: String, secret: String) -> Result<(), String> {
    entry(&account)?
        .set_password(&secret)
        .map_err(|e| format!("keychain write failed: {e}"))
}

/// Read the secret stored under `account`.
///
/// `Ok(None)` means no entry exists — the normal first-launch case. `Err` means
/// the keychain failed and the caller must not conclude anything about whether
/// a key exists.
#[tauri::command]
pub fn keychain_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read failed: {e}")),
    }
}

/// Remove the entry for `account`. Deleting something already absent succeeds,
/// so that "make sure this is gone" needs no prior existence check.
#[tauri::command]
pub fn keychain_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {e}")),
    }
}

/// Report whether a usable keychain backend exists, without reading or writing.
///
/// Onboarding needs this before it decides what to promise the user: a build
/// with no backend must say so rather than discovering it at the moment it
/// tries to persist a key.
#[tauri::command]
pub fn keychain_available() -> bool {
    ensure_store().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trips a secret through the real platform keychain.
    ///
    /// Deliberately not mocked: the entire value of this module is whether the
    /// OS store behaves, and a mock would pass on a machine where the real one
    /// is broken. It writes under a dedicated account name and removes it
    /// again, so a developer's credential store is left as it was found.
    #[test]
    fn round_trips_through_the_real_keychain() {
        const ACCOUNT: &str = "self-test-do-not-use";
        let secret = format!("secret-{}", std::process::id());

        // Start clean, in case a previous run died before its cleanup.
        keychain_delete(ACCOUNT.to_string()).expect("delete of absent entry should succeed");

        assert_eq!(
            keychain_get(ACCOUNT.to_string()).expect("read should succeed"),
            None,
            "a missing entry must read as None, not as an error",
        );

        keychain_set(ACCOUNT.to_string(), secret.clone()).expect("write should succeed");
        assert_eq!(
            keychain_get(ACCOUNT.to_string()).expect("read-back should succeed"),
            Some(secret.clone()),
        );

        // Overwriting must replace rather than append or fail.
        let replacement = format!("{secret}-v2");
        keychain_set(ACCOUNT.to_string(), replacement.clone()).expect("overwrite should succeed");
        assert_eq!(
            keychain_get(ACCOUNT.to_string()).expect("read-back should succeed"),
            Some(replacement),
        );

        keychain_delete(ACCOUNT.to_string()).expect("delete should succeed");
        assert_eq!(
            keychain_get(ACCOUNT.to_string()).expect("read after delete should succeed"),
            None,
            "the entry must be gone, and its absence must not be an error",
        );
    }

    #[test]
    fn reports_a_backend_is_available() {
        assert!(
            keychain_available(),
            "this platform should have a compiled keychain backend",
        );
    }
}
