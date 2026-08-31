import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  BridgeInbound,
  BridgePipe,
  BridgeTarget,
} from '@dicsussion/core/transport';
import { loadRelayUrl } from '../services/relay';

/**
 * `BridgePipe.addresses()` returns `BridgeAddresses`, but that type is not
 * exported from either barrel in 0.3.0 — only `BridgeInbound`, `BridgePipe`,
 * and `BridgeTarget` are. Recovering it structurally keeps us honest to the
 * real contract instead of hand-rolling a lookalike that could drift.
 *
 * Replace with a direct import once upstream exports it (reported).
 */
type BridgeAddresses = Awaited<ReturnType<BridgePipe['addresses']>>;

/**
 * `BridgePipe` implemented over the Rust Iroh endpoint.
 *
 * Rust owns the QUIC socket and moves bytes; the SDK keeps the RFC 001 §5
 * handshake, session-key derivation, framing, and priority. Nothing in this
 * file understands the protocol, and that is deliberate — a bug here can only
 * ever be bytes arriving late, out of order, or not at all.
 *
 * ## The contract: ordered bytes, nothing more
 *
 * **Do not add length prefixing or any framing.** The SDK frames its own
 * control messages during the handshake and hands everything afterwards to
 * `FrameReader`, which reassembles from a byte stream regardless of how it
 * was chopped up. If both sides prefix, the SDK reads our header as the first
 * bytes of its own message and the handshake breaks.
 *
 * Chunks are forwarded exactly as QUIC delivers them — split or coalesced,
 * both correct. **Order is the one guarantee that matters**, and it is
 * load-bearing: with no message boundaries there is nothing to resynchronise
 * on, so a single transposition corrupts the stream permanently.
 */

interface DataEvent {
  connId: string;
  data: string;
}

interface InboundEvent {
  connId: string;
  unverifiedTransportId: string;
}

interface ClosedEvent {
  connId: string;
  reason: string;
}

/** Endpoint identity, for building this node's own ticket. */
export interface EndpointIdentity {
  endpointId: string;
  directAddresses: string[];
  relayUrl: string | null;
}

