/**
 * Does a 1:1 conversation stay between the two people in it?
 *
 * `M2.4` needs a channel per conversation, and the obvious scheme is a
 * channel id derived from the two participants' did:keys. That is only sound
 * if document sync is scoped to the people in the channel.
 *
 * Before SDK 0.4.0 it was not: `handleRootSync` answered a root mismatch with
 * `generateAllDocumentMessages`, which iterated every local document with no
 * reference to who the peer was, and `recordLocally` stored message bodies as
 * plaintext. Sync is gated on pairing, so strangers were never the question —
 * contacts were, and they received everything.
 *
 * 0.4.0 introduced `chat.createChannel(channelId, participants)` as an
 * authorization boundary: `publish` skips peers failing `mayReceive`, and the
 * sync engine filters on both send and receive. This test is what says whether
 * that holds under three real peers rather than in the changelog.
 *
 * So: Alice pairs with both Bob and Carol. Alice and Bob hold a conversation
 * in their own channel. Carol is never told that channel's id and never sends
 * to it. Does Carol end up holding it anyway?
 *
 *   npx tsx harness/three-peer-privacy.mts
 *
 * A PASS here means 1:1 channels are private and M2.4 can use them directly.
 * A FAIL means the channel-per-pair design leaks every conversation to every
 * contact, and M2.4 cannot be built on it as it stands.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const PEER_SCRIPT = fileURLToPath(new URL('./peer.mts', import.meta.url));

const READY_TIMEOUT_MS = 30_000;
const REPLY_TIMEOUT_MS = 15_000;
/** Time given for a sync to carry something it should not carry. */
const LEAK_WINDOW_MS = 6_000;

interface Event {
  peer: string;
  type: string;
  [key: string]: unknown;
}

class Peer {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(event: Event) => void>();
  readonly events: Event[] = [];

  constructor(readonly name: string) {
    this.proc = spawn(process.execPath, ['--import', 'tsx', PEER_SCRIPT, name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let event: Event;
      try {
        event = JSON.parse(line) as Event;
      } catch {
        return;
      }
      this.events.push(event);
      for (const listener of [...this.listeners]) listener(event);
    });

    this.proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      // The unencrypted-storage warning is expected: these peers are
      // `:memory:` and have no disk to protect.
      if (text && !text.includes('UNENCRYPTED')) {
        process.stderr.write(`  [${name}] ${text}\n`);
      }
    });
  }

  send(command: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(command)}\n`);
  }

  wait(
    predicate: (event: Event) => boolean,
    timeoutMs = REPLY_TIMEOUT_MS,
    what = 'event',
  ): Promise<Event> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${this.name}: timed out waiting for ${what}`));
      }, timeoutMs);

      const listener = (event: Event) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(event);
      };
      this.listeners.add(listener);
    });
  }

  /** Ask for a channel's history and return the message bodies it holds. */
  async history(channelId: string): Promise<string[]> {
    this.send({ cmd: 'history', channelId });
    const event = await this.wait(
      (e) => e.type === 'history' && e.channelId === channelId,
      REPLY_TIMEOUT_MS,
      `history for ${channelId}`,
    );
    return (event.contents as string[]) ?? [];
  }

  kill(): void {
    this.proc.kill();
  }
}

