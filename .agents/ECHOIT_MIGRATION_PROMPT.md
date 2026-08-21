# Prompt for the EchoIt agent

Copy everything below the line into the EchoIt agent.

---

## Task: switch from the local Dicsussion source to the published npm packages

Dicsussion Protocol is now published. Stop consuming it from a local path and
depend on the registry instead.

```bash
npm install @dicsussion/sdk@0.1.0
```

`@dicsussion/core@0.1.0` comes along as a dependency — do not install it
separately unless you import from it directly, in which case add it
explicitly rather than relying on a transitive install.

Both are Apache-2.0.

### Remove the local wiring

Search the project for and delete every one of these:

- `file:` or `link:` protocol entries in `package.json` pointing at
  `DicsussionProtocol`
- `paths` mappings in `tsconfig.json` aimed at
  `../DicsussionProtocol/packages/*`
- Any `resolve.alias` / `moduleNameMapper` / Metro `extraNodeModules` entry
  redirecting `@dicsussion/*` to a local directory
- Relative imports that reach outside the EchoIt project, e.g.
  `../../DicsussionProtocol/packages/HLessEnd/src/...`

After the change, nothing in EchoIt should reference the DicsussionProtocol
directory. Verify with a grep for `DicsussionProtocol` across the repo —
expect zero hits outside documentation.

---

## Four things that will break if you don't handle them

These are behaviour changes from the local version you were building against.
Read them before running anything.

### 1. `@dicsussion/core` has no root entry point

Subpath imports only. `require('@dicsussion/core')` and
`import ... from '@dicsussion/core'` both fail by design.

```js
// correct
import { generateEd25519Keypair, encrypt } from '@dicsussion/core/crypto';
import { publicKeyToDidKey }               from '@dicsussion/core/transport';
import { BoundedMembershipTree }           from '@dicsussion/core/crdt';

// fails
import { generateEd25519Keypair } from '@dicsussion/core';
```

Available subpaths: `/crypto`, `/transport`, `/crdt`, `/zk`.

`@dicsussion/sdk` does have a root entry, plus `@dicsussion/sdk/browser`.

### 2. `storageKey` is now REQUIRED for on-disk storage

`DicsussionClient.init()` **throws** if `storagePath` names a real file and no
`storageKey` is supplied. It used to log a warning and store identity secrets
in plaintext. This will break EchoIt at startup if you were relying on the old
behaviour.

```js
const client = await DicsussionClient.init({
  storagePath: '/path/to/echoit.db',
  storageKey: <32-byte key or passphrase>,   // now mandatory
});
```

Where the key comes from is EchoIt's decision, not the SDK's. On phones the
right source is the OS keystore — Android Keystore / iOS Keychain, e.g. via
`react-native-keychain` — not a hardcoded constant and not a value derived
from something guessable like a device id.

Exemptions: `storagePath: ':memory:'` needs no key, and
`allowUnencryptedStorage: true` opts out explicitly. **Do not use the opt-out
in shipping builds.** It exists so tests can be honest about what they're
skipping.

If you pass a **passphrase string**, it is now stretched with Argon2id
(~500 ms, once per database) rather than HKDF, and sealed values use a `v2:`
format carrying a per-database salt. Old `v1:` values still open. If EchoIt
already has databases in the field, they keep working.

### 3. Pairing is mandatory AND mutual

This is the largest behavioural change and it has direct UX consequences.

Both devices must call `addPeer()` with the other's X25519 key before **any**
traffic flows. Previously only the dialer needed to. Now:

- The dialer must have paired, or `connect()` throws
- The receiver must have paired, or every inbound frame is silently dropped —
  no messages, no CRDT sync, no vouchers

A completed handshake authenticates *a key*, not a relationship. The `did:key`
in a handshake is self-asserted, so a stranger with a freshly generated
keypair is indistinguishable from a friend until pairing separates them.
Before this gate, anyone holding a public ticket — and tickets are designed to
be shared — could inject messages into a stranger's chat history.

