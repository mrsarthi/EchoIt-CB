import { encodeTicket, decodeTicket } from '@dicsussion/core/transport';

import {
  createEchoItClient,
  waitForDialableAddress,
} from './transport/create-client.js';
import { runKeychainSelfCheck, KeychainSelfCheck } from './keychain-selfcheck';

/**
 * Step 1 of the transport ladder — two app instances on one machine.
 *
 * Step 0 (`harness/two-peer-bridge.mts`) already proved
 * `createBridgedTransport` works over a plain TCP pipe. This proves the same
 * thing over the *Tauri* pipe, so a failure here is our IPC plumbing — the
 * Rust byte pumping, the base64 round-trip, or event ordering — rather than
 * the protocol.
 *
 * There is no UI, because the gate forbids one until a message has crossed
 * between two real devices. Instead everything hangs off `window.__echoit`,
 * driven from outside over the remote-debugging port. That keeps the test
 * scriptable and keeps us honest about not building UI early.
 */

interface Harness {
  ready: boolean;
  did: string;
  ticket: string;
  endpointId: string;
  directAddresses: string[];
  relayUrl: string | null;
  dialableFromAnywhere: boolean;
  received: string[];
  /**
   * Transport-level events with reasons — inbound connections, and *why* a
   * connection closed. Additive: nothing existing changed, so the automated
   * driver is unaffected.
   *
   * Exists because "Connection closed" alone gives no way to tell a refused
   * dial from a dropped stream from a read error, and those have entirely
   * different causes.
   */
  events: string[];
  /**
   * did:keys this device has paired with.
   *
   * `peers=N` in the status line counts *connected* peers, not paired
   * ones — and `publish()` only sends to peers that are both. A peer that
   * is connected but unpaired looks entirely healthy and silently
   * receives nothing, so the two counts have to be visible separately.
   */
  pairedWith: string[];
  error?: string;
  pair(peerTicket: string): Promise<string>;
  connect(peerTicket: string): Promise<string>;
  send(content: string): Promise<string>;
  status(): string;
}

const CHANNEL = 'echoit-bridge-harness';

