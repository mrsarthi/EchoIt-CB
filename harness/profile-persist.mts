/**
 * A cleared profile field stays cleared across a restart.
 *
 *   npx tsx harness/profile-persist.mts
 *
 * Reported as "removing the picture doesn't work, my contacts still see it",
 * and the reason turned out to be neither the sending nor the receiving side:
 * both were verified working on two phones, with the far side dropping the
 * picture within seconds. The removal simply did not survive the *owner's*
 * app restarting, so the old profile came back and was re-offered to everyone
 * on the next connection.
 *
 * That is the worst shape a bug like this can take. Every immediate check
 * passes — the button flips, the contact's copy clears — and it undoes itself
 * later, somewhere nobody is looking.
 *
 * Nothing here touches the network. One client, on disk, reopened.
 */

import { DicsussionClient } from '@dicsussion/sdk';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const store = join(tmpdir(), `echoit-profile-persist-${process.pid}.sqlite`);
const KEY = 'harness-profile-persist-key';
const clean = () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(store + suffix, { force: true });
};
clean();

const open = () => DicsussionClient.init(
  { storagePath: store, storageKey: KEY },
  { transport: 'iroh' },
);

const picture = { mime: 'image/jpeg', bytes: new Uint8Array(96).fill(7) };

try {
  // 1. Set everything, then reopen: it should all still be there.
  const first = await open();
  await first.identity.setMyProfile({ displayName: 'Sarthi', bio: 'building', avatar: picture });
  check('set in memory', !!first.identity.getMyProfile()?.avatar);
  await first.disconnect();

  const second = await open();
  const kept = second.identity.getMyProfile();
  check('a profile survives a restart', !!kept, JSON.stringify(kept && { name: kept.displayName }));
  check('including the picture', kept?.avatar?.bytes.byteLength === 96,
    `${kept?.avatar?.bytes.byteLength ?? 'none'} bytes`);
  check('and the bio', kept?.bio === 'building');

  // 2. Clear the picture. In memory this works — it is what the far side sees.
  await second.identity.setMyProfile({ avatar: null });
  check('clearing empties it in memory', !second.identity.getMyProfile()?.avatar);
  check('and leaves the name alone', second.identity.getMyProfile()?.displayName === 'Sarthi');
  await second.disconnect();

  // 3. The whole point.
  const third = await open();
  const after = third.identity.getMyProfile();
  check('a cleared picture stays cleared after a restart', !after?.avatar,
    after?.avatar
      ? `it came back — ${after.avatar.bytes.byteLength} bytes`
      : 'still gone');
  check('and the rest of the profile is intact', after?.displayName === 'Sarthi',
    `name=${after?.displayName}`);

  // 4. Same question for the bio, since it is cleared the same way.
  await third.identity.setMyProfile({ bio: null });
  await third.disconnect();
  const fourth = await open();
  check('a cleared bio stays cleared after a restart', !fourth.identity.getMyProfile()?.bio,
    `bio=${JSON.stringify(fourth.identity.getMyProfile()?.bio)}`);
  await fourth.disconnect();
} finally {
  clean();
}

console.log(`\n${'-'.repeat(60)}`);
console.log(failures ? `FAIL  ${failures} check(s)` : 'PASS  removals survive a restart');
console.log('-'.repeat(60));
process.exit(failures ? 1 : 0);