**What EchoIt needs:** a two-sided pairing flow. The natural shape is a QR
code or deep link carrying a ticket (`client.getTicket()` already includes the
encryption key), scanned or opened by the other person, with **both** clients
calling `addPeer(did, encryptionKey)`.

Design it so a one-sided pairing is visibly incomplete in the UI. A user who
scans but isn't scanned back will see a connected peer who never receives
anything, and "it says connected but nothing sends" is a miserable bug report.

### 4. `allowDevelopmentCeremony` is obsolete — remove it

The trusted setup ceremony completed on 2026-08-11. The proving key shipped in
`@dicsussion/core@0.1.0` is the real six-party output, so the development-key
guard no longer triggers and the flag does nothing.

Delete every occurrence. Leaving it in shipping config is a latent hazard: if
a future build ever picks up a development key, that flag is exactly what
would let it through silently.

---

## Zero-knowledge proofs are now real

Before this release, proofs were unusable — the bundled key came from a
single-party setup, and both proving and verifying refused it.

They now work. Enabling them is a product decision:

```js
// per client, the default for channels this node creates
DicsussionClient.init({ zkProofs: 'anonymous', ... })

// or per channel, which is what the peer actually enforces
client.groups.createGroup('name', [], { requireProofs: true })
```

Proving costs roughly **1 second per message** on WASM. That is worth paying
on an open or adversarial channel where "some member in good standing sent
this" is the only claim available. It is wasted in a two-person chat where
both parties know exactly who the other is.

**Without proofs, RLN is advisory, not enforcement.** The nullifier and Shamir
share still travel with each message, but nothing binds them to the sender's
secret — they are values the sender chose. They catch an honest client that
double-sends and nothing else. Do not describe proof-disabled RLN to users as
spam protection.

Also: **do not enable reputation tiers.** `userScore` is an unattested private
input, so the range proof establishes nothing until scores are committed to
the membership tree. It is blocked in application code on both sides. Lifting
that restriction without changing the circuit makes quotas forgeable 100x.

---

## Known limits that matter to EchoIt

**The WebSocket relay does not encrypt CRDT traffic.** Chat bodies are sealed,
but document sync, membership, vouchers, and RLN signals cross the relay in
the clear, so a relay operator can read message history and the membership
graph.

**This does not affect EchoIt** — it is browser-only, and EchoIt targets
phones and desktop, which use Iroh/QUIC with no readable intermediary. Stated
here so nobody later "helpfully" adds a WebSocket fallback for a flaky-network
case and silently gives up the protocol's main property. If you ever need a
browser build, treat the relay as unsuitable for confidential use until this
is fixed upstream.

**Replicated CRDT changes are not individually authenticated.** Only paired
peers can submit changes, but a peer you later distrust can still write
arbitrary state. Relevant if EchoIt adds a block/remove-contact feature —
removing a peer from the UI does not retroactively invalidate what they wrote.

**Chat content at rest is unencrypted.** `storageKey` protects identity
secrets; message bodies and Automerge snapshots are stored directly. If EchoIt
promises anything about local data protection, this is the gap to know about.

---

## Verification steps

Run these and report the results.

1. `npm ls @dicsussion/sdk @dicsussion/core` — both resolve from the registry
   at 0.1.0, with no `file:` or `link:` in the tree
2. `grep -r DicsussionProtocol .` — no hits outside documentation
3. Typecheck and build pass
4. The app starts, creates an identity, and persists it across a restart
   (this exercises the new `storageKey` requirement)
5. Two devices or emulators pair via ticket exchange and exchange a message —
   this is the check that catches a one-sided pairing flow
6. Existing EchoIt tests pass

If something fails in a way that looks like an SDK bug rather than an
integration mistake, report it with the exact error rather than working around
it. The SDK is v0.1.0 and real bugs are expected.

---

## Reference

- npm: https://www.npmjs.com/package/@dicsussion/sdk
- Source: https://github.com/mrsarthi/DicsussionProtocol
- Trusted setup record: https://github.com/mrsarthi/Ceremonial-Contributions
