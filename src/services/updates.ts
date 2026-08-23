/**
 * Update checking — Q21, front half.
 *
 * Two tracks meet here. The **check** is one Rust command on every platform,
 * so Windows and Android can never disagree about what the latest version is.
 * The **install** differs: Windows can replace itself in place, Android cannot,
 * and the user is sent to the Releases page to reinstall the APK by hand.
 *
 * Nothing in this file fetches. `PRODUCT.md` §4.3 and the CSP (Q16, verified at
 * zero violations) both depend on the app being unable to reach anywhere but
 * its own IPC, so the request happens in Rust and arrives here as a result.
 */

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Mirrors `UpdateStatus` in `src-tauri/src/updates.rs`. */
export interface UpdateStatus {
  available: boolean;
  current: string;
  latest: string | null;
  releasePage: string;
  /** Set only when the check could not be completed. */
  error: string | null;
}

interface RawUpdateStatus {
  available: boolean;
  current: string;
  latest: string | null;
  release_page: string;
  error: string | null;
}

/**
 * The version this build reports.
 *
 * Read from the bundle at build time rather than hardcoded, so a release whose
 * `tauri.conf.json` was bumped but whose constant was not cannot tell every
 * tester they are up to date when they are a version behind.
 */
export const APP_VERSION: string = __APP_VERSION__;

/** Whether the user has opted out. §4.3 says the toggle defaults to on. */
const OPT_OUT_KEY = "echoit:update-checks-disabled";

export function updateChecksEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== "true";
  } catch {
    // A storage failure must not silently disable update checks — being
    // stranded on an old build is the worse outcome of the two.
    return true;
  }
}

export function setUpdateChecksEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(OPT_OUT_KEY);
    else localStorage.setItem(OPT_OUT_KEY, "true");
  } catch {
    // Nothing useful to do; the getter already fails safe.
  }
}

/**
 * Ask whether a newer release exists.
 *
 * Never throws. A failed check is an ordinary outcome — offline, no network,
 * GitHub having a bad day — and it is reported as `error` rather than as a
 * rejection, so the UI can say "couldn't check" instead of "up to date". The
 * two are not the same and must not look the same.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const raw = await invoke<RawUpdateStatus>("check_for_update", {
      appVersion: APP_VERSION,
    });
    return {
      available: raw.available,
      current: raw.current,
      latest: raw.latest,
      releasePage: raw.release_page,
      error: raw.error,
    };
  } catch (error) {
    return {
      available: false,
      current: APP_VERSION,
      latest: null,
      releasePage: "https://github.com/mrsarthi/EchoIt-Messenger/releases/latest",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Open the Releases page — the Android install path, and the desktop fallback. */
export async function openReleasePage(url: string): Promise<void> {
  await openUrl(url);
}

/**
 * Install in place. Windows only.
 *
 * Imported lazily because `@tauri-apps/plugin-updater` talks to a plugin that
 * is not registered on Android; a static import would put a permanently
 * broken call into the Android bundle. Returns false when in-place update is
 * not possible, so the caller falls back to the Releases page rather than
 * appearing to do nothing.
 */
export async function installInPlace(): Promise<boolean> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return false;
    await update.downloadAndInstall();
    return true;
  } catch {
    return false;
  }
}
