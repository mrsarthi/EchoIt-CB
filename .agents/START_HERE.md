# START HERE

*Originally written 2026-08-21 when the project moved into this repository from
a scratch folder. Rewritten end to end on 2026-08-31, **and brought current on
2026-09-03** to carry everything
known about EchoIt — every settled decision, every trap, every measurement and
the reasoning behind each — so that someone arriving cold finishes this file
knowing what the people who built it know.*

*If you read only one file, read this one. If a claim here disagrees with the
code, check which was written later and **say so** rather than silently picking
one.*

---

## Table of contents

1. [What EchoIt is](#1-what-echoit-is)
2. [The stack, and why each piece](#2-the-stack-and-why-each-piece)
3. [Rules that are not negotiable](#3-rules-that-are-not-negotiable)
4. [Every settled decision](#4-every-settled-decision)
5. [Where things actually stand](#5-where-things-actually-stand)
6. [The architecture you need in your head](#6-the-architecture-you-need-in-your-head)
7. [Things that look wrong and are not](#7-things-that-look-wrong-and-are-not)
8. [Findings — open](#8-findings--open)
9. [Findings — closed, but worth knowing](#9-findings--closed-but-worth-knowing)
10. [Lessons this project paid for](#10-lessons-this-project-paid-for)
11. [How to verify anything](#11-how-to-verify-anything)
12. [Releasing](#12-releasing)
13. [Outstanding for 1.0.0](#13-outstanding-for-100)
14. [Where everything lives](#14-where-everything-lives)
15. [After 1.0.0 — delivery while closed](#15-after-100--delivery-while-closed)

---

## 1. What EchoIt is

A local-first, end-to-end encrypted messenger **for ordinary people**. A
privacy-respecting WhatsApp alternative — explicitly *not* a tool aimed at
activists, journalists or cryptographers. That audience choice decides more
arguments than anything else in this file: it is why the UI never leads with
jargon, why "run your own relay" cannot be the default, and why a feature that
is technically superior but needs explaining usually loses.

Messages go device to device over QUIC. **No server holds history — ever.**

- **Targets: Windows and Android (`aarch64`) only.** No macOS, no Linux, no iOS.
- **1:1 conversations only.** Groups are deferred, not abandoned.
- Built on the sibling **Dicsussion protocol SDK**, consumed from npm.

The product voice, the verbal rules and the pairing microcopy live in
`design/PRODUCT.md`. It is not decoration — audits have caught shipped copy that
was actively false, and §1's server sentence was wrong for nine days.

### The posture, quoted exactly

> **"Your messages stay on your phone. We can't read them. We don't want to."**

Everything narrower has to survive inspection against that.

---

## 2. The stack, and why each piece

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri v2** | One codebase for Windows + Android; Rust for the parts a webview cannot do. Chosen over Electron (size) and React Native (no Rust transport story) |
| UI | React + Vite, TypeScript | Inline styles against `design/tokens.css`; no CSS framework |
| Protocol | `@dicsussion/sdk` + `@dicsussion/core` **0.8.1** | Sibling project, consumed from npm, never edited here |
| Transport | **iroh** QUIC, held in Rust | Hole punching, relay fallback |
| Storage | IndexedDB via the SDK's driver | Sealed at rest since 0.8.1 |
| Keys | OS keychain — Windows Credential Manager / Android Keystore | `storageKey` never touches disk in the clear |

### The single most confusing thing in the codebase

**There are two transports, and they are not wire-compatible.**

- **Native** (`harness/*.mts`, plain Node): the SDK opens one QUIC bi-stream per
  sub-stream, each led by a tag byte.
- **Bridged** (the Tauri app, Windows *and* Android): Rust holds the QUIC
  connection and the protocol rides a pipe into the webview.
  `src-tauri/src/iroh_bridge.rs` accepts **exactly one** `accept_bi` per
  connection and multiplexes everything over it.

They share an ALPN and nothing else. Dialling the app from a Node harness
completes the QUIC handshake and then dies at the protocol handshake with
`FinishedEarly(0)` — **it looks exactly like a network fault and is not one.**
It fails identically with both peers on the same LAN.

This cost an afternoon and produced a wrong diagnosis ("the phone's default
route is cellular") that had to be retracted. To knock a phone, knock it from
the desktop app, which is bridged too. The full note is at the top of
`harness/knock-peer.mts`.

### Streams the SDK uses

| Tag | Carries |
|---|---|
| `0x02` | session-sealed messages |
| `0x07` | ephemeral — typing, presence heartbeats, read receipts |
| `0x08` | profiles |
| `0x09` | blobs / attachments |
| `0x0a` | pairing requests |
| `0x0b` | sealed messages |

`0x07` is **delivered now or not at all**: nothing stored, queued or replayed.
That is right for typing and presence, and it is why read receipts are re-sent
on connect rather than only when they change (see §6).

---

## 3. Rules that are not negotiable

1. **`../DicsussionProtocol/` is strictly read-only.** Not even JSON files. It
   is a separate repository with its own release cycle. If the app needs
   something from it, that is an upstream request, not an edit.

2. **The privacy constraints in `AGENT_INSTRUCTIONS.md` §3.** These are product
   promises, not preferences:
   - No server-side message storage. Ever. Not for sync, not for backup, not
     "temporarily".
   - No key escrow, no backdoor.
   - No analytics or crash reporter that can carry message content, contact
     identifiers, or `did:key` values.
   - No plaintext message content on disk outside the SDK's encrypted store.
   - `storageKey` comes from the OS keychain.

3. **The CSP must not be weakened.** `src-tauri/tauri.conf.json`. Verified at
   zero violations four separate times. Note what it does and does not cover:
   it stops the app's *screens* reaching the web; it never covered the
   transport, which is Rust. Believing otherwise is how §1's server claim
   stayed wrong for nine days.

4. **Never write an absolute server claim.** The approved wording is
   `design/PRODUCT.md` §1 and it is the user's to set, not yours to improve.
   `npm run check:claims` enforces the banned list against `src/`.

5. **Never lead with cryptographic jargon in UI copy.** `PRODUCT.md` §3 has the
   translation table. Audits have caught "Direct P2P Ready", "hardware
   keychain", and "Initializing encrypted database" — the last two also being
   *false*. Say **"connection helper"**, never "relay", "STUN", "NAT traversal"
   or "discovery".

6. **Do not break the bridge harness.** `VITE_HARNESS=bridge` renders
   `BridgeScreen`, and `window.__echoit` is read field-by-field by external
   drivers.

7. **Nothing is done because it compiled.** Every claim in `PROGRESS.md` was
   checked by running something. If you cannot verify a thing, **say so plainly
   rather than implying it works.**

---

## 4. Every settled decision

### The original question log (Q1–Q21)

| # | Question | Decision |
|---|---|---|
| **Q1–Q4, Q7** | Toolchain, upstream ownership, SDK-3b, frontend stack, pairing | Settled early; see git history of `IMPLEMENTATION_PLAN.md` |
| **Q5** | Groups in v1 | **1:1 only for beta.** Groups deferred |
| **Q6** | Anonymous messaging / web of trust | **Out of beta** (`zkProofs: 'off'`) |
| **Q8** | Background delivery | Was "as-is"; **superseded 2026-08-30** — see below |
| **Q9** | Distribution | **GitHub Releases** for the APK |
| **Q10** | Platform targets | **Windows + Android only** |
| **Q11** | Bundle identifier | `io.github.mrsarthi.echoit` — accidental (Tauri scaffold) but now baked into the keystore and unchangeable without breaking every install |
| **Q12** | Multi-device | **Deferred.** A QR-based design exists for later |
| **Q13** | Repo name | Development in **`EchoIt-CB`**; releases publish to **`EchoIt-Messenger`**. A *deliberate* split — do not reconcile them |
| **Q14** | Chat content at rest | **Encrypt it**, key derived from the recovery phrase so a restored device reads old history. Accepts that the phrase unlocks everything. **Delivered in SDK 0.8.1** |
| **Q15** | 32-bit Android | **Dropped.** `aarch64` only |
| **Q16** | CSP | **Closed.** Strict policy, zero violations, message flow intact |
| **Q17/Q18** | Pairing design | **Closed 2026-08-19** |
| **Q19** | File the `wmi` upstream report | **Set aside** |
| **Q20** | Remove the vendored `wmi` patch | **Keep checking** upstream |
| **Q21** | App updates | **Settled 2026-08-20.** One Rust command both platforms; Windows installs in place, Android opens the Releases page. Daily check, toggleable |

### Decisions taken 2026-08-30 / 31

| # | Question | Decision and reasoning |
|---|---|---|
| **D1** | Background delivery mechanism | **Foreground service with a permanent notification** — not FCM, not a mailbox. FCM would put Google's servers in the path of every message; a mailbox needs server-side storage, which rule 2 forbids outright. The foreground service adds **no new server and no new party** |
| **D2** | Notification content | **Sender only** — *"Message from Sarthi"*, never the text. Putting message text on a lock screen would undercut the same warning §4.1 gives about an unlocked phone |
| **D3** | Reactions | **In**, once the SDK could carry them. Blocked until 0.8.1; now available |
| **D4** | Link handling | **Highlight only, no previews.** A link renders as a link and tapping it asks for confirmation before opening. A preview fetch would ask a third-party web server for metadata — neither the update check nor "straight between your device and theirs" — and would require widening the CSP that §1 cites as its proof |
| **D5** | Scope of 1.0.0 | **1:1 only, Windows + Android only.** Confirmed, not assumed |
| **D6** | At-rest encryption | **Fixed in 0.8.1.** Was going to ship disclosed-but-unfixed |
| **D7** | Relay claim wording | Wanted, **in plain language** — §4.4 |
| **D8** | Whose relay | **Ours only.** Number 0's relays dropped from the pool 2026-08-31 |
| **D9** | Custom relay URL in Settings | **Yes.** It is what makes a hosted default trustworthy: *"we run one so it works; point it at your own if you'd rather"* |
| **D10** | Wiping a phone to test onboarding | **Permitted** |

### The §1 server claim — the longest-running argument

`PRODUCT.md` §1 said: *"The only thing EchoIt asks a server is whether there's a
new version."* **That was false from the first build.** The app reaches a
connection helper and publishes its own addresses on every launch.

It survived nine days because §1 cited the CSP as proof, and the CSP genuinely
does stop the *screens* reaching the web — but the transport is Rust and was
never covered by it.

Corrected 2026-08-30. §1 now names the helper, §4.3 no longer claims to be the
only server, §4.4 describes the helper including that **there is no toggle** for
it, and the app carries the disclosure under **CONNECTING** in Settings. That
last part was the real fix: the one place a user could check was saying less
than watching their own network would.

**Two things are deliberately not claimed, because they are untested:** whether
a helper can tell which two devices are reaching for each other, and anything
about what our own relay logs.

`npm run check:claims` now enforces both halves — no banned sentence in `src/`,
and the Settings copy must match §4.4 word for word. The second rule is the
important one: it catches an approved claim being quietly *softened*, which is
the likelier drift.

---

## 5. Where things actually stand

*Accurate as of 2026-09-03. Released version: **0.4.0** — everything since is
committed but unreleased. SDK **0.8.1**.*

### Proven on real hardware

- **Transport.** Two physical phones on mobile data behind carrier-grade NAT
  exchanged encrypted messages **directly**, not relayed. 377 ms connect,
  527 ms delivery.
- **A conversation between two physical phones**, both directions, through the
  real screens.
- **The same on the signed Windows release binary**, not a debug build.
- Onboarding, identity, recovery phrase, restore — driven from the DOM, so the
  phrase is read back and the confirmation answered from it.
- **OS keychain on both platforms**, surviving an APK reinstall.
- **CSP at zero violations** on WebView2 and on Android.
- Navigation shell — 4 destinations, responsive at 840px, safe-area insets,
  header clear of the status bar with the keyboard open.
- **Android back button** — walks back through visited views, asks before
  closing. Applied by `npm run android:prepare`; with only `android:sign`, back
  exits on the first press.
- **Presence** — 30s ephemeral heartbeat plus `onPeerDisconnected`, so the dot
  turns off as well as on.
- **Unread counts**, recent-first ordering, in-chat "new messages" badge.
- **Media sharing** — any file type; images and video inline and full-screen;
  documents open in the device handler; save to device. **16 MB cap** (the
  protocol's 64 MB does not complete).
- **Typing indicator** — 700 ms across two phones, expires on its own.
- **Swipe to reply, and chaining.** Uses the SDK's `replyTo` since 0.7.2;
  `decodeLegacyReply` still reads older messages and **must not be removed**.
- **Lazy loading** older messages, 60 at a time, holding the reader's place.
- **Profiles** — name, picture, bio; avatar shrink ladder 512→256→128.
- **Read receipts** as watermarks, shown at status boundaries.
- **Reachability-gated sending** — a message to an unreachable peer is queued
  locally and never handed to the transport.
- **Our own relay** at `echoit-relay.duckdns.org` confirmed carrying traffic and
  *chosen* over Number 0's by all three devices.
- **0.4.0 published** for Windows and Android; artifacts downloaded back and
  SHA-256 compared rather than trusting the upload.

### Background delivery — what is true, measured 2026-09-03

| State | Delivered live | Notification | Lost |
|---|---|---|---|
| Both apps open | yes | n/a | no |
| **Backgrounded** (open, not on screen) | **yes** — 4/4 at 10/30/90/180 s | **yes** | no |
| **Closed** (swiped from recents) | no | no | **no — arrives on reopening** |

The foreground service is what makes the middle row possible: without it the
process accumulated **zero** CPU ticks by 90 s; with it, 279–476. The bottom row
is architectural, not a bug — see §15.

**Screen-off over minutes remains unmeasured.** The one run that tried was
voided by Finding 21.

### Built, committed, and never seen on a device

All of this compiles, typechecks and is committed. **By this project's own rule
none of it is done.** Walking through it is the first job when two phones are
next available.

- **Reactions** — chips, picker, the 0.8.1 API
- **Link highlighting** and the confirm-before-opening dialog
- **The connection-helper URL control** in Settings (D9)
- **The Finding 17 fix** — a contact row that separates paired from present
- **Our-relay-only (D8)** — *the risky one.* It changes the transport, the only
  layer with real hardware proof behind it, and it has never run on two phones.
  **Verify this before anything else.**
- **The first-run profile screen** — needs an account that has never been named

### Not built

Groups. MediaStore (a saved photo does not appear in the Android Gallery).
Delivery while the app is closed (§15).

### Two things that will confuse you otherwise

- **Whoever adds second can send first.** Bilateral pairing needs evidence the
  other side added us, and whoever adds first gets that evidence only when the
  first message arrives. On two phones, have the second person send first.
- **`createChannel` must be called wherever a peer becomes known.** The
  guest-list filter (SDK 0.4.0+) is fail-closed: a channel missing its
  participant sends to nobody **and reports success**. It is called in three
  places for that reason.

---

## 6. The architecture you need in your head

### Naming — three strings, one screen

This caused a bug that looked like a sync fault and was not.

- **The local name** is what *you* typed when you added someone. The only one
  you have reason to trust.
- **The published name** arrives in their profile. A claim; anyone can publish
  anything.
- **The knock name** rides along with a pairing request, before any profile has
  synced. Also a claim.

`displayNameFor(localName, profile, peerDid, claimedAtPairing)` prefers them in
exactly that order and **never the other way round** — a peer who renames
themselves to match one of your contacts must not become indistinguishable from
them. Screens showing a claimed name must label it as one.

**The bug:** every path that created a contact filled an empty nickname with
`Device ending in ...abc123` *before storing it*, so "unnamed" became
indistinguishable from a chosen nickname, and the rule above then did exactly
what it should — forever. `localNameOf` recognises those baked-in placeholders,
including the legacy mixed-case spelling, so rows already on disk recover
without a migration.

### Receipts — watermarks, not acknowledgements

A receipt names a **time**, not a message: *"everything of yours up to T has
reached me"*. One number per peer per kind covers a conversation of any length,
is idempotent, and repairs itself.

Because they ride `0x07` (delivered now or never), they are **re-sent on
connecting**, not only when they change. Re-sending is free precisely because
they are watermarks.

`statusBoundaries` decides where the tick is drawn: the last message of each run
that shares a status. Never more than three markers in a conversation. "Only the
newest" was rejected — it hides that anything was read once a newer message is
merely sent.

### Presence and reachability

`isReachable` uses a 75 s window and refuses evidence from the future (a clock
that moved is not evidence). A send to an unreachable peer goes to
`pending-sends` in localStorage, keyed by id and **never removed by count** — an
interrupted flush must lose nothing.

### The timestamp corner

The time sits at the bottom right *inside* the bubble. It is a trick worth
understanding before touching it: one copy is absolutely positioned in the
corner, and an **identical hidden copy** sits inline at the end of the text so
the last line stops short by exactly its width.

A float was tried first and is wrong — a float pins to the *top* right, so a
wrapped message put its clock 137 px above the bottom of its own bubble.
`harness/cdp/drive-chat-timestamps.mjs` guards it.

### Storage, since 0.8.1

`message-store.js` seals `content` and `document-store.js` seals CRDT snapshot
bytes, both through `SecretBox`, keyed from the recovery phrase via the OS
keychain. **The columns around them are not sealed** — `author_did`,
`timestamp`, `channel_id` — because the database is queried by them. So the
filesystem still reveals **that** you spoke, **with whom**, and **when**, but not
**what**. `PRODUCT.md` §4.1 says exactly that and must not be rounded up.

---

## 7. Things that look wrong and are not

Each was a real bug once. Removing any of them silently reintroduces it.

| Where | What | Why |
|---|---|---|
| `AppContext` | `bootStarted` ref guard | React StrictMode double-invokes effects; without it two clients open the same IndexedDB |
| `AppContext` + `services/pending-reset.ts` | Reset marks a flag, reloads, and erases the database **before React mounts** | The SDK holds its IndexedDB connection open for the life of the page and has no `close()`. An in-place delete fires `onblocked` and silently leaves the data |
| `AppContext` | `contacts.length` in the reconnect effect's deps | Contacts load in a separate effect keyed on `did`, resolving *after* the client. Without it the first sweep dials nobody — and the symptom is silence |
| `services/reconnect.ts` | `refreshTicketAddresses()` before dialling | A stored ticket carries the addresses a peer had when it was made. Stale ones fail looking exactly like the network being down |
| `bridge-harness.ts` | `outbox=N` in `status()` | Without it, "queued and will arrive" and "vanished" are indistinguishable from outside |
| `services/reachability.ts` | `import ... from "./presence.js"` | The `.js` extension is required by the harness's node16 resolution and resolves fine in Vite |
| `services/reach.ts` | Re-exports `fingerprintOf` from `profile-format` | The harness compiles `profile-format` as Node code; an import the other way would not resolve |
| `ChatView` | Two copies of the timestamp | See §6 |
| `Avatar` | Keyed on the avatar object, not `updatedAt` | A removed picture kept rendering otherwise |

---

## 8. Findings — open

### Finding 21 — a message database was emptied 🟡
Filed as a release blocker on 2026-09-03 and **downgraded within the hour.**

`message_stream` went 76 → 0, `crdt_documents` 5 → 0, `blobs` 5 → 0 on a test
phone after the OS killed it. The identity survived, because it lives in
`localStorage` and the keychain.

The downgrade: a **third phone, untouched for three days, kept everything.**
That is the case the blocker claimed was at risk. What actually happened was on
the one device that had taken ~8 `adb install -r` cycles, many force-stops,
repeated `location.reload()` and finally a kill mid-write, all in one day. The
observation stands; the inference — "a routine OS kill erases history" — did
not.

**Unsettled.** To close it: reinstall-and-kill in a loop against known contents
and count the wipes. Until then, *"seen once, on a test device, under conditions
no user reproduces"* — not a blocker, not dismissed.

### Finding 18 — infrastructure half
Copy is fixed. **Address publishing still goes through Number 0's
`dns.iroh.link/pkarr` on every launch**, via `presets::N0`. Relay traffic moved
to ours on 2026-08-31; discovery did not, because there is no self-hosted pkarr
endpoint. §4.4 discloses this honestly, so it is an availability dependency
rather than a truthfulness problem.

### The app does not reconnect after an Android freeze
Both sides showed "last seen 4 minutes ago" while claiming "Connected directly";
only a restart recovered. Recorded, never fixed. This probably matters more than
it looks, because the foreground service changes the conditions under which it
happens.

### Delivery while the app is closed — architectural, see §15
Not a bug to fix in place. The protocol runs in the webview, the webview belongs
to the activity, and both die when the task is removed.

**Note the reversal:** an earlier entry here read *"the process is frozen, Rust
included — this killed the native-spool option."* That measurement predates the
foreground service. With it, Rust stays alive (279–476 ticks). **The native
spool is back on the table**, and §15 describes it. A settled conclusion built
on a measurement that no longer holds is worth re-checking whenever the
conditions change.

### `test:knock` is flaky
Two fresh Node peers over the real network with a **5-second** ceiling for the
request to arrive. It fails when the network is slow. The tolerance was left
alone rather than loosened to make it green — a test bent to pass hides the
thing it was written for.

### Unverified, and must not be claimed
- What the AWS relay logs. §4.4 stops at "stores nothing" for this reason.
- Whether a relay can correlate which two devices reach for each other.
- The in-place desktop update has never run end to end (now testable — 0.4.0
  has a predecessor).
- Dropping Number 0's relays has **not** been tested on hardware.

---

## 9. Findings — closed, but worth knowing

- **`SessionManager.requested`** — a receiver records a peer the first time it
  knocks and **drops every later request from them for as long as its app keeps
  running**, while telling the sender `delivered: true`. This looked exactly
  like "the display name is being dropped on the wire". Proved by restarting the
  receiving phone on its *unchanged* APK. `describeKnock` no longer promises
  "they will see it".
- **The envelope TTL** is 7 days, hard-capped by `Math.min` and enforced by the
  recipient.
- **A mailbox would have to *be* a paired peer**, not its own channel:
  `sendSealedTo` requires `paired && connection`.
- **The envelope TTL bounds ciphertext but not the index.** `(address, uploader,
  timestamp)` rows are the social graph. This is why the mailbox idea died.
- **Chat not opening at the latest message** — `holdBottom`'s three-stable-frames
  heuristic quit before late growth. Replaced with ResizeObserver +
  MutationObserver.
- **Conversation list previewed hidden messages** — now uses `visibleMessages`.
- **The Android icon.** There is no transparent launcher icon: Android
  composites a transparent adaptive background to **black**. `#3B1307` is the
  average of the darkest 2 % of opaque pixels in the artwork — brown, not black,
  and measured rather than picked.

---

### Finding 17 — closed 2026-09-03
*"A unilateral contact reports Connected directly"*, open since 2026-08-21.

The row took its status from `contact.pairingState`, a flag written once when
pairing completes and never revisited. It answered *"did we add each other"*
while presenting as an answer to *"are we connected"*. A peer who turned their
phone off, reinstalled, or **re-registered with a new identity** left a row
claiming a live connection forever.

`TwoStepsChecklist` takes an optional `lastHeardAt` and separates **paired**
from **here**. Callers that only know about pairing omit it and keep the old
wording.

### POST_NOTIFICATIONS was never requested
Android 13 made it a runtime permission and nothing asked. Measured:
`granted=true` on one phone, **`granted=false` on the other** — and the denied
one was the phone that reported notifications not working. Nothing fails loudly;
the notification is posted and the system drops it.

It also explains a second, apparently unrelated report — *"closing the app
closes the service"*. With the permission denied the **foreground notification
is not shown either**, so the only visible evidence the service is running
disappears, and a running service is indistinguishable from a stopped one.

`MainActivity` now asks on resume, once, without insisting.

## 10. Lessons this project paid for

**A stub may return a value only when that value is one the caller is designed
to receive.** A plausible-looking fake produces a bug that looks real.

**Two peers is not enough to test a messenger.** Findings 16 and 19 were both
invisible with exactly two peers and both appear the moment a third exists — one
as a message that vanishes, one as a message delivered to someone who should
never have seen it. Beta testers will have three.

**A click that changes React state and a click that reads it must be separate
CDP calls.** Doing both in one evaluation produced a confident report of a bug
that did not exist ("the picture comes back after restart"), which had to be
retracted.

**A checker that cannot fail is worse than no checker.** The first timestamp
overlap probe asked `elementFromPoint` what was under the clock. The answer is
always the clock — it is positioned on top by construction. It reported "clean"
on a page deliberately broken in front of it. Prove a check fails before
trusting it to pass.

**A check that always fails is also a check nobody reads.** The font-scale
checker once reported four failures on every tab at every scale including 1.0,
from a corner badge overhanging a non-clipping parent. Rewritten to fail only on
viewport overflow or actual clipping.

**Refuse rather than report a false zero.** Two background-delivery runs
reported "0/4 delivered" when the sender was not in a conversation and when the
receiver was reading the wrong screen. The drivers now check they can act before
they measure.

**A name is not an identifier.** Phone A re-registered, so the receiver held
*two* contacts both beginning "Phone A" — one dead, one live. Every device
driver opens a conversation by matching the peer's *name*, so hours of runs read
the dead one and reported 0/4 for a peer that no longer existed. The refusal
guards did not catch it: the run genuinely was in *a* conversation with *a*
composer, just the wrong one. **Assert the peer DID.**

**Check whether a settled conclusion still rests on a live measurement.**
"Rust is frozen too, so a native spool is impossible" was true and became false
the moment the foreground service existed — and would have stayed in the notes
as settled if a question had not been asked about it.

**Correlation is not causation, even at 3/3.** `test:knock` failed three runs
with local changes and passed three with them stashed. The file imports only the
SDK. Running it more showed it passing *with* the changes — network timing, not
code.

**Grammar bugs hide in string concatenation.** *"sent to 1 contact who are
online"* shipped. Found by reading a device, not the code.

**MACCO is input, not a verdict.** Its investigator mis-cited sources twice
(`SDK-REQUESTS.md` had no prekeys entry; `PRODUCT.md` never mentioned the
relay), and the challenger that caught it failed its own citation gate. Ask
before running it, and verify what it returns.

---

## 11. How to verify anything

`harness/cdp/README.md` has the drivers and launch incantations.

```bash
npm run typecheck && npm run build     # necessary, nowhere near sufficient
npm run check:claims                   # the server claim has not drifted
npm run test:two-peer                  # 3 scenarios, real QUIC, two OS processes
npm run test:three-peer                # does a 1:1 channel stay 1:1?
npm run test:receipts                  # watermarks, monotonic, boundary marks
npm run test:profile-names             # a claim never displaces a local name
npm run test:reachability              # the gate, and the queue losing nothing
node harness/cdp/drive-bridge.mjs      # two app instances exchange messages
node harness/cdp/csp-check.mjs 9222    # CSP violations + console errors
```

Device drivers (need a debug build installed and `adb`):

```bash
node harness/cdp/drive-android-chat.mjs <serial>
node harness/cdp/drive-android-font-scale.mjs <serial> 1.0,1.3
node harness/cdp/drive-chat-timestamps.mjs <serial> "Phone B" 1.0,1.3
node harness/cdp/measure-background-real.mjs <serial>
```

**`vite build` passing is not evidence `vite dev` works.** Bitten three times.
Check both.

**CDP notes that will save you an hour:**
- Attach via `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>`.
- `\n` inside a shell heredoc gets mangled; the existing drivers use
  `String.fromCharCode(10)` for exactly this reason.
- WebView `localStorage` writes are buffered — `am force-stop` loses them. Use
  `location.reload()` when you need a write to survive.
- Matching "the first element whose text starts with X" finds the list
  *container*, whose centre lands between rows. Take the **tightest** match.

---

## 12. Releasing

**Development is `EchoIt-CB`; releases publish to `EchoIt-Messenger`.** That
split is deliberate (Q13) — the updater points at a repository the code does not
live in **on purpose**. The publishing repo must stay public, because the update
check is an unauthenticated GET.

`.agents/RELEASING.md` is the runbook. Four steps are marked **UNRECOVERABLE**;
those are the ones that strand people who already installed.

**The standing risk, and the cheapest thing on this list to fix:** four signing
files exist **only on this machine** — the Android keystore (two copies),
`src-tauri/echoit-updater.key`, and `updater.properties`. Lose any of them and
no existing install can ever be updated, and testers must uninstall — which
destroys their message history.

---

## 13. Outstanding for 1.0.0

*Reviewed 2026-09-03. Everything below 0.4.0 is committed and unreleased.*

### One device session, in this order

1. **Verify D8 — our relay only.** First, because it changes the transport and
   could invalidate everything after it. Two phones, ideally mobile data.
2. **Walk the unverified UI**: reactions, link highlighting and its dialog, the
   connection-helper field, and a contact row correctly reading "not connected"
   for a dead peer.
3. **Screen-off delivery over minutes.** The one attempt was voided by Finding
   21. Use `KEYCODE_SLEEP`, never `KEYCODE_POWER` — power *toggles*, and a run
   that starts with the screen off turns it on and measures the opposite of what
   it claims.
4. **Settle Finding 21**: reinstall-and-kill in a loop against known contents,
   counting wipes.
5. **Render the first-run profile screen.** Needs a wipe; already approved.

### No phones required

- **In-place desktop update.** `installInPlace` exists and has never run end to
  end. Now testable — 0.4.0 has a predecessor.
- Version bump and release.

### Only the owner can do

- **Back up the four signing files off that machine.** Highest consequence on
  this list, five minutes of work. Lose them and no existing install can ever be
  updated, and testers must uninstall — which destroys their history.
- Decide whether the relay's logging is configured so the stronger "keeps no
  record" sentence becomes true.
- Stand up a pkarr endpoint, or accept discovery staying with Number 0 and keep
  saying so.

### Explicitly **not** blocking 1.0.0

- **Delivery while the app is closed.** §15. The honest promise is *"messages
  arrive whenever EchoIt is open, including backgrounded with the screen off; if
  you swipe it away they arrive when you open it again."* True, measured, and
  ordinary for a messenger without push.
- **Groups, iOS, MediaStore.** Out of scope by decision, not oversight.

---

## 14. Where everything lives

| Path | What |
|---|---|
| `.agents/START_HERE.md` | this file |
| `.agents/PROGRESS.md` | the decision log, newest first. Large — read the top and search |
| `.agents/IMPLEMENTATION_PLAN.md` | milestones and the settled-questions table |
| `.agents/AGENT_INSTRUCTIONS.md` | standing rules and the boundary rule |
| `.agents/RELEASING.md` | the release runbook |
| `.agents/ECHOIT_MASTER_PROMPT.md` | the original brief |
| `design/PRODUCT.md` | voice, verbal rules, disclosures, pairing microcopy |
| `design/DESIGN.md` | palette, layout, components |
| `design/tokens.css` | **single source of truth** for every token — import it, never copy values out |
| `harness/*.mts` | Node-level protocol tests |
| `harness/cdp/*.mjs` | device and app drivers |
| `scripts/` | build-time appliers (`android:prepare`) and `check-claims` |
| `docs/legacy/` | superseded material, **gitignored** where it names weaknesses |

*Deleted 2026-08-31: `ECHOIT_MIGRATION_PROMPT.md`, `SDK-REQUESTS.md`, and the
three `UI_AGENT_PROMPT*.md` files — all spent, and their conclusions are folded
into this document.*


## 15. After 1.0.0 — delivery while closed

*Design settled in discussion 2026-09-03. Not built.*

### The problem, exactly

The protocol — CRDT, sealing, message handling — is TypeScript in the webview.
The webview belongs to the activity and dies with it. A foreground service keeps
a **process** alive; it does not keep a **client** alive. Measured: after a
recents-swipe the service can still be running while `/proc/net/unix` shows the
webview devtools socket gone.

### What is smaller than it looks

`iroh_bridge.rs` **already reads every inbound byte** and forwards it with
`app.emit("iroh://inbound", ...)`. Rust is not a dumb pipe that needs teaching
the protocol — it already holds the connection and reads the frames, then
forgets them.

So the work is not "implement Dicsussion in Rust". It is: **when there is no
webview to emit to, spool the bytes to disk and replay them when one appears.**
The frames are sealed ciphertext; Rust never decrypts, never merges a CRDT,
never reads a message. It needs a connection, an opaque byte store, and the
peer's identity — which the transport already knows.

Two things fall out of this for free. The only notification such a spool *can*
produce is "message from X, no content", which is exactly D2 arrived at by
architecture rather than discipline. And spooling sealed bytes on-device is
neither server storage nor plaintext on disk, so it sits inside the rules.

### The shape: one endpoint, two consumers

**Not** two engines handing over. Iroh's endpoint key is derived from the
identity key by domain-separated HKDF, so a second endpoint claiming the same
identity produces the **same node id** — peers would see a drop and re-dial on
every open/close transition.

> One Rust endpoint that outlives the UI, with two consumers of its inbound
> stream: forward to the webview when one is attached, spool to disk when not.

The engine never stops. Only the consumer changes.

### Where the parts may come from

The owner is building **Chorrent** — a BitTorrent-style engine on iroh/QUIC,
library-first, in Rust. Its transport ownership, reconnection and resumable
byte storage are the same concerns. Its `ChunkStore` and `PeerDiscovery` traits
are the seams EchoIt would fill (EchoIt already has a contact list, so it brings
its own discovery).

Sequencing agreed: **media sharing first**, message spool second. Attachments
are chunked and resumable and failure is cheap — a slow photo. Messages are
small and ordered and failure means someone believes they said something they
did not.

### Still to design

- **The drain.** On reopen, spooled frames enter the SDK while live ones arrive.
  CRDT merging is order-insensitive; display ordering is not.
- **One writer, always.** Whatever owns the message store must be the only thing
  touching it — the SDK holds its IndexedDB connection for the life of the page
  and has no `close()`, so two live clients is corruption, not an error.
- **Swarms later.** Group chat adds membership and discovery on top. Do not let
  it shape the 1:1 spool.

---
