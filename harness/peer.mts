/**
 * A headless EchoIt peer — one real Dicsussion node, no UI.
 *
 * Runs as its own OS process and speaks JSON Lines over stdio, so an
 * orchestrator can drive several of them and assert on what actually crosses
 * the wire. Two processes rather than two clients in one process is
 * deliberate: peers sharing a heap can appear to work for reasons that have
 * nothing to do with the network.
 *
 * Transport is real Iroh/QUIC. Storage is in-memory, which also exempts it
 * from the `storageKey` requirement — there is no file to protect.
 *
 * Protocol
 *   in : {cmd:'pair', ticket}          register a peer's key (see D3)
 *        {cmd:'connect', ticket}       dial
 *        {cmd:'channel', channelId, participants}  open one with a guest list
 *        {cmd:'send', channelId, content}
 *        {cmd:'history', channelId}
 *        {cmd:'status'} | {cmd:'quit'}
 *   out: {type:'ready', did, ticket}
 *        {type:'message', channelId, content, authorDid}
 *        {type:'sent'|'paired'|'connected'|'history'|'status'|'error', ...}
 */

import { createInterface } from 'node:readline';

import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

const NAME = process.argv[2] ?? 'peer';
const CHANNEL = 'echoit-harness-channel';

/** One JSON object per line — the orchestrator parses these. */
function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ peer: NAME, ...payload })}\n`);
}

const client = await DicsussionClient.init(
  // ':memory:' needs no storageKey — nothing reaches disk to protect.
  { storagePath: ':memory:' },
  { transport: 'iroh' },
);

client.chat.onMessage(CHANNEL, (message) => {
  emit({
    type: 'message',
    channelId: CHANNEL,
    content: message.content,
    authorDid: message.authorDid ?? null,
  });
});

emit({ type: 'ready', did: client.did, ticket: encodeTicket(client.getTicket()) });

const rl = createInterface({ input: process.stdin });

// Commands run one at a time. readline delivers every buffered line at once
// when stdin is a pipe, so without this a `send` could overtake the `connect`
// it depends on.
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
      // Pairing is mutual as of SDK 0.1.0: a peer that has not registered our
      // key drops everything we send, silently. Both sides must do this.
      const ticket = decodeTicket(String(msg.ticket));
      if (!ticket.encryptionKey) throw new Error('ticket carries no encryption key');
      client.addPeer(ticket.didKey, ticket.encryptionKey);
      // SDK 0.4.0: pairing is no longer enough. A channel carries a guest
      // list, and `publish` skips any peer not on it — that filter is what
      // stops a conversation reaching contacts who are not in it. Admitting
      // the peer here is what makes pairing mean "may talk on this channel"
      // rather than only "may connect".
      client.chat.createChannel(CHANNEL, [ticket.didKey]);
      emit({ type: 'paired', did: ticket.didKey });
      return;
    }

    case 'connect': {
      await client.connect(decodeTicket(String(msg.ticket)));
      // `connect()` resolves when the DIALLER's handshake completes. The
      // accepting side is still adopting sub-streams at that moment, so a
      // send issued the instant this returns races it and can be dropped by
      // a peer that is not listening yet.
      //
      // This is not new in 0.4.0 — it has always been true — but the extra
      // work 0.4.0 does at connect time widens the window enough to lose the
      // race reliably. Waiting here rather than in each scenario makes
      // `connected` mean "both ends are ready", which is what every caller
      // already assumed it meant.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      emit({ type: 'connected' });
      return;
    }

    case 'channel': {
      // The 0.4.0 authorization boundary, driven explicitly. `pair` admits a
      // peer to the default channel; this opens an arbitrary one with a
      // chosen guest list, which is what a per-conversation channel needs.
      const channelId = String(msg.channelId);
      const participants = (msg.participants as string[] | undefined) ?? [];
      client.chat.createChannel(channelId, participants);
      emit({ type: 'channel', channelId, participants });
      return;
    }

    case 'send': {
      const channelId = String(msg.channelId ?? CHANNEL);
      const sent = await client.chat.sendMessage({
        channelId,
        content: String(msg.content),
      });
      emit({ type: 'sent', id: sent.id, channelId, content: sent.content });
      return;
    }

    case 'history': {
      // `channelId` is optional so the existing two-peer scenarios, which
      // never send one, keep reading the default channel. The docblock at the
      // top of this file always claimed both commands took a channel; until
      // now the code ignored it and used the constant regardless.
      const channelId = String(msg.channelId ?? CHANNEL);
      const history = await client.chat.getHistory(channelId);
      emit({
        type: 'history',
        channelId,
        count: history.length,
        contents: history.map((m) => m.content),
      });
      return;
    }

    case 'offline': {
      client.goOffline();
      emit({ type: 'offline', outboxSize: client.outboxSize });
      return;
    }

    case 'online': {
      const flushed = await client.goOnline();
      emit({ type: 'online', flushed, outboxSize: client.outboxSize });
      return;
    }

    case 'status': {
      const status = client.getNetworkStatus();
      emit({
        type: 'status',
        peerCount: status.peerCount,
        connected: status.connected,
        relayed: status.relayActive,
      });
      return;
    }

    case 'quit': {
      await client.disconnect();
      rl.close();
      process.exit(0);
      return;
    }

    default:
      throw new Error(`unknown command: ${String(msg.cmd)}`);
  }
}
