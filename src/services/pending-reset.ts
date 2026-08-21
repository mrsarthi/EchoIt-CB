/**
 * Deleting the local database, given that we cannot close it.
 *
 * `indexedDB.deleteDatabase()` does not force anything shut. While a connection
 * is open the request fires `onblocked` and the database survives — and the SDK
 * holds its connection for the life of the page, with no `close()` on the
 * storage driver to call. So a reset that deletes in-place cannot work, and
 * treating `onblocked` as success silently reports a deletion that never
 * happened.
 *
 * Instead the reset records its intent, reloads, and deletes on the way back up
 * — before anything opens the database. Nothing is holding it at that point, so
 * the delete either succeeds or genuinely failed.
 *
 * The flag lives in `localStorage`, which is separate from IndexedDB and so
 * survives the reload that clears everything else. If the delete fails, the flag
 * stays set and the next launch tries again, rather than leaving the user with
 * data they were told was gone.
 */

const PENDING_RESET_KEY = 'echoit_pending_db_reset';

/** Database name to erase. Must match `createEchoItClient`'s default. */
export const DEFAULT_DATABASE_NAME = 'echoit-db';

/** Record that `databaseName` must be erased before the app next opens it. */
export function markPendingReset(databaseName: string): void {
  localStorage.setItem(PENDING_RESET_KEY, databaseName);
}

export function hasPendingReset(): boolean {
  return localStorage.getItem(PENDING_RESET_KEY) !== null;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error(`could not delete database "${name}"`));
    // Deliberately an error, not a resolve: blocked means the database is still
    // there. Reporting success here is exactly the bug this module exists to
    // avoid.
    req.onblocked = () =>
      reject(
        new Error(
          `deletion of "${name}" was blocked by an open connection; it still exists`,
        ),
      );
  });
}

/**
 * Erase the database if a reset asked for it. Call **before** the app opens any
 * storage — nothing else may hold a connection, or this blocks again.
 *
 * The flag is cleared only on success, so a failure retries on the next launch.
 * Resolves either way: a failed erase must not stop the app from starting, but
 * it must not be mistaken for a completed one either, so it is returned.
 */
export async function runPendingReset(): Promise<{ erased: boolean; error?: string }> {
  const name = localStorage.getItem(PENDING_RESET_KEY);
  if (name === null) return { erased: false };

  try {
    await deleteDatabase(name);
    localStorage.removeItem(PENDING_RESET_KEY);
    return { erased: true };
  } catch (err) {
    return {
      erased: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
