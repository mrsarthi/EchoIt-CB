# AGENT_INSTRUCTIONS.md — EchoIt

Standing rules for this codebase. Read this before touching anything. Update it
when a decision is made, not after the code has already drifted from it.

The source of truth for *what we are building* is
[`.agents/ECHOIT_MASTER_PROMPT.md`](.agents/ECHOIT_MASTER_PROMPT.md). This file
is the source of truth for *how we build it*.

---

## 1. What EchoIt is

A local-first, end-to-end encrypted messenger for ordinary people. Phones and
desktop. Conversations live on the device; no server holds history; peers
address each other by `did:key`.

**Positioning in user-facing copy:** *"Your messages stay on your phone. We
can't read them. We don't want to."* Never lead with "decentralized",
"zero-knowledge", or "P2P" in UI text.

**Browsers are out of scope for the EchoIt app.** The SDK may remain
browser-usable for third parties; EchoIt itself targets iOS, Android, and
desktop.

---

## 2. Repository relationship

EchoIt is its own repository. The protocol lives in a sibling repo:

```
../DicsussionProtocol        # Dicsussion protocol engine + SDK
```

> [!CAUTION]
> **CRITICAL RULE: DO NOT MAKE ANY TYPE OF CHANGES TO THE DICUSSIONPROTOCOL FOLDER, NOT EVEN JSON FILES.**

**We do not modify the protocol from this repo.** Under no circumstances should any file in `../DicsussionProtocol` be created, modified, edited, formatted, or deleted. If EchoIt needs something the SDK does not expose or requires an upstream fix, record it in `PROGRESS.md` under "Upstream requests" and report it to the user. Do not reach into `packages/core/**` or `packages/HLessEnd/**` internals as a workaround, and do not vendor a patched copy.

### The public API we consume

```ts
import { DicsussionClient } from '@dicsussion/sdk';

const client = await DicsussionClient.init(
  { storagePath: './echoit.db', storageKey: <key from OS keychain> },
  { transport: 'iroh' },
);

client.did                                   // our did:key
client.getTicket()                           // PeerTicket object (not a string)
await client.connect(ticket)                 // takes a PeerTicket object
await client.chat.sendMessage({ channelId, content })
client.chat.onMessage(channelId, cb)         // returns an unsubscribe fn
await client.chat.getHistory(channelId, limit?)
await client.groups.createGroup(name, members)
await client.identity.exportMnemonic()
await client.trust.getProfile(peerDid)
```

Verified against `packages/HLessEnd/src/index.ts`, last re-checked 2026-08-05.

EchoIt depends on **two** packages, both public:

- `@dicsussion/sdk` — the client, services, and storage stores.
- `@dicsussion/core` — subpath exports (`./transport`, `./crypto`, `./crdt`,
  `./zk`). We need `./transport` for `encodeTicket` / `decodeTicket` /
  `PeerTicket`, which the SDK does not re-export.

Depending on `@dicsussion/core` is **not** a boundary violation — it is a
published package with a declared `exports` map. Importing from
`@dicsussion/core/src/**`, or any path not named in that map, is.

---

## 3. Constraints that must not be violated

These are not preferences. Breaking one of these breaks the product's core
promise, and a promise broken quietly is worse than a feature missing loudly.

0. **DO NOT MAKE ANY TYPE OF CHANGES TO THE DICUSSIONPROTOCOL FOLDER, NOT EVEN JSON FILES.** The protocol repository `../DicsussionProtocol` is strictly read-only.
1. **No server-side message storage.** Ever. Not for sync, not for backup, not
   "temporarily".
2. **No key escrow, no backdoor, no "lawful access" mechanism.** Ever.
3. **No analytics or crash reporter that can carry message content, contact
   identifiers, or `did:key` values.** Treat every dependency as something that
   could leak, and verify before adding it.
4. **No plaintext message content on disk outside the SDK's encrypted store.**
   That includes logs, caches, crash dumps, and debug builds.
5. **`storageKey` comes from the OS keychain** (iOS Keychain, Android Keystore,
   Windows DPAPI / macOS Keychain on desktop). Never hardcoded, never derived
   from something guessable, never omitted — omitting it leaves secrets in
   plaintext, which the SDK permits for development and we do not.

Anything that trips one of these gets flagged before it is written, not after.

---

## 4. Runtime architecture

**EchoIt is a Tauri v2 app targeting Android, iOS, and desktop.** The reasoning
and the rejected alternatives are recorded as decision D1 in `PROGRESS.md`; the
short version is that `@number0/iroh` ships no iOS binary, so any route that
runs Node inside the app can reach Android but never iOS. Under Tauri, Iroh is
an ordinary Rust dependency.

The SDK runs **in the webview**, not in a Node process. Native capability comes
from Rust through seams the SDK already provides:

| Concern | Approach |
| :--- | :--- |
| Transport | `TauriIrohTransport implements ITransport`, proxying to a Rust Iroh endpoint over Tauri IPC. `runtime.transport` accepts an `ITransport` instance — documented as *"e.g. a browser backend"*. |
| Storage | `IndexedDbDriver`, already written and exported. Needs upstream **SDK-1** before it is reachable. |
| mDNS | Off by default; `discoverySocket` is injectable if needed. |
| ZK proving | `zkProofs: 'off'` until SDK-2 lands. |