const say = (m = '') => process.stdout.write(`${m}\n`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The channel id M2.4 would use: deterministic from both did:keys so each
 * side derives the same one with no coordination.
 */
const dmChannel = (a: string, b: string) => `dm:${[a, b].sort().join('|')}`;

const alice = new Peer('alice');
const bob = new Peer('bob');
const carol = new Peer('carol');

let failed = false;

try {
  const [aReady, bReady, cReady] = await Promise.all([
    alice.wait((e) => e.type === 'ready', READY_TIMEOUT_MS, 'alice ready'),
    bob.wait((e) => e.type === 'ready', READY_TIMEOUT_MS, 'bob ready'),
    carol.wait((e) => e.type === 'ready', READY_TIMEOUT_MS, 'carol ready'),
  ]);

  const aDid = String(aReady.did);
  const bDid = String(bReady.did);
  const cDid = String(cReady.did);
  const aTicket = String(aReady.ticket);
  const bTicket = String(bReady.ticket);
  const cTicket = String(cReady.ticket);

  say(`alice ${aDid.slice(0, 24)}…`);
  say(`bob   ${bDid.slice(0, 24)}…`);
  say(`carol ${cDid.slice(0, 24)}…`);

  if (new Set([aDid, bDid, cDid]).size !== 3) {
    throw new Error('peers do not have distinct identities');
  }

  // Alice is paired with both. Bob and Carol are NOT paired with each other —
  // they are two separate contacts of Alice's, which is the ordinary case.
  say('\npairing alice<->bob and alice<->carol (bob and carol are strangers)');
  alice.send({ cmd: 'pair', ticket: bTicket });
  alice.send({ cmd: 'pair', ticket: cTicket });
  bob.send({ cmd: 'pair', ticket: aTicket });
  carol.send({ cmd: 'pair', ticket: aTicket });
  await Promise.all([
    alice.wait((e) => e.type === 'paired' && e.did === bDid, REPLY_TIMEOUT_MS, 'alice→bob pair'),
    alice.wait((e) => e.type === 'paired' && e.did === cDid, REPLY_TIMEOUT_MS, 'alice→carol pair'),
    bob.wait((e) => e.type === 'paired', REPLY_TIMEOUT_MS, 'bob pair'),
    carol.wait((e) => e.type === 'paired', REPLY_TIMEOUT_MS, 'carol pair'),
  ]);

  alice.send({ cmd: 'connect', ticket: bTicket });
  await alice.wait((e) => e.type === 'connected', REPLY_TIMEOUT_MS, 'alice→bob connect');
  alice.send({ cmd: 'connect', ticket: cTicket });
  await alice.wait(
    (e) => e.type === 'connected' && alice.events.filter((x) => x.type === 'connected').length >= 2,
    REPLY_TIMEOUT_MS,
    'alice→carol connect',
  );
  say('both connected');

  const privateChannel = dmChannel(aDid, bDid);
  const secret = `private-to-bob-${Date.now()}`;

  // SDK 0.4.0: the channel's guest list is the authorization boundary. Alice
  // and Bob each open it naming only the other. Carol is not on it and is
  // never told it exists — exactly the shape M2.4 will use.
  alice.send({ cmd: 'channel', channelId: privateChannel, participants: [bDid] });
  bob.send({ cmd: 'channel', channelId: privateChannel, participants: [aDid] });
  await Promise.all([
    alice.wait((e) => e.type === 'channel', REPLY_TIMEOUT_MS, 'alice channel'),
    bob.wait((e) => e.type === 'channel', REPLY_TIMEOUT_MS, 'bob channel'),
  ]);

  say(`\nalice sends to ${privateChannel.slice(0, 34)}…`);
  say('carol is never given this channel id and never writes to it');
  alice.send({ cmd: 'send', channelId: privateChannel, content: secret });
  await alice.wait((e) => e.type === 'sent', REPLY_TIMEOUT_MS, 'alice send');

  // Give sync every chance to carry it. A short window would let a slow leak
  // read as a pass, which is the wrong way for this test to be wrong.
  await wait(LEAK_WINDOW_MS);

  const bobHas = await bob.history(privateChannel);
  const carolHas = await carol.history(privateChannel);

  say('');
  say(`bob's copy of the channel   : ${bobHas.length} message(s) ${JSON.stringify(bobHas)}`);
  say(`carol's copy of the channel : ${carolHas.length} message(s) ${JSON.stringify(carolHas)}`);
  say('');

  if (!bobHas.includes(secret)) {
    say('UNEXPECTED — the intended recipient did not receive it. This test');
    say('cannot say anything about leakage until basic delivery works.');
    failed = true;
  } else if (carolHas.includes(secret)) {
    say('FAIL — carol holds the plaintext of a conversation she is not part of.');
    say('');
    say('A channel-per-pair scheme leaks every conversation to every contact.');
    say('M2.4 cannot be built on channel-per-pair as the SDK stands.');
    failed = true;
  } else {
    say('PASS — the conversation stayed between alice and bob.');
    say('Channel-per-pair is sound; M2.4 can derive channel ids from did:keys.');
  }
} catch (error) {
  say(`\nERROR — ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
} finally {
  alice.kill();
  bob.kill();
  carol.kill();
}

process.exit(failed ? 1 : 0);