// base64 rather than a number array: ~1.33x overhead against ~4x, and frames
// run to 1 MB.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class TauriBridgePipe implements BridgePipe {
  private readonly dataHandlers = new Set<
    (connectionId: string, bytes: Uint8Array) => void
  >();
  private readonly inboundHandlers = new Set<
    (connectionId: string, info: BridgeInbound) => void
  >();
  private readonly closedHandlers = new Set<(connectionId: string) => void>();

  private unlisteners: UnlistenFn[] = [];
  private started = false;

  /**
   * Diagnostic side-channel, deliberately outside `BridgePipe`.
   *
   * `onClosed` in the SDK contract carries only a connection id, but Rust
   * knows *why* a connection ended — "peer closed the stream", a read error,
   * the write side going away. Losing that turns every failure into a bare
   * "Connection closed", which is what made the two-machine failure so hard
   * to place. Kept separate so the contract stays exactly as specified.
   */
  private readonly diagnosticHandlers = new Set<
    (event: string, connId: string, detail: string) => void
  >();

  onDiagnostic(
    handler: (event: string, connId: string, detail: string) => void,
  ): () => void {
    this.diagnosticHandlers.add(handler);
    return () => this.diagnosticHandlers.delete(handler);
  }

  private diagnose(event: string, connId: string, detail: string): void {
    for (const handler of this.diagnosticHandlers) handler(event, connId, detail);
  }

  /**
   * Bind the native endpoint and begin accepting.
   *
   * @param transportSecret 32 bytes the SDK derived from the identity key.
   *   Not generated here: a ticket's `transportKey` *is* the endpoint id, and
   *   the derivation is one-way, so an endpoint minting its own key would
   *   advertise an address no peer could dial — presenting as a network fault
   *   rather than a key mismatch.
   */
  async start(transportSecret: Uint8Array): Promise<EndpointIdentity> {
    if (transportSecret.length !== 32) {
      throw new Error(
        `transport secret must be 32 bytes, got ${transportSecret.length}`,
      );
    }

    // Subscribe before binding. Rust starts its accept loop inside
    // `iroh_start`, so a peer dialling immediately would otherwise arrive
    // before anything is listening.
    await this.subscribe();

    /*
     * The relay map is fixed when the endpoint binds, so the chosen relay has
     * to be handed over here. Nothing later can move a running endpoint to a
     * different one -- which is why Settings says a change needs a restart
     * rather than pretending it applies at once.
     */
    const identity = await invoke<EndpointIdentity>('iroh_start', {
      secretKey: Array.from(transportSecret),
      relayUrl: loadRelayUrl() ?? null,
    });
    this.started = true;
    return identity;
  }

  /** Current endpoint id and addresses. Refresh rather than cache: addresses
   * change with the network, and a stale ticket dials nowhere. */
  async identity(): Promise<EndpointIdentity> {
    return invoke<EndpointIdentity>('iroh_identity');
  }

  // ─── BridgePipe ────────────────────────────────────────────────────────

  /**
   * How this node is currently reachable.
   *
   * Read live from Rust on every call rather than cached from `start()`.
   * Address discovery is not instant: the socket binds with LAN addresses,
   * a public one arrives from STUN some time later, and a relay later still.
   * A cached snapshot would freeze the earliest, LAN-only view — which works
   * on one network and is undialable from any other, presenting as NAT
   * traversal failing rather than as a stale address list.
   */
  async addresses(): Promise<BridgeAddresses> {
    const identity = await invoke<EndpointIdentity>('iroh_identity');
    return {
      directAddresses: identity.directAddresses,
      ...(identity.relayUrl ? { relayUrl: identity.relayUrl } : {}),
    };
  }

  async connect(target: BridgeTarget): Promise<string> {
    if (!this.started) {
      throw new Error('bridge not started; call start() with the transport secret first');
    }
    return invoke<string>('iroh_connect', {
      transportKey: Array.from(target.transportKey),
      directAddresses: [...target.directAddresses],
      relayUrl: target.relayUrl ?? null,
    });
  }

  async send(connectionId: string, bytes: Uint8Array): Promise<void> {
    await invoke('iroh_send', { connId: connectionId, data: toBase64(bytes) });
  }

  onData(handler: (connectionId: string, bytes: Uint8Array) => void): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onInbound(
    handler: (connectionId: string, info: BridgeInbound) => void,
  ): () => void {
    this.inboundHandlers.add(handler);
    return () => this.inboundHandlers.delete(handler);
  }

  onClosed(handler: (connectionId: string) => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  async disconnect(connectionId: string): Promise<void> {
    await invoke('iroh_disconnect', { connId: connectionId });
  }

  async close(): Promise<void> {
    for (const unlisten of this.unlisteners) unlisten();
    this.unlisteners = [];
    this.dataHandlers.clear();
    this.inboundHandlers.clear();
    this.closedHandlers.clear();
    this.started = false;
    await invoke('iroh_stop');
  }

  // ─── Event wiring ──────────────────────────────────────────────────────

  private async subscribe(): Promise<void> {
    if (this.unlisteners.length > 0) return;

    // Handlers are dispatched synchronously in arrival order. Nothing here
    // may defer or reorder — see the ordering note in the file header.
    this.unlisteners.push(
      await listen<DataEvent>('iroh://data', ({ payload }) => {
        const bytes = fromBase64(payload.data);
        for (const handler of this.dataHandlers) handler(payload.connId, bytes);
      }),
    );

    this.unlisteners.push(
      await listen<InboundEvent>('iroh://inbound', ({ payload }) => {
        this.diagnose(
          'inbound',
          payload.connId,
          `from ${payload.unverifiedTransportId.slice(0, 16)}…`,
        );
        const info: BridgeInbound = {
          unverifiedTransportId: payload.unverifiedTransportId,
        };
        for (const handler of this.inboundHandlers) handler(payload.connId, info);
      }),
    );

    this.unlisteners.push(
      await listen<ClosedEvent>('iroh://closed', ({ payload }) => {
        this.diagnose('closed', payload.connId, payload.reason);
        for (const handler of this.closedHandlers) handler(payload.connId);
      }),
    );
  }
}