**Do not introduce a Node sidecar.** It works on desktop and fails on mobile,
which defeats the point of the choice.

Node built-ins used by the SDK need webview shims: `node:events` → the `events`
package; `node:crypto` → WebCrypto plus `@noble/hashes` (already a dependency).
`node:fs`/`path`/`url` appear only in the ZK artifact loaders, and `node:dgram`
only in mDNS — both off the current path.

## 4a. The gate

**Do not build any UI until one encrypted message has crossed between two real
devices.** Everything else depends on that answer.

The spike runs in four stages, each one a gate on the next:

- **S0 — SDK in a webview.** Tauri scaffold, `IndexedDbDriver`,
  `transport: 'local'`. Client initialises, derives a `did:key`, sends a message
  to itself, and it survives an app restart. *Testable today on Windows, with no
  phone and no Mac — which is why it goes first.*
- **S1 — real QUIC between two desktop instances.** Rust Iroh plugin plus
  `TauriIrohTransport`. Ticket moved by clipboard paste.
- **S2 — Android.** One encrypted message between two physical devices. **This
  is the gate.**
- **S3 — iOS readiness.** Paper check only; no Mac. Confirm nothing in S0–S2
  forecloses iOS and record what a Mac would need to do.

Deliverables, all three required:

1. A recommendation backed by measurement — app size, cold-start time, and
   whether a message actually crossed.
2. A working proof: two physical devices, one encrypted message.
3. A written note on what was rejected and why.

"None of these work" is a legitimate result. Say it plainly rather than building
on a foundation known to be unsound.

Reference material: `../DicsussionProtocol/scripts/peer-cli.mts` is a complete
headless node and shows exactly what the SDK needs at runtime;
`../DicsussionProtocol/docs/DEVICE_TESTING.md` covers testing on real hardware.

---

## 5. Scope for v1

**In:** one-to-one and group chat · peer pairing · message history · local
search · read receipts · typing indicators · block/report · recovery-phrase
backup and restore on a new device.

**Out of v1:** voice and video · file sharing · public channels and communities
· anything needing a server to hold message content.

**Never:** the five constraints in §3.

**Pairing is an open question, not a settled design.** QR is one option among
several — clipboard paste, mDNS on a shared network, a short code. The spike
uses clipboard paste because it is the least work, not because it is the
answer. Whatever we pick must tolerate a stale ticket (see §9).

---

## 6. Engineering standards

- **TypeScript strict mode.** No `any` unless a third-party type gap forces it,
  and document the gap on the line where it happens.
- **Source files under ~300 lines.** Past that, the usual cause is a second
  responsibility that wants its own file.
- **Every feature ships with tests.** Not "tests later".
- **Test failure modes, not just happy paths.** The valuable tests are the ones
  asserting what happens when a peer lies, a message is replayed, the network
  dies mid-send, or the user has no signal.
- **Comment the *why*, never the *what*.** `// increment counter` is noise.
  `// index is rank in sorted order, so an insert re-ranks everything above it`
  saves someone an afternoon.
- **No god objects.** Small composable services with explicit interfaces.

### Verification before any claim of completion

```bash
npm run typecheck    # must be clean
npm test             # must be green — run twice, to catch flakiness
npm audit            # must be clean
```

A test that fails intermittently is a bug in the code or in the test. Find out
which. Never retry until it passes.

---

## 7. How to report

- **Say what is actually true.** If tests fail, show the output. If something is
  half-finished, say which half. Never describe work as done when it is not.
- **Distinguish verified from assumed.** "Tested on two devices" and "should
  work on two devices" are different claims and must read differently.
- **Flag problems the moment you find them**, including problems in the
  specification or in the instructions themselves. If a requirement is
  unachievable, say so with evidence rather than quietly missing it.
- **Surface hard-to-reverse decisions before making them.**

---

## 8. The two files we maintain

Both live in `.agents/`, alongside the master prompt.

**`PROGRESS.md`** — durable project memory. After every meaningful piece of
work: what was built and where, bugs found and what they would have caused if
shipped, design decisions *and the reasoning* (especially rejected
alternatives — the reasoning is the valuable part), anything deliberately left
undone stated plainly as not done, and current test count and verification
status. Opens with a "Status at a glance" table.

**`AGENT_INSTRUCTIONS.md`** — this file. Architecture, boundaries, roadmap,
conventions, constraints. Keep it current as decisions land.

---

## 9. Known unknowns to plan around

- **Background delivery.** iOS and Android both kill backgrounded processes.
  This is the hardest unsolved problem for a P2P messenger and it will shape the
  architecture — plan for it during the spike, not after the UI exists.
- **Multi-device sync.** The SDK has one identity per store. Two devices for one
  person is not a solved path yet.
- **Ticket freshness.** A `PeerTicket` embeds direct socket addresses, which go
  stale when the network changes. Any pairing flow must tolerate a ticket that
  no longer dials and fall back to the relay path rather than failing.
- **Proving cost on device.** Groth16 proving measures ~1.1 s on desktop. It is
  off the current path (`zkProofs: 'off'`), but enabling anonymous messaging
  puts that cost on every send. Measure it on hardware before designing any UI
  that assumes sending is instant.
- **iOS remains unbuilt.** Tauri keeps it open, but "keeps it open" is a claim
  we have reasoned to, not one we have compiled. It stays unverified until
  someone runs it on a Mac.
