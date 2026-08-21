# EchoIt — Master Prompt

*Paste everything below the line into the new agent as its first message.*

---

You are building **EchoIt**, a local-first, end-to-end encrypted messaging app —
a WhatsApp alternative for ordinary people, not crypto enthusiasts.

## 1. What EchoIt is

A messaging app where:

- **Conversations live on the user's device.** No server holds message history.
- **Nobody can read messages** — not us, not a relay, not an ISP. Encryption is
  end-to-end with per-recipient ephemeral key agreement.
- **No metadata leaks.** An observer cannot learn who messages whom, or which
  channels someone joined. Peers address each other by `did:key`; the wire
  carries only encrypted blobs.
- **Spam is stopped by mathematics, not moderators.** Every message carries a
  zero-knowledge proof that the sender is within their rate limit. Exceeding it
  mathematically reveals the sender's own identity secret and gets them
  automatically revoked network-wide. There is no moderation team, and no
  appeals process, because there is no human decision.

Target platforms: **phones and desktop.** Browsers are explicitly out of scope
for EchoIt (though the underlying SDK should remain usable by third-party
developers building browser apps).

**Positioning, in the user's language:** *"Your messages stay on your phone. We
can't read them. We don't want to."* Never lead with "decentralized",
"zero-knowledge", or "P2P" in UI copy — regular users care that it works, that
their friends are on it, and that it beats WhatsApp.

## 2. What already exists

The protocol is **built, tested and complete**. It lives in a separate repo:

```
../DicsussionProtocol        # the Dicsussion protocol engine + SDK
```

It is ~390 passing tests, clean typecheck, zero audit vulnerabilities, and
covers three full phases:

| Layer | What it gives you |
|---|---|
| **Transport** | Real QUIC via Iroh — NAT traversal, relay fallback, six multiplexed sub-streams, verified working between separate OS processes |
| **Crypto** | X25519 + AES-256-GCM E2EE, Ed25519 `did:key` identity, Chaumian blind signatures |
| **Sync** | Automerge CRDTs, offline outbox that flushes on reconnect, membership reconciliation |
| **Anti-spam** | Groth16 ZK-RLN — real proofs, quota enforcement, automatic slashing and revocation |
| **Reputation** | Web-of-Trust scoring, blind endorsement vouchers, verified-session credit |
| **Identity** | BIP-39 recovery phrases, deterministic derivation, encryption at rest, key revocation |
| **Groups** | Create / import / join / leave, anchored by a signed Channel Creator Genesis Anchor |

**You are not rebuilding any of this.** Your job is the application on top.

### The API you consume

```ts
import { DicsussionClient } from '@dicsussion/sdk';

const client = await DicsussionClient.init(
  { storagePath: './echoit.db', storageKey: <key from OS keychain> },
  { transport: 'iroh' },
);

client.did                      // this user's identity
client.getTicket()              // shareable pairing ticket (QR-able)
await client.connect(ticket)    // dial a peer
await client.chat.sendMessage({ channelId, content })
client.chat.onMessage(channelId, cb)
await client.chat.getHistory(channelId)
await client.groups.createGroup(name, members)
await client.identity.exportMnemonic()
await client.trust.getProfile(peerDid)
```

Read `../DicsussionProtocol/PROGRESS.md` for full context and
`packages/HLessEnd/src/index.ts` for the complete public surface.

### Repo relationship

EchoIt is its **own repository**. During development it depends on the protocol
via a local path:

```json
"dependencies": { "@dicsussion/sdk": "file:../DicsussionProtocol" }
```

This is deliberate: **if EchoIt ever needs to reach into SDK internals, that is a
bug in the SDK's public API, not a reason to reach in.** Report it upstream
rather than working around it. Later this becomes a published package.

## 3. Your first task is a spike, and it is a gate

**Do not build any UI until you have sent one message between two real phones.**

The SDK is Node-native: `better-sqlite3` and `@number0/iroh` are NAPI modules
that do **not** run in React Native's JavaScript engine. How the SDK executes on
a phone is the single biggest unknown in this project, and everything else
depends on the answer.

Investigate and report on the realistic options, which include:

- **React Native + nodejs-mobile** — embeds a real Node runtime; the SDK runs
  unchanged, at the cost of app size and a niche dependency.
- **React Native + replacing native deps** — swap `better-sqlite3` for
  `op-sqlite`, write a native bridge for Iroh. More work, more control.
- **Tauri v2** — Iroh is Rust-native so it embeds cleanly, but the SDK is
  TypeScript and would need to run in a webview or be partly ported.

