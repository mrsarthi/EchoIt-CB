/**
 * How long does a big file actually take, and what does it cost in memory?
 *
  npx tsx harness/blob-throughput.mts
 *
 * Grounds the size-cap decision in numbers instead of intuition.
 *
 * ## Read this before quoting the result
 *
 * Both peers run in THIS process, on one event loop. Encryption, hashing and
 * both ends of the transfer compete for the same thread, so the figure is not
 * a clean measure of the protocol - it is a measure of the protocol under a
 * deliberately unfair arrangement. Treat it as a lower bound and a way to
 * compare changes, never as the number a phone will see.
 *
 * The only number that decides the cap is a real transfer between two phones.
 *
 * Measured 2026-08-27, SDK 0.7.1, 256KB chunks:
 *
 *     1 MB    4.5s     0.2 MB/s
 *     8 MB   37.1s     0.2 MB/s
 *    32 MB  157.2s     0.2 MB/s     RSS 470 MB for a 32 MB file
 *    64 MB  FAILED     BlobUnavailableError
 *
 * Flat throughput across sizes, ~1.25s per 256KB chunk, which looks like one
 * round trip per chunk rather than a pipeline. The 64MB failure is the 30s
 * stall timeout being reached, not a cap being enforced.
 */
import { DicsussionClient } from '@dicsussion/sdk';
import { decodeTicket, encodeTicket } from '@dicsussion/core/transport';

const CHANNEL = 'size-probe';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

const alice = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
const bob = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });

const at = decodeTicket(encodeTicket(alice.getTicket()));
const bt = decodeTicket(encodeTicket(bob.getTicket()));
alice.addPeer(bt.didKey, bt.encryptionKey!);
bob.addPeer(at.didKey, at.encryptionKey!);
alice.chat.createChannel(CHANNEL, [bt.didKey]);
bob.chat.createChannel(CHANNEL, [at.didKey]);
await alice.connect(bt);
await wait(2000);

console.log('size      put      transfer   throughput   peak RSS');
console.log('-'.repeat(58));

for (const sizeMb of [1, 8, 32, 64]) {
  const bytes = new Uint8Array(sizeMb * 1024 * 1024);
  for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i & 0xff;

  const t0 = Date.now();
  const ref = await alice.blobs.put(bytes, 'video/mp4');
  const putMs = Date.now() - t0;

  const t1 = Date.now();
  let got: Uint8Array | undefined;
  try {
    got = await bob.blobs.get(ref);
  } catch (error) {
    console.log(`${sizeMb} MB    FAILED: ${(error as Error).message}`);
    continue;
  }
  const transferMs = Date.now() - t1;
  const rss = process.memoryUsage().rss;

  console.log(
    `${String(sizeMb).padStart(2)} MB   `
    + `${String(putMs).padStart(5)}ms  `
    + `${String(transferMs).padStart(7)}ms  `
    + `${(sizeMb / (transferMs / 1000)).toFixed(1).padStart(7)} MB/s   `
    + `${mb(rss).padStart(9)}`
    + (got.length === bytes.length ? '' : '  MISMATCH'),
  );
}

await alice.disconnect().catch(() => {});
await bob.disconnect().catch(() => {});
process.exit(0);