export async function installBridgeHarness(): Promise<void> {
  // Separate global on purpose: `window.__echoit` is a contract the CDP
  // drivers depend on field-by-field, so nothing is added to it here.
  const keychainTarget = globalThis as unknown as {
    __echoitKeychain?: KeychainSelfCheck | { status: 'RUNNING' };
  };
  keychainTarget.__echoitKeychain = { status: 'RUNNING' };
  void runKeychainSelfCheck().then((result) => {
    keychainTarget.__echoitKeychain = result;
    console.log('[Keychain Self-Check]: ' + JSON.stringify(result));
  });

  const target = globalThis as unknown as { __echoit?: Harness };

  const state: Harness = {
    ready: false,
    did: '',
    ticket: '',
    endpointId: '',
    directAddresses: [],
    relayUrl: null,
    dialableFromAnywhere: false,
    received: [],
    events: [],
    pairedWith: [],
    pair: async () => 'not ready',
    connect: async () => 'not ready',
    send: async () => 'not ready',
    status: () => 'not ready',
  };
  target.__echoit = state;

  try {
    const { client, pipe, refreshTicketAddresses } = await createEchoItClient({
      databaseName: 'echoit-bridge-harness-db',
      // DIAGNOSTIC HARNESS ONLY. Real key material comes from the OS keychain
      // (M2.2.2); until that lands this writes secrets in the clear, which is
      // why it is a harness and not the app.
      allowUnencryptedStorage: true,
    });

    client.chat.onMessage(CHANNEL, (message) => {
      state.received.push(message.content);
    });

    pipe.onDiagnostic((event, connId, detail) => {
      const at = new Date().toISOString().slice(11, 19);
      state.events.push(`${at} ${event} ${connId} — ${detail}`);
    });

    // A ticket assembled before STUN reports a public address carries LAN
    // addresses only — fine here on loopback, undialable from another network,
    // and it fails looking exactly like NAT traversal breaking. Waiting costs
    // seconds and removes a whole class of false failure later.
    const { endpoint, dialableFromAnywhere } = await waitForDialableAddress(pipe);

    // Waiting above only proves *Rust* has good addresses. The transport keeps
    // its own cached snapshot, taken fire-and-forget at construction — before
    // STUN and the relay had answered — and `getTicket()` serves that cache.
    // Without this refresh the ticket carries the socket's first, LAN-only
    // view and is undialable from anywhere else, which presents as the network
    // failing rather than as a stale ticket.
    await refreshTicketAddresses();

    state.did = client.did;
    state.endpointId = endpoint.endpointId;
    state.directAddresses = endpoint.directAddresses;
    state.relayUrl = endpoint.relayUrl;
    state.dialableFromAnywhere = dialableFromAnywhere;
    state.ticket = encodeTicket(client.getTicket());

    /**
     * Decode a pasted ticket, explaining *why* it failed.
     *
     * `decodeTicket` tolerates whitespace of every kind — internal newlines,
     * CRLF, email soft-wrapping — so a malformed ticket is almost always
     * **truncated**, not mangled. The bare "could not decode the payload"
     * sends people looking for encoding problems that do not exist, so say
     * what was actually received instead.
     */
    const parseTicket = (raw: string) => {
      const cleaned = raw.trim();

      if (!cleaned) throw new Error('No ticket pasted.');

      if (!cleaned.startsWith('dicsussion1')) {
        throw new Error(
          `Not a ticket — expected it to start with "dicsussion1", got ` +
            `"${cleaned.slice(0, 16)}…". Copy the whole value from the other device.`,
        );
      }

      try {
        return decodeTicket(cleaned);
      } catch {
        throw new Error(
          `Ticket looks truncated: received ${cleaned.length} characters. ` +
            `Compare that against the character count shown on the other ` +
            `device — if it is lower, the copy was cut short. Use the Copy ` +
            `button rather than selecting the text by hand.`,
        );
      }
    };

    state.pair = async (peerTicket: string) => {
      const peer = parseTicket(peerTicket);
      if (!peer.encryptionKey) return 'ticket carries no encryption key';

      // Pasting your own ticket is an easy mistake when both windows look
      // alike, and it fails in the most confusing possible way: pairing and
      // connecting both "succeed", `peers=1`, and nothing is ever delivered
      // because the only paired peer is yourself.
      if (peer.didKey === client.did) {
        return (
          'REFUSED — this is THIS device\'s own ticket. Paste the ticket from ' +
          'the OTHER machine.'
        );
      }

      client.addPeer(peer.didKey, peer.encryptionKey);
      // SDK 0.4.0: a channel carries a guest list and `publish` skips anyone
      // not on it. Pairing alone no longer makes a peer reachable on this
      // channel, so admit them here — otherwise every send resolves having
      // reached nobody.
      client.chat.createChannel(CHANNEL, [peer.didKey]);
      state.pairedWith.push(peer.didKey);
      // In full, and never truncated. A shortened did here reads as a
      // complete value that happens not to match the other screen — which is
      // misleading precisely when someone is checking whether two devices
      // have distinct identities.
      return `paired ${peer.didKey}`;
    };

    state.connect = async (peerTicket: string) => {
      await client.connect(parseTicket(peerTicket));
      return 'connected';
    };

    state.send = async (content: string) => {
      const sent = await client.chat.sendMessage({ channelId: CHANNEL, content });
      return `sent ${sent.id.slice(0, 8)}`;
    };

    state.status = () => {
      const s = client.getNetworkStatus();
      // `paired` alongside `peers` deliberately: `peers` counts *connected*
      // peers, and messages only go to peers that are connected **and**
      // paired. `peers=1 paired=0` is the silent-delivery failure, and
      // without both numbers it is indistinguishable from working.
      // `outbox` is what makes a background-delivery run conclusive. Without
      // it, "the message queued and will arrive" and "the message vanished"
      // look identical from outside — which is exactly what left the 0.3.0
      // run unable to say which had happened.
      return (
        `peers=${s.peerCount} paired=${state.pairedWith.length} ` +
        `connected=${s.connected} relayed=${s.relayActive} ` +
        `outbox=${client.outboxSize}`
      );
    };

    state.ready = true;
    document.title = `BRIDGE READY did=${client.did.slice(8, 20)} relay=${dialableFromAnywhere}`;
  } catch (err: unknown) {
    state.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    document.title = `BRIDGE FAILED ${state.error}`;
  }
}