Deliverable for the spike:

1. A recommendation with measured evidence, not opinion — app size, cold-start
   time, and whether a message actually crosses between two devices.
2. A working proof: **two physical phones exchanging one encrypted message.**
3. A written note on what you rejected and why.

If none of the options work, say so plainly rather than building on a foundation
you know is unsound. That outcome is a legitimate result of a spike.

`../DicsussionProtocol/scripts/peer-cli.mts` is a complete headless node driven
from a terminal — use it as the reference for what the SDK needs at runtime, and
`../DicsussionProtocol/docs/DEVICE_TESTING.md` for how to test on real hardware.

## 4. What v1 should contain

Read `../DicsussionProtocol/.agents/ECHOIL_APP_STRATEGY.md` — it holds the
agreed product strategy. In short:

**In scope for v1**
- One-to-one and group chat
- Contact pairing by **QR code** (the SDK's ticket is designed for exactly this)
- Message history, search (local only), read receipts, typing indicators
- Block / report
- Identity backup via recovery phrase, and restore on a new device

**Out of scope for v1**
- Voice and video calls
- File sharing
- Public channels and communities
- Anything requiring a server to hold message content

**Never in scope**
- Server-side message storage
- Ad targeting or analytics that identify users
- Any backdoor, "lawful access" mechanism, or key escrow

## 5. How you must work

### Two files you maintain continuously

**`PROGRESS.md`** at the repo root. This is the durable memory of the project.
After every meaningful piece of work, update it with:
- What you built, and the file paths
- **Bugs you found, and what they would have caused if shipped**
- Design decisions *and the reasoning*, especially where you rejected an
  alternative — the reasoning is the valuable part, not the conclusion
- Anything deliberately left undone, stated plainly as not done
- Current test count and verification status

Start it with a "Status at a glance" table so anyone can see the state in ten
seconds without reading the history.

**`AGENT_INSTRUCTIONS.md`** — the standing rules for this codebase: architecture,
module boundaries, the roadmap, coding conventions, and any constraint you must
not violate. Keep it current as decisions are made.

### Engineering standards

- **TypeScript strict mode.** No `any` that isn't forced by a third-party type
  gap, and document it when it is.
- **Source files under ~300 lines of code.** When a file grows past that, the
  usual cause is that it has taken on a second responsibility.
- **Every feature ships with tests.** Not "tests later".
- **Test behaviour and failure modes**, not just happy paths. The valuable tests
  are the ones asserting what happens when a peer lies, a message is replayed,
  the network dies mid-send, or the user has no signal.
- **Comment the *why*, never the *what*.** `// increment counter` is noise.
  `// index is rank in sorted order, so an insert re-ranks everything above it`
  is the comment that saves someone an afternoon.

### How to report

- **Say what is actually true.** If tests fail, show the output. If something is
  half-finished, say which half. Never describe work as done when it is not.
- **Flag problems the moment you find them**, including problems in the
  specification or in instructions you were given. If a requirement is
  unachievable — a performance target, a security property — say so with
  evidence rather than quietly building something that misses it.
- **Distinguish what you verified from what you assume.** "Tested on two
  devices" and "should work on two devices" are different claims.
- **Surface decisions that are hard to reverse** *before* making them, not after.

### Verification before any claim of completion

```bash
npm run typecheck    # must be clean
npm test             # must be green, run twice to catch flakiness
npm audit            # must be clean
```

A test that fails intermittently is a bug — either in the code or in the test.
Find out which; never retry until it passes.

## 6. What the protocol will and will not do for you

**It handles:** encryption, identity, transport, NAT traversal, offline queueing,
CRDT convergence, rate limiting, reputation, revocation, group membership.

**It does not handle, and these are yours:**
- Anything a user sees or touches
- How two people find each other in the first place (the SDK gives you a ticket;
  turning that into a QR scan or a contact-list match is app work)
- Push notifications and background delivery — Android and iOS both kill
  backgrounded processes, and this is the hardest unsolved problem for a P2P
  messenger. Plan for it early; it will shape your architecture.
- Backup, multi-device sync, and account migration UX
- Anything about how the app feels

## 7. The standard to hold

Regular people will use this to talk to their families. It has to be *boring* in
the best sense: it works, messages arrive, nothing surprises anyone.

The privacy guarantees are only real if the app doesn't undermine them — a
plaintext log, a crash reporter carrying message contents, or an analytics SDK
phoning home would each quietly break the promise the protocol works hard to
keep. Treat every dependency you add as something that could leak, and check.

Start with the spike. Report what you find before building anything on top of it.
