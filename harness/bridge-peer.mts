/**
 * A headless peer that talks over `createBridgedTransport`, not Iroh.
 *
 * Step 0 of the transport ladder. `createBridgedTransport` only needs
 * *something* satisfying `BridgePipe` — ordered bytes in, ordered bytes out —
 * and does not care whether they come from Tauri IPC or a TCP socket. So this
 * substitutes a TCP pipe for the Tauri one and runs the same scenarios.
 *
 * That isolates one question: **does the bridged transport work, and is our
 * reading of the byte contract right?** If this passes and the Tauri build
 * fails, the fault is in our IPC plumbing rather than the protocol or the
 * contract — which is the entire reason for testing this layer separately.
 *
 * The pipe deliberately writes raw bytes with **no framing**. TCP, like QUIC,
 * may split or coalesce; the SDK length-prefixes its own control messages and
 * `FrameReader` reassembles the rest. Adding framing here would break the
 * handshake, which is exactly the mistake the contract warns about.
 */

import { createInterface } from 'node:readline';
import { createServer, connect, type Socket } from 'node:net';

import { DicsussionClient } from '@dicsussion/sdk';
import {
  createBridgedTransport,
  decodeTicket,
  deriveTransportKey,
  encodeTicket,
} from '@dicsussion/core/transport';
import type { BridgePipe, BridgeTarget } from '@dicsussion/core/transport';

const NAME = process.argv[2] ?? 'peer';
const LISTEN_PORT = Number(process.argv[3] ?? 0);
const CHANNEL = 'echoit-bridge-channel';

function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ peer: NAME, ...payload })}\n`);
}

/**
 * `BridgePipe` over TCP.
 *
 * Connection ids are assigned by this host and opaque to the SDK, mirroring
 * how the Tauri bridge names them.
 */
class TcpBridgePipe implements BridgePipe {
  private readonly sockets = new Map<string, Socket>();
  private readonly dataHandlers = new Set<(id: string, bytes: Uint8Array) => void>();
  private readonly inboundHandlers = new Set<
    (id: string, info: { unverifiedTransportId?: string }) => void
  >();
  private readonly closedHandlers = new Set<(id: string) => void>();
  private counter = 0;
  private boundPort = 0;

  /** Start accepting. Returns the port actually bound. */
  async listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        const id = `in-${++this.counter}`;
        this.adopt(id, socket);
        for (const handler of this.inboundHandlers) handler(id, {});
      });
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : port;
        resolve(this.boundPort);
      });
    });
  }

  private adopt(id: string, socket: Socket): void {
    this.sockets.set(id, socket);
    // No framing, no buffering: forward exactly what TCP delivers.
    socket.on('data', (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk);
      for (const handler of this.dataHandlers) handler(id, bytes);
    });
    const shut = () => {
      if (!this.sockets.delete(id)) return;
      for (const handler of this.closedHandlers) handler(id);
    };
    socket.on('close', shut);
    socket.on('error', shut);
  }

  // ─── BridgePipe ────────────────────────────────────────────────────────

  async addresses(): Promise<{ directAddresses: string[]; relayUrl?: string }> {
    // Loopback only. No relay exists here, and none is needed — every peer is
    // directly reachable, which is why this step cannot substitute for the
    // real cross-network tests later.
    return { directAddresses: [`127.0.0.1:${this.boundPort}`] };
  }

  async connect(target: BridgeTarget): Promise<string> {
    const [host, port] = (target.directAddresses[0] ?? '').split(':');
    if (!host || !port) throw new Error('bridge target has no dialable address');

    const id = `out-${++this.counter}`;
    const socket = connect({ host, port: Number(port) });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    this.adopt(id, socket);
    return id;
  }

  async send(connectionId: string, bytes: Uint8Array): Promise<void> {
    const socket = this.sockets.get(connectionId);
    if (!socket) throw new Error(`no such connection: ${connectionId}`);
    await new Promise<void>((resolve, reject) => {
      socket.write(bytes, (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(handler: (id: string, bytes: Uint8Array) => void): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onInbound(
    handler: (id: string, info: { unverifiedTransportId?: string }) => void,
  ): () => void {
    this.inboundHandlers.add(handler);
    return () => this.inboundHandlers.delete(handler);
  }

  onClosed(handler: (id: string) => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  async disconnect(connectionId: string): Promise<void> {
    this.sockets.get(connectionId)?.destroy();
    this.sockets.delete(connectionId);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear();
  }
}

// ─── Peer ────────────────────────────────────────────────────────────────

const pipe = new TcpBridgePipe();
const port = await pipe.listen(LISTEN_PORT);

const client = await DicsussionClient.init(
  { storagePath: ':memory:' },
  { transport: (identity) => createBridgedTransport(pipe, { identity }) },
);

client.chat.onMessage(CHANNEL, (message) => {
  emit({
    type: 'message',
    content: message.content,
    authorDid: message.authorDid ?? null,
  });
});

// The ticket must carry this peer's *transport* key, which the SDK derives
// from the identity; only the host knows the addresses behind it.
const identity = client.identity.getLocalIdentity();
const ticket = {
  ...client.getTicket(),
  transportKey: deriveTransportKey(identity.signing).publicKey,
  directAddresses: [`127.0.0.1:${port}`],
};

emit({ type: 'ready', did: client.did, port, ticket: encodeTicket(ticket) });

const rl = createInterface({ input: process.stdin });
let queue: Promise<void> = Promise.resolve();

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  queue = queue.then(async () => {
    try {
      await handle(JSON.parse(text));
    } catch (error) {
      emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

async function handle(msg: Record<string, unknown>): Promise<void> {
  switch (msg.cmd) {
    case 'pair': {
      const peer = decodeTicket(String(msg.ticket));
      if (!peer.encryptionKey) throw new Error('ticket carries no encryption key');
      client.addPeer(peer.didKey, peer.encryptionKey);
      emit({ type: 'paired', did: peer.didKey });
      return;
    }
    case 'connect': {
      await client.connect(decodeTicket(String(msg.ticket)));
      emit({ type: 'connected' });
      return;
    }
    case 'send': {
      const sent = await client.chat.sendMessage({
        channelId: CHANNEL,
        content: String(msg.content),
      });
      emit({ type: 'sent', id: sent.id });
      return;
    }
    case 'status': {
      const status = client.getNetworkStatus();
      emit({
        type: 'status',
        peerCount: status.peerCount,
        connected: status.connected,
        // Always false here: a loopback pipe has no relay, which is exactly
        // why this step cannot stand in for the cross-network tests.
        relayed: status.relayActive,
      });
      return;
    }

    case 'offline': {
      client.goOffline();
      emit({ type: 'offline' });
      return;
    }
    case 'online': {
      const flushed = await client.goOnline();
      emit({ type: 'online', flushed });
      return;
    }
    case 'quit': {
      await client.disconnect();
      await pipe.close();
      rl.close();
      process.exit(0);
      return;
    }
    default:
      throw new Error(`unknown command: ${String(msg.cmd)}`);
  }
}
