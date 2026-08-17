import { DicsussionClient, IndexedDbDriver } from '@dicsussion/sdk/browser';
import {
  createBridgedTransport,
  deriveTransportKey,
} from '@dicsussion/core/transport';

import { TauriBridgePipe, type EndpointIdentity } from './tauri-bridge-pipe.js';

/**
 * Build a `DicsussionClient` wired to the native Iroh endpoint.
 *
 * Three seams have to line up, and each exists because a webview cannot do
 * something Node can:
 *
 *   storage   `better-sqlite3` is a NAPI module → `IndexedDbDriver`
 *   transport a webview cannot open a QUIC socket → bridged over Tauri IPC
 *   identity  derived inside `init()` from a seed we never hold → factory
 *
 * The transport arrives as a **factory** rather than an instance because it
 * must authenticate as this node, and the identity does not exist until the
 * client has loaded or created it. The factory is how the client hands it
 * back at the one moment both are available.
 */

/**
 * `createBridgedTransport` is typed as `ITransport`, but the instance also
 * carries `refreshAddresses()` — and calling it is mandatory before publishing
 * a ticket, so we need to reach it.
 *
 * The transport warms its address cache once at construction, fire-and-forget.
 * At that instant the socket has only just bound: LAN addresses at best, no
 * relay yet. A ticket built from that snapshot is undialable from anywhere
 * else, and it fails looking exactly like the network being at fault.
 */
interface AddressRefreshing {
  refreshAddresses?: () => Promise<unknown>;
}

export interface EchoItClient {
  client: DicsussionClient;
  /** Endpoint identity reported by Rust when the socket bound. */
  endpoint: EndpointIdentity;
  /** The live pipe, for shutdown and address refresh. */
  pipe: TauriBridgePipe;
  /**
   * Re-read addresses from the host into the transport's cache, so the next
   * `getTicket()` is dialable. **Call this before publishing a ticket.**
   */
  refreshTicketAddresses: () => Promise<void>;
}

export interface CreateClientOptions {
  /** IndexedDB database name. */
  databaseName?: string;
  /**
   * Key protecting identity secrets at rest.
   *
   * Must come from the OS keychain in any shipping build — Windows DPAPI,
   * Android Keystore, iOS Keychain (`AGENT_INSTRUCTIONS.md` §3.5, milestone
   * M2.2.2). Omitting it is only permissible in a diagnostic harness, and
   * requires saying so explicitly via `allowUnencryptedStorage`.
   */
  storageKey?: string;
  /** Diagnostic harnesses only. Never in a shipping build. */
  allowUnencryptedStorage?: boolean;
}

export async function createEchoItClient(
  options: CreateClientOptions = {},
): Promise<EchoItClient> {
  const databaseName = options.databaseName ?? 'echoit-db';
  const pipe = new TauriBridgePipe();

  // Captured from inside the factory: `init()` resolves to the client, but
  // the endpoint identity is only known once Rust has bound the socket, which
  // happens during the factory call.
  let endpoint: EndpointIdentity | undefined;
  let transport: AddressRefreshing | undefined;

  const client = await DicsussionClient.init(
    {
      storagePath: databaseName,
      ...(options.storageKey ? { storageKey: options.storageKey } : {}),
      ...(options.allowUnencryptedStorage
        ? { allowUnencryptedStorage: true }
        : {}),
    },
    {
      storage: new IndexedDbDriver({ databaseName }),

      transport: async (identity) => {
        // Iroh's endpoint key is derived from the identity key by
        // domain-separated HKDF — deliberately not the identity key itself,
        // to avoid cross-protocol reuse. It is deterministic, so the endpoint
        // id is stable across restarts without storing a second secret.
        const { secretKey } = deriveTransportKey(identity);
        endpoint = await pipe.start(secretKey);

        const built = createBridgedTransport(pipe, { identity });
        transport = built as unknown as AddressRefreshing;
        return built;
      },
    },
  );

  if (!endpoint) {
    // Unreachable unless the SDK stops calling the factory during init.
    throw new Error('transport factory did not run; endpoint never bound');
  }

  return {
    client,
    endpoint,
    pipe,
    refreshTicketAddresses: async () => {
      await transport?.refreshAddresses?.();
    },
  };
}

/**
 * Wait until this node has an address reachable from another network.
 *
 * A ticket assembled before STUN reports a public address carries LAN
 * addresses only. It works on your own network and is undialable from any
 * other — and it fails looking exactly like NAT traversal not working, which
 * sends you debugging the wrong layer entirely.
 *
 * Both READMEs call this out; it is the single most likely way a
 * cross-network test fails for a reason that is not a bug.
 *
 * @returns The endpoint once a relay URL is present, or the last snapshot if
 *   the timeout expires — a LAN-only ticket is still useful on one network,
 *   so this reports rather than throws.
 */
export async function waitForDialableAddress(
  pipe: TauriBridgePipe,
  timeoutMs = 15_000,
): Promise<{ endpoint: EndpointIdentity; dialableFromAnywhere: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let endpoint = await pipe.identity();

  while (Date.now() < deadline) {
    if (endpoint.relayUrl) {
      return { endpoint, dialableFromAnywhere: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    endpoint = await pipe.identity();
  }

  return { endpoint, dialableFromAnywhere: Boolean(endpoint.relayUrl) };
}
