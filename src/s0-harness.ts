// `/browser` rather than the root entry: the root barrel re-exports
// `SQLiteDriver`, which statically imports the `better-sqlite3` NAPI module.
// A bundler fails resolving that even when the app only ever constructs an
// `IndexedDbDriver` — resolution happens before tree-shaking.
import { DicsussionClient, IndexedDbDriver } from '@dicsussion/sdk/browser';
import { encodeTicket, decodeTicket } from '@dicsussion/core/transport';

/**
 * Stage S0 verification — does the SDK actually run in the app's webview?
 *
 * Persistence is proven across *runs*, not within one. Each run appends one
 * message to a fixed channel in a fixed IndexedDB database, so the history
 * count read at startup is the number of previous runs. A non-zero count is
 * the only real evidence that data survived the process dying.
 *
 * That is why the first run reports `FIRST_RUN` rather than `PASSED`: nothing
 * has been restarted yet, so persistence is simply unproven. Run it twice.
 */

const CHANNEL_ID = 's0-verification-channel';
const DATABASE_NAME = 'echoit-s0-db';

export interface S0TestResult {
  /** `FIRST_RUN` means everything worked but persistence is not yet proven. */
  status: 'PASSED' | 'FIRST_RUN' | 'FAILED';

  /** True when running inside the Tauri webview rather than a browser tab. */
  inTauriWebview: boolean;
  /**
   * Always true here: this harness opts out of at-rest encryption.
   * Surfaced so the compromise is visible in the result, not buried in code.
   */
  storageUnencrypted: boolean;
  /** Which webview actually ran this, for the record. */
  userAgent: string;

  did: string;
  ticketRoundTrips: boolean;

  /** Messages found at startup — equals the number of previous runs. */
  priorRuns: number;
  /** Whether data survived a process restart. False on the first run. */
  persistedAcrossRestart: boolean;
  messageLanded: boolean;

  /** Duration of `DicsussionClient.init()` alone. */
  sdkInitMs: number;
  /**
   * Milliseconds from webview navigation start to harness completion.
   *
   * This is NOT the app's cold start — process launch and webview creation
   * happen before any JavaScript exists to measure them. For true cold start
   * on Android use `adb shell am start -W`.
   */
  sinceNavigationMs: number;

  error?: string;
}

function detectTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
  );
}

export async function runS0Harness(): Promise<S0TestResult> {
  const inTauriWebview = detectTauri();
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

  const base = {
    inTauriWebview,
    storageUnencrypted: true,
    userAgent,
    did: '',
    ticketRoundTrips: false,
    priorRuns: 0,
    persistedAcrossRestart: false,
    messageLanded: false,
    sdkInitMs: 0,
  };

  try {
    const driver = new IndexedDbDriver({ databaseName: DATABASE_NAME });

    const initStart = performance.now();
    const client = await DicsussionClient.init(
      {
        storagePath: DATABASE_NAME,
        // DIAGNOSTIC HARNESS ONLY — never in a shipping build.
        //
        // The SDK now refuses to write identity secrets unencrypted unless
        // you say so explicitly. That is the right default, and the honest
        // way to satisfy it here is to admit we are skipping encryption
        // rather than hardcode a key and pretend otherwise (which would also
        // breach AGENT_INSTRUCTIONS §3.5).
        //
        // Real key material must come from the OS keychain — Phase 2,
        // milestone M2.2.2. Until that lands, this harness stores secrets in
        // the clear, which is why it is a harness and not the app.
        allowUnencryptedStorage: true,
      },
      { storage: driver, transport: 'local' },
    );
    const sdkInitMs = round(performance.now() - initStart);

    const did = client.did;
    if (!did.startsWith('did:key:')) {
      throw new Error(`Invalid did:key format: ${did}`);
    }

    // A ticket that cannot survive encode/decode cannot be pasted between
    // devices, which is the whole pairing story for S1.
    const decoded = decodeTicket(encodeTicket(client.getTicket()));
    const ticketRoundTrips = decoded.didKey === did;

    const priorRuns = (await client.chat.getHistory(CHANNEL_ID)).length;

    await client.chat.sendMessage({
      channelId: CHANNEL_ID,
      content: `S0 boot ping at ${new Date().toISOString()}`,
    });

    const countAfter = (await client.chat.getHistory(CHANNEL_ID)).length;
    const messageLanded = countAfter === priorRuns + 1;

    await client.disconnect();

    const persistedAcrossRestart = priorRuns > 0;
    const healthy = ticketRoundTrips && messageLanded;

    return {
      ...base,
      status: !healthy ? 'FAILED' : persistedAcrossRestart ? 'PASSED' : 'FIRST_RUN',
      did,
      ticketRoundTrips,
      priorRuns,
      persistedAcrossRestart,
      messageLanded,
      sdkInitMs,
      sinceNavigationMs: round(performance.now()),
    };
  } catch (err: unknown) {
    return {
      ...base,
      status: 'FAILED',
      sinceNavigationMs: round(performance.now()),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
