/**
 * Changing a profile reaches contacts, and so does clearing one.
 *
 *   npx tsx harness/profile-updates.mts
 *
 * Reported: removing a profile picture appeared to work on the device that
 * removed it, and contacts went on seeing the old one.
 *
 * Clearing is the case that breaks, because "leave this field alone" and "set
 * this field to nothing" are the same value in most shapes — `undefined` — and
 * a partial-update API has to distinguish them. Anything that flattens the two
 * silently turns a removal into a no-op, which is exactly what a person
 * reports as "it did not save".
 *
 * Two peers, a real connection, and the receiving side is what gets asserted.
 */

import { DicsussionClient } from '@dicsussion/sdk';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/*
 * Bob is on disk, not in memory, so he can leave and come back as *himself*.
 * A fresh `:memory:` client is a different person with a different did, which
 * Alice has never paired with — testing the return that way proves nothing,
 * and quietly passes for the wrong reason or fails for the wrong one.
 */
const bobStore = join(tmpdir(), `echoit-profile-updates-${process.pid}.sqlite`);
for (const suffix of ['', '-wal', '-shm']) rmSync(bobStore + suffix, { force: true });

const alice = await DicsussionClient.init({ storagePath: ':memory:' }, { transport: 'iroh' });
// A fixed key so the same store reopens. Fine here and nowhere else: a
// shipping build takes this from the OS keychain.
const BOB_KEY = 'harness-profile-updates-key';
const bob = await DicsussionClient.init(
  { storagePath: bobStore, storageKey: BOB_KEY },
  { transport: 'iroh' },
);

const seen: Array<{ did: string; displayName?: string; hasAvatar: boolean; bytes?: number }> = [];
bob.identity.onPeerProfile((did, profile) => {
  seen.push({
    did,
    displayName: profile.displayName,
    hasAvatar: !!profile.avatar,
    bytes: profile.avatar?.bytes.byteLength,
  });
});

for (let i = 0; i < 25 && !(alice.getTicket() as { derpRelay?: unknown }).derpRelay; i++) await wait(400);

const aliceTicket = alice.getTicket();
const bobTicket = bob.getTicket();
alice.addPeer(bobTicket.didKey, bobTicket.encryptionKey!);
bob.addPeer(aliceTicket.didKey, aliceTicket.encryptionKey!);
await alice.connect(bobTicket);
await wait(1500);

const picture = (byte: number, size = 64) => ({
  mime: 'image/jpeg',
  bytes: new Uint8Array(size).fill(byte),
});

/** Wait for bob to hold a profile matching a predicate. */
async function until(predicate: () => boolean, ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(200);
  }
  return false;
}

const held = () => bob.identity.getPeerProfile(alice.did);

// 1. Setting one arrives.
await alice.identity.setMyProfile({ displayName: 'Alice', bio: 'first', avatar: picture(1) });
check('a new profile reaches the contact',
  await until(() => !!held()?.avatar),
  JSON.stringify(seen[seen.length - 1]));
check('with the name and bio', held()?.displayName === 'Alice' && held()?.bio === 'first');
check('and the picture bytes', held()?.avatar?.bytes.byteLength === 64);

// 2. Replacing the picture replaces it rather than keeping the old one.
await alice.identity.setMyProfile({ avatar: picture(2, 128) });
check('a replaced picture reaches the contact',
  await until(() => held()?.avatar?.bytes.byteLength === 128),
  `now ${held()?.avatar?.bytes.byteLength} bytes`);
check('replacing only the picture keeps the name',
  held()?.displayName === 'Alice', held()?.displayName);

// 3. Changing text alone must not disturb the picture.
await alice.identity.setMyProfile({ bio: 'second' });
check('changing the bio alone leaves the picture',
  await until(() => held()?.bio === 'second') && held()?.avatar?.bytes.byteLength === 128,
  `bio=${held()?.bio} avatar=${held()?.avatar?.bytes.byteLength}`);

// 4. The reported bug: clearing it.
await alice.identity.setMyProfile({ avatar: null });
check('clearing the picture reaches the contact',
  await until(() => !held()?.avatar),
  held()?.avatar ? `still ${held()?.avatar?.bytes.byteLength} bytes on the far side` : 'gone');
check('and does not wipe the name with it',
  held()?.displayName === 'Alice', held()?.displayName);

// 5. Clearing text too.
await alice.identity.setMyProfile({ bio: null });
check('clearing the bio reaches the contact',
  await until(() => !held()?.bio), `bio=${JSON.stringify(held()?.bio)}`);


/*
 * The case that actually bites: they were not there when you changed it.
 *
 * A profile is pushed to peers who are connected *now*, and the ordinary way
 * to change your picture is at a moment when the other person's phone is
 * asleep. If nothing re-offers it when they come back, every offline contact
 * keeps the old picture indefinitely — which is exactly the shape of "removing
 * it does not work, my contacts still see it".
 */
await bob.disconnect();
await wait(1000);

await alice.identity.setMyProfile({ displayName: 'Alice Offline', avatar: picture(9, 200) });
await alice.identity.setMyProfile({ avatar: null });

// The same store, so the same identity: Bob returning, not a stranger.
const bob2 = await DicsussionClient.init(
  { storagePath: bobStore, storageKey: BOB_KEY },
  { transport: 'iroh' },
);
check('the returning peer is the same identity', bob2.did === bob.did,
  bob2.did === bob.did ? bob.did.slice(0, 24) : `${bob.did.slice(0, 16)} vs ${bob2.did.slice(0, 16)}`);
bob2.addPeer(aliceTicket.didKey, aliceTicket.encryptionKey!);
await bob2.connect(alice.getTicket());
await wait(2500);

const late = () => bob2.identity.getPeerProfile(alice.did);
const arrived = await until(() => !!late(), 10000);
check('a contact who was away is given the profile when they return', arrived,
  arrived ? 'received' : 'nothing arrived at all');
check('and it is the current one, not the one from before they left',
  !!late() && !late()!.avatar && late()!.displayName === 'Alice Offline',
  `name=${late()?.displayName} avatar=${late()?.avatar ? 'STILL THERE' : 'gone'}`);

await bob2.disconnect();
for (const suffix of ['', '-wal', '-shm']) rmSync(bobStore + suffix, { force: true });

await alice.disconnect();

console.log(`\n${'-'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  profile edits and removals both reach contacts');
console.log('-'.repeat(60));
process.exit(failures ? 1 : 0);
