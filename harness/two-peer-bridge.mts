/**
 * Can two users talk over the BRIDGED transport?
 *
 * Identical scenarios to `two-peer.mts`, but each peer runs
 * `createBridgedTransport` over a TCP `BridgePipe` instead of Iroh. The
 * protocol is the same; only the byte carrier changes.
 *
 * A pass here means the bridged transport and our reading of the byte
 * contract are both right, so a later failure in the Tauri app points at
 * the IPC plumbing rather than at the protocol.
 *
 *   npm run test:bridge
 *
 * Scenario 2 is the important one. Since SDK 0.1.0 pairing is mutual, and a
 * peer that has not registered the sender's key drops inbound frames with no
 * error on either side. That failure is invisible from the sending end — the
 * message reports as sent — so it needs a test that asserts a *non*-delivery
 * rather than waiting to be discovered as "it says connected but nothing
 * arrives".
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const PEER_SCRIPT = fileURLToPath(new URL('./bridge-peer.mts', import.meta.url));

/** How long to wait before concluding a message is not coming. */
const DELIVERY_TIMEOUT_MS = 8_000;
/** How long a message that must NOT arrive is given to disprove us. */
const NON_DELIVERY_WINDOW_MS = 5_000;

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
    // node --import tsx, not `npx tsx` via a shell. Spawning through a shell
    // on Windows concatenates rather than escapes arguments (DEP0190), and a
    // test harness is a bad place to normalise that habit.
    this.proc = spawn(process.execPath, ['--import', 'tsx', PEER_SCRIPT, name], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let event: Event;
      try {
        event = JSON.parse(line) as Event;
      } catch {
        return; // non-JSON noise from the runtime
      }
      this.events.push(event);
      for (const listener of [...this.listeners]) listener(event);
    });

    // Peer stderr is the first place a crash shows up; surfacing it turns a
    // mystery timeout into a stack trace.
    this.proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) process.stderr.write(`  [${name} stderr] ${text}\n`);
    });
  }

  send(command: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(command)}\n`);
  }

  /** Resolve on the first event matching `predicate`, else reject on timeout. */
  wait(
    predicate: (event: Event) => boolean,
    timeoutMs = DELIVERY_TIMEOUT_MS,
    what = 'event',
  ): Promise<Event> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${this.name}: timed out after ${timeoutMs}ms waiting for ${what}`));
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

  /** Assert nothing matching `predicate` arrives within the window. */
  async expectNothing(
    predicate: (event: Event) => boolean,
    windowMs = NON_DELIVERY_WINDOW_MS,
  ): Promise<void> {
    const early = this.events.find(predicate);
    if (early) throw new Error(`${this.name}: unexpected event ${JSON.stringify(early)}`);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        resolve();
      }, windowMs);

      const listener = (event: Event) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        reject(new Error(`${this.name}: received something it should not have: ${JSON.stringify(event)}`));
      };
      this.listeners.add(listener);
    });
  }

  async stop(): Promise<void> {
    this.send({ cmd: 'quit' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (!this.proc.killed) this.proc.kill();
  }
}

const isMessage = (content: string) => (e: Event) =>
  e.type === 'message' && e.content === content;

const results: { name: string; ok: boolean; detail: string }[] = [];

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
  process.stdout.write(`\n▸ ${name}\n`);
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    process.stdout.write(`  PASS — ${detail}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    process.stdout.write(`  FAIL — ${detail}\n`);
  }
}

// ── Scenario 1: mutual pairing, both directions ──────────────────────────

await scenario('Two paired peers exchange messages over a bridged pipe', async () => {
  const alice = new Peer('alice');
  const bob = new Peer('bob');

  try {
    const aliceReady = await alice.wait((e) => e.type === 'ready', 30_000, 'alice ready');
    const bobReady = await bob.wait((e) => e.type === 'ready', 30_000, 'bob ready');

    // Both sides register the other. Skipping either half is scenario 2.
    alice.send({ cmd: 'pair', ticket: bobReady.ticket });
    bob.send({ cmd: 'pair', ticket: aliceReady.ticket });
    await alice.wait((e) => e.type === 'paired', 5_000, 'alice paired');
    await bob.wait((e) => e.type === 'paired', 5_000, 'bob paired');

    alice.send({ cmd: 'connect', ticket: bobReady.ticket });
    await alice.wait((e) => e.type === 'connected', 20_000, 'alice connected');

    const aliceToBob = `hello-from-alice-${Date.now()}`;
    alice.send({ cmd: 'send', content: aliceToBob });
    await bob.wait(isMessage(aliceToBob), DELIVERY_TIMEOUT_MS, 'bob to receive alice');

    // The reverse direction is a separate claim: the dialer received on a
    // connection it opened, which is not the same as the listener sending back.
    const bobToAlice = `hello-from-bob-${Date.now()}`;
    bob.send({ cmd: 'send', content: bobToAlice });
    await alice.wait(isMessage(bobToAlice), DELIVERY_TIMEOUT_MS, 'alice to receive bob');

    bob.send({ cmd: 'status' });
    const status = await bob.wait((e) => e.type === 'status', 5_000, 'bob status');

    return `both directions delivered; bob peerCount=${status.peerCount}, path=${status.relayed ? 'RELAYED' : 'direct'}`;
  } finally {
    await alice.stop();
    await bob.stop();
  }
});

// ── Scenario 2: one-sided pairing must NOT deliver ───────────────────────

await scenario('One-sided pairing delivers nothing (the silent-drop trap)', async () => {
  const alice = new Peer('alice');
  const bob = new Peer('bob');

  try {
    // Alice's ticket is deliberately never handed to Bob — that is the whole
    // point of this scenario — so only wait for her, don't capture it.
    await alice.wait((e) => e.type === 'ready', 30_000, 'alice ready');
    const bobReady = await bob.wait((e) => e.type === 'ready', 30_000, 'bob ready');

    // Only Alice pairs. Bob never learns Alice's key, so he must ignore her.
    alice.send({ cmd: 'pair', ticket: bobReady.ticket });
    await alice.wait((e) => e.type === 'paired', 5_000, 'alice paired');

    alice.send({ cmd: 'connect', ticket: bobReady.ticket });
    await alice.wait((e) => e.type === 'connected', 20_000, 'alice connected');

    const orphan = `should-never-arrive-${Date.now()}`;
    alice.send({ cmd: 'send', content: orphan });

    // Alice believes she sent it — that is precisely why this is dangerous.
    const sent = await alice.wait((e) => e.type === 'sent', 5_000, 'alice send ack');
    await bob.expectNothing(isMessage(orphan));

    return `alice reported sent (id=${String(sent.id).slice(0, 8)}), bob correctly received nothing in ${NON_DELIVERY_WINDOW_MS}ms`;
  } finally {
    await alice.stop();
    await bob.stop();
  }
});

// ── Scenario 3: messages queued offline arrive on reconnect ──────────────

await scenario('A message sent offline is delivered after reconnecting', async () => {
  const alice = new Peer('alice');
  const bob = new Peer('bob');

  try {
    const aliceReady = await alice.wait((e) => e.type === 'ready', 30_000, 'alice ready');
    const bobReady = await bob.wait((e) => e.type === 'ready', 30_000, 'bob ready');

    alice.send({ cmd: 'pair', ticket: bobReady.ticket });
    bob.send({ cmd: 'pair', ticket: aliceReady.ticket });
    await alice.wait((e) => e.type === 'paired', 5_000, 'alice paired');
    await bob.wait((e) => e.type === 'paired', 5_000, 'bob paired');

    alice.send({ cmd: 'connect', ticket: bobReady.ticket });
    await alice.wait((e) => e.type === 'connected', 20_000, 'alice connected');

    alice.send({ cmd: 'offline' });
    await alice.wait((e) => e.type === 'offline', 5_000, 'alice offline');

    const queued = `queued-while-offline-${Date.now()}`;
    alice.send({ cmd: 'send', content: queued });
    await alice.wait((e) => e.type === 'sent', 5_000, 'alice queued send');

    // While offline it must not reach Bob — otherwise "offline" means nothing.
    await bob.expectNothing(isMessage(queued), 3_000);

    alice.send({ cmd: 'online' });
    const online = await alice.wait((e) => e.type === 'online', 10_000, 'alice online');
    await bob.wait(isMessage(queued), DELIVERY_TIMEOUT_MS, 'bob to receive queued message');

    return `held while offline, then delivered on reconnect (flushed=${online.flushed})`;
  } finally {
    await alice.stop();
    await bob.stop();
  }
});

// ── Report ───────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${'─'.repeat(64)}\n`);
for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n`);
process.stdout.write(`${'─'.repeat(64)}\n`);
process.stdout.write(`${results.length - failed.length}/${results.length} scenarios passed\n`);

process.exit(failed.length === 0 ? 0 : 1);
