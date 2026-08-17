import { invoke } from '@tauri-apps/api/core';

/**
 * S1b probe — does the Rust-side Iroh endpoint actually bind?
 *
 * Deliberately uses a **random** transport secret rather than one derived
 * from the SDK identity. This isolates one question: can the native side bind
 * an endpoint, discover addresses, and report an `EndpointId` back across the
 * IPC boundary. Wiring the real derived key is part of the bridged transport
 * and would confuse a failure here with a failure there.
 *
 * A random key means the reported `EndpointId` is not dialable by any peer —
 * that is fine and expected. This probe proves the endpoint exists, not that
 * it is reachable.
 */

export interface EndpointIdentity {
  endpointId: string;
  directAddresses: string[];
  relayUrl: string | null;
}

export interface IrohProbeResult {
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  /** Hex `EndpointId` — the value a ticket carries as `transportKey`. */
  endpointId?: string;
  directAddresses?: string[];
  relayUrl?: string | null;
  /** Whether a second call returned the same endpoint rather than rebinding. */
  idempotent?: boolean;
  bindMs?: number;
  error?: string;
}

function inTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
  );
}

export async function runIrohProbe(): Promise<IrohProbeResult> {
  if (!inTauri()) {
    return { status: 'SKIPPED', error: 'not running in the Tauri webview' };
  }

  try {
    const secretKey = Array.from(crypto.getRandomValues(new Uint8Array(32)));

    const start = performance.now();
    const identity = await invoke<EndpointIdentity>('iroh_start', { secretKey });
    const bindMs = Math.round((performance.now() - start) * 10) / 10;

    if (!/^[0-9a-f]{64}$/.test(identity.endpointId)) {
      throw new Error(`endpointId is not 32 hex bytes: ${identity.endpointId}`);
    }

    // Binding twice must reuse the endpoint. A webview reload calls start
    // again, and rebinding would strand peers mid-dial on the old address.
    const second = await invoke<EndpointIdentity>('iroh_identity');
    const idempotent = second.endpointId === identity.endpointId;

    return {
      status: idempotent ? 'PASSED' : 'FAILED',
      endpointId: identity.endpointId,
      directAddresses: identity.directAddresses,
      relayUrl: identity.relayUrl,
      idempotent,
      bindMs,
      ...(idempotent ? {} : { error: 'second call returned a different endpoint' }),
    };
  } catch (err: unknown) {
    return {
      status: 'FAILED',
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}
