# PROGRESS.md — EchoIt

## Status at a glance

*Last updated: 2026-08-27 · Runtime: **Tauri v2** · SDK `@dicsussion/*@0.5.0` · **🚪 GATE OPEN — two physical phones held a conversation through the real UI** · signed release artifacts built for Windows and Android, nothing published*

| Phase | Target / Deliverable | Status | Tests | Notes |
|---|---|---|---|---|
| **0. Groundwork** | Project context, standing rules, git hygiene | **Complete** | N/A | SDK surface validated by reading *and* by running it |
| **0.5. Runtime decision** | Choose the app runtime | **Complete** | N/A | **Tauri v2**, phones + desktop. Reasoning in D1 |
| **0.6. Scaffold** | Tauri v2 + React + Vite, SDK linked, webview shims | **Complete** | 0 | Typechecks, builds, `npm audit` clean. |
| **0.7. npm migration** | Consume published `@dicsussion/*@0.1.0` instead of local paths | **Complete** | 1 | All 4 applicable verification steps pass |
| **S0. SDK in a webview** | `DicsussionClient` boots in a Tauri webview, persists across restart | ✅ **PASSED** | 1 | Verified after a real process restart — see below |
| **S1a. Two peers talk (headless)** | Protocol + SDK prove two users can converse | ✅ **PASSED** | 3 | Real Iroh/QUIC, two OS processes, path **direct** |
| **S1b. Tauri transport bridge** | Rust Iroh plugin + bridged transport | ✅ **PASSED** | 1 | Two laptops, same network, both directions, **direct** |
| **S2. Android — the gate** | One encrypted message between two physical devices | ✅ **PASSED** | 1 | Direct, 377 ms connect, 527 ms delivery. **UI work is unblocked** |
| **S3. iOS readiness** | Paper check only — no Mac available | **Not Started** | 0 | Deferred by decision, not forgotten |
| **1. Core Application (v1)** | Chats, local storage, recovery | **In progress** | 0 | Onboarding + navigation shell done & audited. **Next: pairing (2.3)** |
| **Pre-UI hardening** | CSP locked down before the UI grows | ✅ **PASSED** | 2 | Strict policy, 0 violations, message flow intact — see below |

## ✅ M2.4 — messages actually send (2026-08-23)

**Two app instances held a conversation through the real UI, both directions.**

```
A adds B, B adds A (through Add Contact)
B sends: hello-from-B-...      B -> A: DELIVERED
A replies: hello-from-A-...    A -> B: DELIVERED
A still shows its own sent message: true
M2.4 PASSED — both directions, through the UI
```

Driven by `harness/cdp/drive-chat.mjs`, which touches only the screens a person
touches: Profile to copy a ticket, Add Contact to paste one, the composer to
send. **No `window.__echoit`** — the bridge harness bypasses precisely the layer
this had to prove.

### What was built

| File | Role |
|---|---|
| `src/services/conversation.ts` | Channel id, open, send, history, subscribe |
| `src/context/AppContext.tsx` | Message store, `sendMessage`, per-contact subscriptions and history load |
| `src/screens/AppShell.tsx` | Real send; conversation previews derived from stored messages |
| `src/services/reconnect.ts` | Re-opens each channel alongside re-adding the peer |

`AppShell.handleSendMessage` was twelve lines that called `setConversations` and
nothing else — a composer that showed messages which never left the device. The
list preview is now **derived** from the message store rather than written at
send time, which is exactly how the old code managed to display messages the SDK
never accepted.

### The trap this design is built around

0.4.0's guest-list filter is **fail-closed**. A channel missing its participant
does not error — it sends to nobody and reports success, which is
indistinguishable from the bug the filter was added to fix. So `createChannel`
is called in **three** places — pairing, contact load, and every reconnect sweep
— all idempotent, rather than relying on `sendMessage`'s implicit creation.

### Channel id — and a decision reversed

`dm:${[a, b].sort().join('|')}`. Sorted, so both sides derive the same id with
nothing exchanged.

**I said I would hash it, then didn't.** The reasoning that changed: deriving
`sha256(a|b)` needs the same two did:keys as deriving `a|b`, so guessability is
identical — and message bodies are stored unencrypted anyway (Finding 11), so
anyone who can read the id can already read the conversation. Hashing would have
bought nothing but a false sense of having addressed it. The real fix is an
inbound entitlement check in the SDK so a sender cannot declare its own
membership; recorded rather than worked around.

### A defect in my own Finding 17 fix, found by driving it

Yesterday's fix promoted a contact to bilateral only on an **inbound
connection**. I verified the negative case — a one-sided contact correctly says
"waiting" — and **never verified the positive one.** It does not work: both
sides sat locked at "Waiting for them to connect back" with mutual pairing
complete. The mirror of the original bug — denying a connection that exists
rather than claiming one that does not.

**Why.** Whoever adds second dials into the connection the first side already
opened, so no fresh inbound ever reaches the first side.

Bilateral now accepts three kinds of evidence, because no one of them covers
every flow:

1. **An inbound connection** — they dialled us, which needs our ticket.
2. **A knock waiting when we add them** — the same proof, seen earlier. This was
   being discarded whenever someone completed pairing through Add Contact
   instead of the Accept button.
3. **A message from them** — they cannot send unless they added us.

**Behavioural consequence, and it matters on real devices:** whoever adds
*second* can send immediately; whoever added first has their composer unlocked
by the first incoming message. **On two phones, have the second person send
first.** Sending from the first phone before that looks like a failure and is
not one.

### Verified

| Check | Result |
|---|---|
| `drive-chat.mjs` | **PASSED** — both directions through the UI, sender retains its own message |
| `npm run test:three-peer` | **PASS** — Carol still receives nothing |
| `npm run test:two-peer` | **3/3** |
| `csp-check` | **0 violations, 0 console errors** |
| `typecheck` / `build` / `audit` | clean, **0 vulnerabilities** |

### Two harness properties worth knowing

**Do not run `test:two-peer` while app instances are live.** It read 1/3 with two
Tauri apps running and 3/3 with them closed. Real QUIC, real ports, one machine —
contention, not a regression. Anything else would have been misread as one.

**`drive-chat.mjs` must navigate the receiver before asserting.**
`document.body.innerText` only sees the screen that is showing, so a receiver
left on the Contacts tab reports every message as undelivered. That produced one
false FAIL before it was fixed — a test bug that looked exactly like a product
bug.

### Not built

**§5b's `Staged → Sent → Delivered → Read` ladder.** Messages render with no
status. A send that fails currently fails quietly, which is still better than the
old behaviour of showing everything as sent — but it is not what §5b asks for,
and it is the obvious next piece.

## ✅ SDK 0.4.0 — Finding 19 fixed, M2.4 unblocked (2026-08-23)

**The same test that failed yesterday now passes.** That is the whole claim, and
it is the only kind worth making about a privacy fix.

```
bob's copy of the channel   : 1 message(s) ["private-to-bob-1787473246171"]
carol's copy of the channel : 0 message(s) []

PASS — the conversation stayed between alice and bob.
```

Three real processes, real QUIC. Alice paired with Bob and Carol; Bob and Carol
strangers to each other; Alice and Bob open a channel naming only each other.
Carol receives nothing. Yesterday she received the plaintext.

### What 0.4.0 introduced

`chat.createChannel(channelId, participants)` — and the docblock names it for
what it is: *"The guest list decides who the conversation may be sent to and
synchronised with, so this is an authorization boundary rather than
bookkeeping."*

Both paths from Finding 19 are now filtered, and the second one is the half I
had to be told about:

| Path | 0.3.2 | 0.4.0 |
|---|---|---|
| Envelope `0x02` — `SessionManager.publish` | Fanned out to every paired connected peer, no channel filter | Skips any peer failing `mayReceive(did, channelId)`. **Fail-closed** — an absent hook skips everyone rather than everyone through |
| Sync `0x01` — outbound | `generateAllDocumentMessages` offered every local document | Filtered per peer |
| Sync `0x01` — inbound | `ensureSyncDocument` adopted any docId pushed at it | Mirrored filter: *"adopting one uninvited both stores a conversation this node has no business holding"* |

The inbound mirror matters as much as the outbound filter. Without it a peer can
still **push** a document into someone who should not hold it.

### Harness changes — two, both needed, one not our bug

`test:two-peer` dropped to 1/3 on 0.4.0. Both fixes came from the user, and both
were confirmed here against the published package before being written up.

**1. Pairing no longer implies channel membership.** `addPeer` says "may
connect"; it does not say "may talk on this channel". Without an explicit
`createChannel`, `publish` correctly skips the peer and every send resolves
having reached nobody — the fail-closed behaviour working exactly as designed,
which is why it presents as silence. One line in `harness/peer.mts` took it to
2/3, and the same line was needed in `harness/bridge-peer.mts` and
`src/bridge-harness.ts`.

**2. `connect()` resolves before the accepting side is ready.** It returns when
the **dialler's** handshake completes; the accepting peer is still adopting
sub-streams. A send issued immediately races that and loses.

**This is not a 0.4.0 regression.** It has always been true — the user's own
mesh harness already documents the property and waits for it. The extra work
0.4.0 does at connect time simply widened the window enough to lose the race
reliably rather than occasionally. A latent flake became a deterministic
failure, which is the good outcome: it is now visible.

The wait went into `peer.mts`'s `connect` rather than into each scenario, so
`connected` means *"both ends are ready"* — which is what every caller already
assumed. `drive-bridge.mjs` never needed it because it polls for delivery rather
than asserting once.

Also added a `{cmd:'channel', channelId, participants}` command to `peer.mts`, so
a harness can open a channel with an explicit guest list rather than only the
default one.

### Verified on 0.4.0

| Check | Result |
|---|---|
| `npm run test:three-peer` | **PASS** — Bob 1 message, Carol 0. Finding 19 closed |
| `npm run test:two-peer` | **3/3** |
| `npm run test:bridge` | **3/3** |
| `drive-bridge.mjs` | **`STEP 1 PASSED`**, `relayed=false`, `outbox=0` |
| `csp-check` — bridge build and UI build | **0 violations, 0 console errors** each |
| App boot on 0.4.0 | Clean, no console errors |
| `typecheck` / `build` / `audit` | clean, **0 vulnerabilities** |

### What this unblocks

**M2.4 can now be built.** The channel-per-pair scheme is sound, and the test
proves it under the condition that broke it before — a third contact. The id
`dm:${[a, b].sort().join('|')}` is deterministic on both sides with no
coordination, and both ends call `createChannel` naming the other.

**One thing M2.4 must not forget:** the app's own pairing path
(`AppContext.pairAndConnect`, and `acceptRequest` behind it) has **no**
`createChannel` call yet. Wiring the composer without it produces sends that
reach nobody and report success — the fail-closed path looking exactly like the
bug it replaced. `services/reconnect.ts:101` re-adds peers on every sweep and
will want the same treatment, since `createChannel` is idempotent and only adds
missing participants.

## Three unblocked cleanups (2026-08-22)

Small, and all three were things flagged earlier in the session and left. None
of them needed a decision, so they are done rather than carried.

### 1. Storage failures were silent — `src/services/pairing-store.ts`

Every save and load was wrapped in `} catch { // ignore }`. A failed write meant
the contact list looked saved and was gone after a restart: data loss with no
cause, and nothing anywhere to say it had happened.

Now each reports which store failed. **The name only, never the contents** —
constraint §3.3 rules out anything carrying contacts, and the point is to make
the failure visible, not to log the data. `csp-check.mjs` already collects
console errors, so this class of failure now shows up in tooling that runs on
every UI change.

Found by MACCO's scalability pass; the mechanism was verified by reading the
file rather than taken on trust. Its framing was that this bites at
localStorage's ~5 MB ceiling. That is the smaller half — **a swallowed write is
a bug at ten contacts**, because a failure at any size is invisible.

### 2. A badge claimed a connection that did not exist — `ProfileTab`

```tsx
const isRelayed = Boolean(client?.endpoint?.relayUrl && !client?.endpoint?.directAddresses?.length);
<Badge variant="success" dot>{isRelayed ? "Connected (Relay)" : "Direct connection ready"}</Badge>
```

`isRelayed` is about whether **this device** discovered a direct address for
itself. It says nothing about a connection to anyone. Both branches rendered a
green success badge with a live-status dot, and one of them said **"Connected"**
on a fresh install with zero contacts and nothing connected.

This is Finding 17's shape exactly: asserting a state from a signal that does
not carry it. Renamed to `hasDirectAddress`, and the badge now describes
reachability rather than a connection — `"Ready to connect directly"` when a
direct address exists, `"Ready to connect"` otherwise, with the muted variant so
a capability does not read as a live success.

Deliberately avoids naming the relay. That wording is bound up with Finding 18
and is the user's to set; inventing a term here would pre-empt it.

### 3. A desktop app called the machine a phone — `ProfileTab`

The at-rest disclosure said *"stored locally on this phone"* and *"access to
your phone"*, on a build that ships to Windows. Now "this device".

### 4. 388 KB of logo shipped for nothing

`public/logo.png` and `src/assets/logo.png` are **byte-identical**
(`df98b5a5…`). Only the second is referenced — `Logo.tsx` imports it, so Vite
hashes and bundles it. The `public/` copy is served verbatim and **nothing links
to it**: `index.html` has no favicon tag, `tauri.conf.json` takes its window
icon from `src-tauri/icons/`, and a repo-wide grep finds no other reference.

Deleted. `dist/logo.png` no longer ships, the bundle drops 388 KB, and nothing
visual changed — verified below.

**Correcting the 2026-08-21 entry**, which lists *"**Favicon**: Window / Tab
icon in `index.html`"* as a delivered touchpoint. There is no favicon tag in
`index.html` and there never was. That entry has now had three claims fail
checking: it broke `typecheck`, it was appended to the bottom of a
newest-first log, and this. Worth remembering as the shape of an entry written
without running anything.

**Still open, deliberately not done:** the remaining copy is **1000×1000** and
is displayed at 36, 28, 48 and 80 px. Resizing it would save most of the
remaining 388 KB, but it is a brand asset and how it should be resampled — or
whether it wants a 2x variant — is a design call, not a cleanup.

### Verified by running

| Check | Result |
|---|---|
| Logo after deletion | Renders at all four sizes (36/28/48/80 px) from `logo-BP5QIxCf.png`, **0 broken images, 0 console errors** |
| Profile on a fresh install, zero contacts | **"Ready to connect directly"** — `rgb(92,158,123)` on `rgb(28,40,33)`, no "Connected" claim |
| At-rest copy | "stored locally on **this device**" |
| Console errors | **0** — the new error paths correctly did not fire |
| `csp-check` | **0 violations, 0 console errors** |
| `npm run test:two-peer` | **3/3** |
| `typecheck` / `build` / `audit` | clean, **0 vulnerabilities** |

## Finding 17 fixed, §5b composer gate reached, updater built (2026-08-22)

Three items. The first two turned out to be one fix.

### Finding 17 — a one-sided contact claimed "Connected directly"

**Root cause.** `client.js:248` emits
`paired: this.peers.getPeer(peerDid)?.paired === true` — a **purely local**
flag meaning *we* added *them*. `AppContext` read it as mutual and promoted the
contact to `bilateral_connected` the moment our own dial succeeded.

**The fix is the direction, not the flag.** Dialling someone requires their
ticket, and `client.connect()` self-pairs from a ticket carrying an encryption
key — so an **inbound** connection is proof the other side added us. An
outbound one proves only that we can reach them, which is precisely §5 State 1.

| Path | Before | After |
|---|---|---|
| We dial them | `bilateral_connected` | `unilateral_waiting` — correct |
| They dial us | `bilateral_connected` | `bilateral_connected` — correct, and now earned |
| We accept a knock | `unilateral_waiting` | `bilateral_connected` — the knock **is** the evidence |

That last row needed `markBilateral()`, kept separate from `pairAndConnect`
because the two answer different questions: one knows we added them, the other
knows they added us. Only the second makes a conversation deliverable.

The knock branch also had to gain `!event.paired`. Once the branch above tests
direction, a paired peer we dialled would otherwise fall through and be filed as
a stranger knocking on our own door.

### §5b — the composer gate was already built, just unreachable

`ChatView` derives everything from `pairingState` and already disabled the
composer, refused to send, and showed "Pairing required". None of it could ever
run, because the state was always promoted to bilateral. **Fixing Finding 17
delivered §5b's composer requirement with no new code.**

The State 1 microcopy was already verbatim from §5 too. The words were right;
the state was wrong.

### Verified through the real UI, against a real one-sided pairing

Instance B added instance A's 554-char ticket through Add Contact. A never added
B back.

| Check | Result |
|---|---|
| B's contact row | *"Waiting for them"*, *"Waiting for Instance A to connect back."*, *"You've added Instance A, but they haven't added you yet…"* — §5 State 1, verbatim |
| B's composer | `disabled: true`, placeholder *"Composer paused until connection is complete"* |
| B's send + attach buttons | `disabled: true` |
| B's banner | *"Pairing required"* · *"Messages will be delivered once both sides complete connection."* |
| A's requests dot | Still `rgb(224,133,96)`, 8px, `aria-label="Contacts — new requests"` — no regression |

### Updater — Q21, both tracks

| | Windows | Android |
|---|---|---|
| Check | `updates::check_for_update` (Rust) | same command, same release |
| Install | `tauri-plugin-updater`, in place | Releases page via `opener`; reinstall the APK |

**The check is one Rust command on every platform**, so the two tracks cannot
disagree about what the latest version is.

- `src-tauri/src/updates.rs` — the command, plus `is_newer`, which compares
  numerically. Lexically **"0.10.0" sorts before "0.9.0"**, so a tester on 0.9.0
  would never be told about 0.10.0. Two unit tests cover it; `cargo test --lib`
  is **4 passed**.
- `src/services/updates.ts` — opt-out (default on, §4.3), and a lazy import of
  the updater plugin so Android's bundle does not carry a call to a plugin that
  is not registered there.
- `SettingsTab` — an UPDATES section with the toggle, version, and a manual
  check.

**The CSP was not touched.** `connect-src 'self' ipc: http://ipc.localhost` is
byte-identical, asserted in the config patch itself. The request lives in Rust
precisely so Q16 stays closed. `reqwest` was already in the tree via iroh, so
declaring it added an honest graph edge and no new compilation.

**A failed check is never shown as success.** `UpdateStatus.error` is separate
from `available: false`, because "we could not tell" and "you are up to date"
are different things and only one of them leaves a tester stranded.

#### Verified by running

Clicked **Check now** in the real app. The command made a real HTTPS request
from Rust and returned:

```
{"available":false,"current":"0.1.0","latest":null,
 "error":"release feed returned 404 Not Found"}
```

The 404 is correct — `EchoIt-CB` has no published releases yet; `curl` returns
404 too. So the path works end to end and reported the failure honestly rather
than claiming the app was current.

*(First draft of the failure copy said "you may be offline". It does not know
that — a 404 means no release exists. Now: "Couldn't check for updates just now.
Your app still works — try again later.")*

#### The signing key — a second unrecoverable secret

`src-tauri/echoit-updater.key` (minisign, generated 2026-08-22) and
`src-tauri/updater.properties` hold its password. Both gitignored; the **public**
half is committed in `tauri.conf.json`.

**Lose either and no existing install can ever be updated again.** This now
joins the release keystore as something that exists in exactly one place and
must be backed up off-machine.

#### One deliberate copy omission

§4.3 specifies the Settings copy verbatim, including *"It's the only time the
app talks to a server."* **That sentence is false** — Finding 18. Rule #4 makes
the approved wording the user's to set, so the clause is **omitted** rather than
rewritten. Everything shipped is accurate; §4.3 still needs amending.

### Regression — all green

| Check | Result |
|---|---|
| `npm run test:two-peer` | **3/3** |
| Bridge harness | **`STEP 1 PASSED`**, `relayed=false`, `outbox=0` |
| `csp-check` with the updater UI | **0 violations, 0 console errors** |
| `cargo test --lib` | **4 passed** |
| `npm run typecheck` / `build` / `audit` | clean, **0 vulnerabilities** |

### Not done

- **M2.4 remains blocked** by Finding 19. Nothing here unblocks it.
- **§5b's `Staged → Sent → Delivered → Read` ladder** is not built — it needs
  messages to exist, which is M2.4.
- **The desktop in-place update path has never been exercised**, because there
  is no published release to update *to*. `installInPlace()` falls back to the
  Releases page when the plugin finds nothing, so the button always does
  something — but the actual download-and-replace is unproven until a second
  release exists. Say so rather than implying it works.

## Requests badge → an unnumbered dot (2026-08-21)

### The contradiction was not the one recorded

`START_HERE.md` had it as *"`PRODUCT.md` §5 says knocks must produce **no badge**.
Either drop the badge or amend the rule."* Read directly, §5 says neither of
those things.

§5 State 2 **specifies an indicator**: *"Clay dot (`--color-primary`) on the
Contacts tab."* What it forbids is anything that **pushes** — *"no notification,
no push, no badge on the app icon"*, and *"Nothing is ever pushed — no
notification, no banner, no badge."* Separately, `DESIGN.md` §1 designs unread
**counts** on Chats in as many words.

So the code was not wrong to show something. It was wrong to show a **number**
where the spec asks for a **dot**, and only on Contacts. Both documents were
already consistent; the summary of them was not.

### What was built

| File | Change |
|---|---|
| `src/components/navigation/SidebarNavRail.tsx` | Tab descriptor gains `dot?: boolean` beside `badge?: number`. Contacts → `dot: pendingRequestsCount > 0`; Chats keeps `badge: unreadChatsCount` |
| `src/components/navigation/BottomNav.tsx` | Same, so the two navs cannot drift |

The dot is 8×8px, `--color-primary`, `--radius-full`. Callers are unchanged —
both components still take `pendingRequestsCount` and derive the dot themselves.

**The accessibility handling differs between the two navs, deliberately.** The
rail's buttons carry `aria-label={tab.label}`, which overrides their contents, so
there the dot is `aria-hidden` and the button's label becomes
`"Contacts — new requests"`. `BottomNav`'s buttons have no `aria-label` and take
their name from the visible text span, so there the dot carries
`role="img" aria-label="new requests"` and joins the name. Writing the same code
in both would have left one of them silent.

Neither announces a count. Telling a screen-reader user "3 requests" while
withholding that number visually would reintroduce exactly what §5 removes.

### Design decision — why a dot rather than a count

A number asks to be cleared. §5's request rules are *"Knocks wait in a list and
never interrupt you"* and *"You look when you feel like looking"*; a count is an
interruption wearing a small circle.

Rejected, with reasons:

- **Keep the count, amend §5.** The silence is the safety feature — §5 argues
  this at length and it is a product promise, not a preference.
- **Drop the indicator entirely.** §5 explicitly asks for a dot, and a knock
  nobody notices is a pairing failure that presents as the network being down.
- **Reuse `<Badge>`.** It is an inline pill with padding and a background that
  requires children — wrong shape for an 8px overlay on a 44px icon button.

The section header inside the Contacts tab still reads **"1 pending"**. Kept on
purpose: it is only visible once you have chosen to look, which is precisely the
behaviour §5 describes.

### Verified by running — against a real knock, not a fixture

Two app instances; the second added the first's 558-char ticket through the
**Add Contact dialog**, and the first had never added it back. That is a genuine
State 2 knock, produced by the app rather than seeded into it.

| Check | Result |
|---|---|
| Nav dot on the knocked instance | 8×8px, `border-radius: 9999px`, `rgb(224, 133, 96)` — exactly `--color-primary` (`#E08560`, dark theme) |
| Its `aria-label` | `"Contacts — new requests"` — **no number** |
| Chats button, same moment | No badge span rendered at all |
| Requests list | *"Device ending in ...AP2v5R wants to connect with you"*, with Accept / Ignore / Block — §5 State 2 stranger copy, name-less as specified |
| CSP | **0 violations, 0 console errors** |
| Bridge harness after the change | **`STEP 1 PASSED`**, `relayed=false`, `outbox=0` both ends |
| `npm run test:two-peer` | **3/3**, run twice this session |
| `npm run typecheck` / `npm audit` | Clean, **0 vulnerabilities** |

`/echoit-guardrails` not run: this change touches no storage, transport, logging
or config, and adds no dependency.

### Deliberately left undone

- **The Chats count branch is unexercised and cannot be exercised today.**
  `unreadCount` is hardcoded `0` at `AppShell.tsx:38` and `:93`, so no count can
  render. The branch is unchanged from before this work, but nothing here proves
  it draws correctly. `ChatsTab.tsx:334` has a per-row count from the same
  hardcoded source and the same status.
- **Finding 17 is not fixed** — a separate defect in the same screen, found
  while producing the knock.

## Reconnect on launch and resume (2026-08-20)

**The gap that made background delivery unmeasurable.** MACCO found it; verified
by hand: `client.connect()` was called in exactly **one** place — inside pairing
— and never again.

That matters because 0.3.2's outbox flushes from `drainAfterReconnect()`, which
fires when a connection is established. Everything else already worked: queued
messages persist across process death and rehydrate at boot. But **nothing ever
created the reconnection the flush was waiting for**, so messages sat queued
even with both devices awake and reachable.

Also confirmed absent: any lifecycle handling at all. No `visibilitychange`,
`pagehide`, `freeze` or `resume` listener in `src/`; `MainActivity.kt` overrides
only `onCreate`; the manifest declares **only `INTERNET`** — no `<service>`, no
`FOREGROUND_SERVICE`, no `WAKE_LOCK`.

### What was built

`src/services/reconnect.ts` — `reconnectKnownContacts()`, called from
`AppContext` on launch and on `visibilitychange` / `focus`.

- **Refreshes addresses once per sweep, before dialling.** A stored ticket
  carries the addresses a peer had when it was made; those go stale and a dial
  to a dead address fails looking like the network being down.
- **30-second per-peer cooldown.** Resume fires far more often than expected —
  every task-switch, every notification shade — and without it each one would
  churn healthy connections.
- **Failures swallowed per contact.** A peer who is genuinely offline *should*
  fail to dial; that is the normal case, not an app error, and it must not stop
  the other contacts being tried.
- Skips blocked peers, self, and contacts with no stored ticket.

### Verified end to end through the real UI

Two app instances, paired by pasting a real 558-char ticket (relay + 4 direct
addresses) into the Add Contact dialog — not the harness.

| Event | Result |
|---|---|
| Reload (relaunch) | `attempted:1 connected:1` — **the re-dial works** |
| Resume (`visibilitychange`) | `attempted:0 skipped:1` — cooldown suppresses the redundant dial |
| Bridge harness | `STEP 1 PASSED`, `outbox=0` |

### A bug found in my own first version

The first attempt logged `attempted:0` on launch. Contacts load from storage in
a **separate effect keyed on `did`**, which resolves *after* the client is
ready — so the sweep ran against an empty list and dialled nobody. The failure
looked exactly like having no contacts at all.

Fixed by adding `contacts.length` to the effect's dependencies. Worth recording
because the symptom was silence, and silence is indistinguishable from working.

### Harness change

`status()` now reports **`outbox=N`**. Without it, "queued and will arrive" and
"vanished" are indistinguishable from outside — the exact ambiguity that left
the 0.3.0 background run inconclusive. `client.outboxSize` already existed;
nothing else needed adding.

## ✅ Finding 16 — silent message loss — **FIXED in SDK 0.3.2** (2026-08-20)

**Not a background-delivery bug. A foreground correctness bug**, found while
asking MACCO about background delivery and then verifying by hand because its
citation gate flagged its own output as mis-cited.

0.3.1 fixed `detachConnection` — liveness is now derived from
`connection.state`. That part works. But a second path with the same
consequence was not fixed: **the sender is told a message was delivered when it
was sent to nobody.**

### The chain, every link read directly

| Step | Code | Behaviour |
|---|---|---|
| 1 | `client.js:552` | `isOnline: () => this.online && this.peers.connectedCount > 0` — a **global** count |
| 2 | `peer-registry.js:22` | `connectedCount` counts **every** live peer, `paired` or not |
| 3 | `session-manager.js:90` | `publish()` iterates **`listPairedConnected()`** — paired peers only |
| 4 | `session-manager.js:101` | `await Promise.all(sends)` — **an empty array resolves**. `publish()` cannot fail by sending to nobody |
| 5 | `chat-service.js:108` | `if (isOnline()) { try { await publish(); published = true } catch {…} }` then `if (!published) enqueue` |

Because step 4 never throws, step 5 sets `published = true` and **skips the
outbox entirely**.

### Two ways an ordinary user hits this

1. **More than one contact.** Paired with A and B; A is connected, B is not.
   `isOnline()` is true because of A. `publish()` sends to A. Nothing is queued
   for B. The message to B is gone, reported as sent.
2. **A stranger knocks.** An unpaired peer completing a handshake raises
   `connectedCount` — step 2 does not filter on `paired`. With your only real
   contact offline, `isOnline()` is true, `listPairedConnected()` is empty,
   `publish()` resolves having sent nothing, and your message is dropped.

**Path 2 interacts directly with the requests feature just specified** (§5,
M2.3.5): strangers knocking is a designed, expected event. Someone can cause
your outgoing messages to vanish by dialling you.

### Why this was not caught

Every test to date used **exactly one paired peer**. With a single contact the
logic is sound — the peer is either connected (`publish` sends to it) or not
(`connectedCount` is 0, so it queues). The bug needs a second peer, or a
stranger, to appear. Beta testers will have both.

### Resolved in 0.3.2 — verified link by link

All three links re-read against the installed 0.3.2, not taken on trust:

| Link | 0.3.1 | 0.3.2 |
|---|---|---|
| `isOnline()` | `peers.connectedCount > 0` — every live peer, paired or not | **`peers.listPairedConnected().length > 0`** — the same set `publish()` sends to |
| `publish()` | `await Promise.all(sends)` — an empty fan-out resolved like a successful one | **`return sends.length`** |
| `chat-service` | `published = true` on any resolve | **`published = (await deps.publish(payload)) > 0`** — zero recipients is not delivery, so it queues |

The upstream comments name the exact failure: *"a node whose only live
connection is an unpaired stranger would otherwise mark the message sent and
never queue it."*

### Correction to the original finding

**Scenario 1 as written was wrong.** I claimed that with contacts A (online) and
B (offline), the message to B was lost. It was not: `publish()` is a broadcast to
all paired-connected peers with no per-recipient targeting, and a peer that was
away catches up through `beginSync(connection)` on reconnect — CRDT document
merge, not the outbox. The outbox is for when *nobody* received it.

**Scenario 2 — the stranger — was real**, and is what 0.3.2 fixes. SDK-6 is
closed by it.

### Regression on 0.3.2

| Check | Result |
|---|---|
| `npm run test:two-peer` | **3/3** — including "held while offline, then delivered on reconnect (flushed=1)" |
| Bridge harness (two app instances) | `STEP 1 PASSED`, direct |
| typecheck / build / `npm audit` | clean, 0 vulnerabilities |

*Unrelated breakage the upgrade surfaced:* `src/services/identity.ts` imported
`@scure/bip39/wordlists/english.js`, but that package's exports map has no `.js`
form. The reinstall normalised `node_modules` and it began failing. Import
corrected — nothing to do with 0.3.2 itself.

### Upstream request — SDK-6 *(delivered in 0.3.2)*

`isOnline()` must describe the same set `publish()` sends to. Either:

- make `publish()` report what it actually delivered and have `ChatService`
  queue when that set is empty or incomplete; or
- make liveness per-recipient, so the decision is "is *this* peer reachable"
  rather than "is anyone reachable".

`connectedCount` should also exclude unpaired peers, or be named for what it
counts — it is currently used as a proxy for "can we deliver", which it is not.

### Until it lands

The honest position for beta is that this is **not fixed by measurement** — no
amount of phone testing makes it safe. Options: keep beta to one contact per
tester (unrealistic), patch the app side by checking a specific peer's
connection before send, or wait for the upstream fix.

**This outranks the background-delivery retest.** That test now has a known
confound: with a stranger connected or a second contact offline, loss is
expected regardless of what backgrounding does.

## Android release keystore generated (2026-08-20)

The item with a real deadline attached, done before the first APK ships.

**Why it could not wait:** Android refuses an update signed by a different key.
Change the key later and every tester must uninstall — and uninstall wipes the
app sandbox, including the SharedPreferences blob the Android keyring store uses
and the local message store. There is no server copy (§3.1). The recovery phrase
restores identity, **not history**. Generating this late would have cost every
beta tester their conversations.

| | |
|---|---|
| Keystore | `src-tauri/echoit-release.jks` — RSA 4096, valid to **Jan 2054** |
| Alias | `echoit` · DN `CN=EchoIt, O=EchoIt` |
| Secrets | `src-tauri/keystore.properties` |
| **SHA-256 fingerprint** | `2F:F2:E8:96:68:F3:17:48:CC:2B:11:06:C8:17:4A:B6:2F:01:7B:BF:58:A5:19:49:24:2B:E3:7B:30:E1:99:BD` |

The fingerprint is public and recorded here deliberately: any future release can
be checked against it with `apksigner verify --print-certs`. A mismatch means the
build would strand every existing install.

**Both files are gitignored** (`*.jks`, `keystore.properties`) and must be backed
up off this machine. They exist in exactly one place today.

### Solving the durability problem

MACCO flagged that `src-tauri/gen/` is gitignored and regenerated by
`tauri android init`, so any Gradle signing edit is temporary by construction —
it would vanish silently and the next release would be debug-signed.

Fix: **`scripts/apply-android-signing.mjs`**, wired as `npm run android:sign`.
Idempotent, committed, and it refuses to run with a clear message if
`keystore.properties` is missing rather than letting a debug-signed release
through. The generated project stays disposable; the script is the durable half.

Run it after any `android init` and before any release build.

### Verified, not assumed

Built a real release APK (`tauri android build --apk --target aarch64`, 36 MB)
and checked who signed it:

```
Signer #1 certificate DN: CN=EchoIt, O=EchoIt
Signer #1 SHA-256: 2ff2e89668f31748cc2b1106c8174ab62f017bbf58a51949242be37b30e199bd
```

Identical to the keystore's own fingerprint. Configuration proven by output, not
by reading the gradle file.

*(One snag worth recording: the first script version matched the release
buildType with a `'
'` literal, which silently failed against the generated
file's CRLF endings and reported "could not find the release buildType". Now a
`
?
` regex.)*

## Navigation shell built + audited — M2.1.3 / M2.1.4 (2026-08-19)

Second agent brief delivered. Audited by running it, not reading it.

### Verified

| Check | Result |
|---|---|
| **Resize across 840px** (real OS window, not viewport emulation) | Crossover exactly between 844 and 824. Never both nav types, never neither, no horizontal overflow, returns correctly |
| Chat on **wide** | Opens in the right pane, sidebar rail **stays** — correct per §2C |
| Chat on **narrow** | Full height, bottom tabs hide — correct per §2B |
| Escape | Closes the conversation, rail intact |
| Four tabs | All reachable, real content |
| CSP | 0 violations, 0 console errors |
| Bridge harness | `STEP 1 PASSED`, still direct |
| `bootStarted` guard, deferred reset, keychain contract | All three survived |
| Token duplication / platform sniffing | None. `useBreakpoint` is `matchMedia` on width only |

No new dependencies — the agent chose against a router, correctly for four
destinations and one detail view.

### Fixed during the audit

1. **Security copy overstated protection, in 7 places.** "Hardware keychain",
   "hardware security manager", "database key". **"Hardware" is false on
   Windows** — Credential Manager decrypts transparently for the signed-in user
   and is not hardware-backed. Now: "Device key storage", naming Windows
   Credential Manager / Android Keystore plainly, **plus the limitation that was
   missing entirely** — it protects against someone taking the device, not
   against software already running as you.

   Three of these were in `App.tsx` and `AppContext.tsx` and had survived the
   *previous* audit, where the same wording was flagged and not fixed.
2. `ChatView` tooltip said "Direct end-to-end encrypted connection" → "Messages
   go straight from your device to theirs".
3. **`HomeScreen.tsx` deleted** — dead after its contents moved to Profile and
   Settings.

### Testability gap worth remembering

`INITIAL_CONVERSATIONS` and `INITIAL_CONTACTS` are empty — correct, no fake
data — but that makes **`ChatView` unreachable**, so M2.1.4 and the keyboard
shortcuts could not be exercised as delivered. Verified by temporarily seeding a
conversation and rebuilding. The agent should have reported this rather than
leaving it implicit.

*(A first seed of mine omitted the required `peerDid` and silenced it with an
`as` cast, producing a blank-screen crash that looked like an app bug. The stub
rule applies to audit fixtures too.)*

## Desktop layout specified — `DESIGN.md` §2C (2026-08-19)

`DESIGN.md` §2A/§2B describe a phone; EchoIt ships to Windows too, and the doc
was silent on it. Added §2C.

**The call: switch on window width, never on operating system.** A desktop window
dragged narrow gets the phone layout, and that is correct rather than a fallback.
Branching on platform breaks the moment someone resizes, and a touch laptop is
neither. Breakpoint **840px**.

The difference is *modality*, not furniture: narrow is modal (one place at a
time, a chat replaces the list); wide is simultaneous (list and conversation both
present, a chat replaces nothing). Same components either way — only the shell
composes them differently.

§2C also covers the four things phones do not have: keyboard shortcuts, hover,
density, and window chrome (native title bar for beta).

**Scope note:** the shell is built responsive *from the start*, deliberately. The
shell is precisely the part that differs between the two sizes, so building it
mobile-only means building it twice. Responsive is also a superset — if desktop
is later dropped, nothing is wasted.

Next brief written to `.agents/UI_AGENT_PROMPT_2.md` (M2.1.3 + M2.1.4).

## Design docs reconciled (2026-08-19)

`DESIGN.md` was rewritten by hand and gained a screen architecture the code and
the other docs did not know about. Swept every file; five real discrepancies.

| # | Discrepancy | Resolution |
|---|---|---|
| 1 | `DESIGN.md` §2B delivery states were `Sending… → Sent → Delivered`, contradicting `PRODUCT.md` §5b (`Staged → Sent → Delivered → Read`) | **§5b wins** — Messenger-style avatar ladder kept, by decision. `DESIGN.md` now points at §5b rather than restating it, since restating is what let it drift |
| 2 | Four of eight contrast figures were wrong, and the `--color-primary` row quoted the *button* pairing under a column headed "on `--color-bg`" | Recomputed all eight from the hex values. **Nothing failed its threshold** — the numbers were imprecise, not the palette |
| 3 | `PRODUCT.md` §5 State 1 said outbox shows "Paused" or "Staged"; "Paused" is defined nowhere | Unified on **`Staged`** |
| 4 | `PRODUCT.md` §5 State 2 still specified a "soft blue dot, notification banner" — contradicting the settled rule that nothing ever notifies, and naming a colour the palette does not contain | Clay dot + inline banner, **no notification**. Recorded that adding a cool accent is a system decision, not something to improvise per-screen |
| 5 | Root `DESIGN.md`/`PRODUCT.md` duplicates had drifted from `design/` | Re-synced. **Still duplicated** — the drift will recur; deleting the root copies is the durable fix and is waiting on a decision |

### Also corrected

- **`DESIGN.md` no longer documents spacing, radii, elevation or motion** — those
  sections were dropped in the rewrite. Added §6 pointing at `tokens.css` as the
  sole source, so the omission reads as deliberate rather than lost.
- **`UI_AGENT_PROMPT.md` marked historical.** Three of its statements are now
  false (tokens imported, scaffold removed, token count), and it predates the
  Home shell.
- Recorded an accessibility edge the tables missed: `--color-success` on
  `--color-surface` in dark is **4.95:1** — fine for an 8px dot, not for text.

### What this cost in scope

**M2.1 reopened.** `DESIGN.md` §2A adds a 4-tab bottom bar (Chats · Contacts ·
Settings · Profile) that exists **only** on Home, and §2B a full-height chat view
that hides it. The shell currently has no navigation at all — when M2.1.1 was
marked complete I noted it was "not routing in the react-router sense, revisit
when there are screens to route between". This is that moment.

New: **M2.1.3** (Home tab bar) and **M2.1.4** (full-height chat). Both land
**before** 2.3, because Contacts is where the requests list lives.

## Pairing & anti-spam settled (2026-08-19) — Q17/Q18 closed

### The finding that shaped everything

`getTicket()` takes no arguments, and `transportKey` is HKDF-derived from the
identity key. So **there is exactly one ticket per identity, permanently, with no
expiry and no revocation.** Anyone who ever receives it can dial forever, and the
only way to change it is to abandon the identity and every pairing with it.

The compensating property is strong: `transportKey` is a 32-byte Ed25519 public
key. It cannot be guessed, enumerated, or derived from the `did:key`. There is no
equivalent of harvesting phone numbers.

**Therefore mass spam is structurally impossible, and the real threat is targeted
— one person who has your ticket and will not stop.** Every defence below follows
from that, and none of them can be enforced at the protocol layer; they all live
on the recipient's device, which is the only place we control.

### Decisions

- **Pairing screen: Option B, "Two Steps"** from the lab — an explicit checklist
  of who has done what. The half-paired state is the dangerous one, and B is the
  only option that cannot be skim-read wrong.
- **Requests are three rules, not a system.** A stranger can only knock; knocks
  wait in a list; nothing ever notifies. Accept, Ignore, or Block — all silent.
- **Silence is the safety feature.** Any reply confirms the address is live and a
  person saw it, which is what someone persistent is fishing for. A "try again
  later" rule is also unenforceable without a server, and announcing one would
  breach §4.2.
- **Deliberately dropped:** invite-correlation windows, notification throttling,
  timed cooldowns, strict mode. All existed to decide *whether to notify* — and
  nothing notifies, so none of them earned their keep.
- **Requests carry no content.** `PeerConnectedEvent` is `peerDid` + `paired`;
  unpaired peers' messages are dropped by the protocol. Names arrive out of band
  in the invite, as unverified claims.
- **Read receipts** designed in `PRODUCT.md` §5b for later: Staged → Sent →
  Delivered (desaturated avatar) → Read (full colour). **Blocked on a profile
  layer that does not exist**, now tracked as M4.3.0.

### Upstream request worth filing

**Rotatable or per-contact tickets.** This is the single most valuable anti-abuse
primitive the protocol could offer and we cannot build it ourselves. Today a
leaked ticket is permanent. With scoped tickets, a leak expires on its own and
correlation becomes cryptographic rather than a guess about timing.

## UI: app shell + onboarding (2026-08-19)

Built by a separate agent to `.agents/UI_AGENT_PROMPT.md`, then audited by
running it rather than reading it. Scope was deliberately fenced to the shell
and onboarding; chat, pairing, and settings were left out because they depend on
decisions still parked (Q17/Q18).

### What exists

| Area | Files |
|---|---|
| Shell + client lifecycle | `src/App.tsx`, `src/context/AppContext.tsx` |
| Onboarding | `src/screens/OnboardingScreen.tsx` (intro → phrase → 3-word verify → restore) |
| Home | `src/screens/HomeScreen.tsx` |
| Components | `src/components/ui/` — Button, Card, Input, Modal, AlertBanner, Badge, Icons |
| Identity | `src/services/identity.ts` — BIP-39, key derivation |
| Reset | `src/services/pending-reset.ts` |
| Styles | `src/index.css` → `@import "../design/tokens.css"` |
| Fonts | `public/fonts/*.woff2` — Literata, Geist, JetBrains Mono, latin-subset, 231 KB |

**M2.2.2 is now complete.** The derivation half landed here: the storage key is
derived from the recovery phrase (BIP-39 seed with the domain-separating
passphrase `echoit:storage-key:v1`, first 32 bytes, base64) and passed to
`DicsussionClient.init()`. The keychain caches it.

### Verified by running

| Check | Result |
|---|---|
| `npm run typecheck` / `build` / `npm audit` | clean · clean · **0 vulnerabilities** |
| `npm run dev` **and** built app | both run — no dev/build divergence |
| CSP violations in the real UI | **0**, and 0 console errors |
| Onboarding end to end (CDP-driven) | intro → 12 words → 3-word verify → live client → reload unlocks |
| Reset → fresh onboarding | database erased, new identity, clean state |
| Bridge harness | **STEP 1 PASSED**, still direct |
| Keychain self-check | **PASSED** |

### Audit — 10 defects found, all fixed

Nine were fixed on the first pass. Recorded because the reasoning matters more
than the diffs:

- **Two clients per launch.** The boot effect was unguarded under StrictMode, so
  `createEchoItClient` ran twice over one IndexedDB and called `iroh_start`
  twice — and `iroh_start` *replaces* the endpoint, leaving the first client's
  transport dead but its listeners alive. The pre-UI `App.tsx` had a guard with
  a comment naming this exact failure; it was lost in the rewrite. Fixed with a
  `bootStarted` ref. **Measured, not inferred** — counted via injected logging.
- **Reset did not reset.** See the section below; it took two passes.
- **Four copy defects**, all now fixed: "Direct P2P Ready" and "(DID)" (banned
  jargon), "Initializing encrypted database and peer transport" (banned *and*
  false — it contradicted the app's own disclosure banner), and an invented
  reassurance that secrets fall back to "local database memory" when no keychain
  exists. There is no such fallback, by design.
- **36px touch targets** on icon-only controls, below the 44px floor.
- **Design tokens copied instead of imported**, creating a second source of
  truth. Now `@import`ed; `design/tokens.css` is authoritative again.
- **`window.confirm`** for destructive actions — replaced with an in-app modal,
  which also removed an unverified Android risk (`onJsConfirm` support in the
  wry chrome client was never confirmed).
- Scaffold leftovers and the `Tauri + React + Typescript` window title.

### The reset bug, and why it needed two attempts

Worth keeping, because the second attempt looked correct and was not.

**First state:** `resetApp` cleared the keychain key and closed the transport.
It never touched the database. The confirm text promised otherwise.

**Second state:** a `deleteDatabase` call was added — but nothing closes the
SDK's IndexedDB connection, and the SDK exposes no way to (only
`disconnect()`, which is transport). So the request fired `onblocked`, and the
handler resolved as *success*:

```ts
req.onblocked = () => {
  // If blocked by closing connections, proceed
  resolve();
};
```

`onblocked` means the database is still there. Measured:
`[AUDIT] deleteDatabase -> ONBLOCKED` and `databases after: ["echoit-db"]`.
The comment made it read as deliberate, which is what made it easy to miss.

**Current state — `src/services/pending-reset.ts`.** The erase cannot happen
in-place while the page holds the connection, so the reset records its intent in
`localStorage`, reloads, and erases on the way back up in `main.tsx` **before
React mounts** — nothing is holding the database at that point. `onblocked` is
now treated as failure, the flag survives a failed erase so the next launch
retries, and `main.tsx` logs loudly rather than swallowing it.

Verified: `databases after: []`, flag cleared, fresh onboarding clean.

**The general lesson, third time in this project:** a stub or fallback may
return a value only when that value is one the caller is designed to receive.
`resolve()` on `onblocked` is the same mistake as the `resolveArtifacts()`
regression — reporting success for something that did not happen.

### Known-good but unfinished

- `keychainAvailable` is computed and exposed on the context but consumed by
  nothing. A build with no keychain backend falls through to the generic error
  screen with no specific explanation.
- Loading copy still reads *"Checking local hardware keychain for your
  encryption key"* — engineer-speak, and "hardware" is inaccurate on Windows,
  where Credential Manager is not hardware-backed. Error heading is
  *"Initialization Error"*.
- Bundle is **1.1 MB (594 KB gzipped)**, past Vite's warning threshold. Not yet
  a problem; worth watching before it ships to phones.
- **None of this has run on Android.** Add it to the phone-session batch.

## Keychain landed (2026-08-18) — M2.2.2, back half

The storage layer for the at-rest key. **Not** the whole of M2.2.2: deriving the
key from the recovery phrase and handing it to `DicsussionClient.init()` is
still open, and belongs with onboarding.

**Approach: `keyring-core` + per-platform stores**, not the `keyring` aggregator
crate — its own docs say applications "should not be linking to this library at
all" and should link `keyring-core` plus the stores they want. That also keeps
unused backends out of the build.

| Crate | Version | Why it's trustworthy |
|---|---|---|
| `keyring-core` | 1.x | `keyring` itself is 20.8M downloads, released 1 Aug 2026 |
| `windows-native-keyring-store` | 1.1 | 900K downloads, MIT/Apache-2.0 |
| `android-native-keyring-store` | 1.0 | 125K downloads, same org, MIT/Apache-2.0 |

Rejected: **`tauri-plugin-keyring`**. Two unrelated projects share the name; the
one that actually claims Android has **no LICENSE file**, which makes it legally
unusable regardless of quality. It is also just a wrapper around the three
crates above, so it buys nothing.

### Files

- `src-tauri/src/keychain.rs` — four commands: `keychain_set`, `keychain_get`,
  `keychain_delete`, `keychain_available`
- `src/keychain.ts` — typed webview wrapper, exports `STORAGE_KEY_ACCOUNT`
- `src/keychain-selfcheck.ts` — runs inside the app, published on
  `window.__echoitKeychain`. Deliberately a **separate global**: `window.__echoit`
  is a contract the CDP drivers read field-by-field and must not gain surprises.

### Verified

| Check | Result |
|---|---|
| `cargo check` (Windows) | clean |
| `cargo check --target aarch64-linux-android` | clean, built against the **API-24 sysroot** |
| `cargo test --lib keychain` | 2/2 against the **real** Credential Manager — round-trip, overwrite, delete, delete-when-absent |
| Self-check over IPC | `{"status":"PASSED","available":true}` |
| Bridge harness regression | `STEP 1 PASSED`, still direct |

The Rust test is not mocked on purpose: the entire value of the module is
whether the OS store behaves, and a mock would pass on a machine where the real
one is broken. It cleans up after itself.

### Design decisions worth not re-litigating

- **`get` returns `Ok(None)` for a missing entry, `Err` only for a real fault.**
  First launch is the common path, not an error. A caller that cannot tell the
  two apart will either re-derive over good data or loop on a genuine failure.
- **`delete` of an absent entry succeeds**, so "make sure this is gone" needs no
  existence check first.
- **No fallback store.** A plaintext or in-memory stand-in would make a build
  that cannot protect the key look exactly like one that can.
- **The keychain is a cache, not the source of truth.** The key comes from the
  recovery phrase; losing the keychain costs a re-derivation, not history.

### Open

- **Runtime on Android is unproven.** It compiles for `aarch64` and the upstream
  README names Tauri as providing the `ndk-context` init it needs, but no device
  has run it. The self-check is already wired into the bridge harness, so the
  next phone session tests it for free — batch it with the 0.3.1
  background-delivery retest and the Android CSP check.
- **Honest scope of protection.** Windows Credential Manager decrypts
  transparently for the signed-in user, so this does not defend against malware
  running as that user — only against a stolen machine, another account, or a
  careless backup. Android is stronger (Keystore-held wrapping key, app sandbox).
  `PRODUCT.md` §4.1 copy must not overstate it.

## CSP locked down (2026-08-18) — Q16 closed

Done **before** the UI exists, deliberately: a CSP is cheap to adopt against a
50-line harness and expensive against a finished app, because by then every
violation is a feature someone has to go rewrite.

Method: apply the strictest plausible policy first, relax only what actually
breaks. Starting permissive and tightening later never converges — nothing forces
you to discover what the slack was hiding.

**Nothing broke.** Policy now in `src-tauri/tauri.conf.json`:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
img-src 'self' data:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost;
object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

Verified twice on WebView2, violations captured over CDP (`Log.entryAdded`,
`Runtime.exceptionThrown`, `Runtime.consoleAPICalled` — not just "it looked
fine"):

| Check | Result |
|---|---|
| Boot with reload | `BRIDGE READY did=z6MkvKp5UvdL relay=true` · **0 violations, 0 errors** |
| Full message flow, two instances | pair → connect → send both directions · **STEP 1 PASSED**, `relayed=false` |

Two things worth knowing about the policy:

- **`'wasm-unsafe-eval'` is load-bearing.** Automerge is a 3.8 MB WASM blob;
  without the token, storage does not initialize at all. It permits WASM
  compilation only — it does not re-enable `eval()` or `new Function()` on
  JavaScript, so the usual reason to distrust an `unsafe-` token does not apply
  here.
- **`connect-src` is the important line.** It admits only Tauri's own IPC
  channels. No external origin is reachable from the webview, so every network
  operation must go through Rust — a dependency that tries to phone home simply
  cannot, which is precisely the property §3 wants.

**Not yet verified:** Android's webview is a different engine. The policy should
port (`wasm-unsafe-eval` is standard Chromium), but *should* is not *does*. Retest
on the next Android session, alongside the 0.3.1 background-delivery retest.

## S0 — PASSED (2026-08-12)

Verified in the **Tauri webview**, after killing the process and relaunching:

```
S0 PASSED  tauri=true  priorRuns=3  init=40.3ms
did:key:z6Mkh1xcfTJ1nfKhqRjobRMrGJiRrEvJzUTC87yFLUqHPibm
ticketRoundTrips=true  messageLanded=true  persistedAcrossRestart=true
```

| Exit criterion | Result |
| :--- | :--- |
| Runs in the Tauri webview, not a browser | ✅ `inTauriWebview: true`, WebView2 / Chrome 151 |
| `DicsussionClient.init()` resolves | ✅ 40–88 ms across runs |
| Derives a valid `did:key` | ✅ same DID recovered after restart |
| Ticket survives encode → decode | ✅ (the S1 pairing path) |
| Message persists across an app restart | ✅ `priorRuns: 3` after a full process kill |

**Corroborated from outside the app:** WebView2 wrote 6 files / 34,882 bytes to
`%LOCALAPPDATA%\io.github.mrsarthi.echoit\EBWebView\Default\IndexedDB`. That is the
storage engine committing to disk, observed independently rather than
self-reported by the code under test.

**Measurements.** `sdkInitMs` 40.3 ms; navigation→harness-complete ≈ 650 ms.
Bundle: JS **1,074 kB**, WASM **3,858 kB**. Note the second figure is *not* app
cold start — process launch and webview creation happen before any JavaScript
exists to observe them. True cold start needs `adb shell am start -W` on
Android (S2).

**Caveat carried forward:** this run used `allowUnencryptedStorage: true`. S0
proves the storage path works, not that it is protected. Keychain integration
(M2.2.2) is now a hard prerequisite before any build that holds real data.

---

### The earlier "S0 Complete" claim was wrong — kept as a record

**S0 status — corrected 2026-08-06.** The SDK genuinely boots: `DicsussionClient.init()`
runs with `IndexedDbDriver` and `transport: 'local'`, derives a `did:key`, sends to
itself, and data survives a reload. That retires the real risk in S0.

But it was **run in a browser via `vite dev`, not in the Tauri webview**, and S0's exit
criterion is the webview. Evidence: `src-tauri/target` and `src-tauri/gen` did not exist,
so the app had never been compiled or launched. Three consequences:

- **The 88.6 ms / 15 ms figures are browser numbers**, measuring
  `DicsussionClient.init()` in a tab. The app's cold start additionally includes process
  launch, Rust init, and webview creation — none of which JavaScript can observe. The
  spike deliverable asks for the latter.
- **IndexedDB lives in a different place.** In the app it is the webview's storage
  partition under the app data directory, not a browser profile. Persistence across
  restart is exactly the behaviour most likely to differ.
- **`csp` is still `null`.** Tightening it later can break WASM instantiation
  (`wasm-unsafe-eval`), and Automerge is a 3.8 MB WASM blob on the critical path.

Bundle sizes are runtime-independent and stand: JS **1,055 kB** (577 kB gzip), WASM
**3,858 kB** (1,187 kB gzip).

**Harness hardened at the same time.** It previously compared history counts within a
single session, which cannot demonstrate persistence. It now uses a fixed channel and
database so the startup count equals the number of previous runs, reports `FIRST_RUN`
when nothing has restarted yet, and only reports `PASSED` once data has survived the
process dying. It also detects `__TAURI_INTERNALS__` and states plainly when it is
running in a browser, so this distinction cannot be missed again.

---

## S1a — Two users can talk (2026-08-12)

`npm run test:two-peer` — three scenarios, all passing. Two **separate OS
processes**, each a real Dicsussion node over real Iroh/QUIC. Two processes
rather than two clients in one heap is deliberate: peers sharing memory can
appear to work for reasons that have nothing to do with the network.

| Scenario | Result |
| :--- | :--- |
| Two paired peers exchange messages, both directions | ✅ `peerCount=1`, path **direct** — hole-punching worked, no relay |
| One-sided pairing delivers nothing | ✅ sender reports "sent", receiver correctly gets nothing |
| A message sent offline arrives on reconnect | ✅ withheld while offline, `flushed=1` on reconnect |

**Why scenario 2 exists.** Since 0.1.0 pairing is mutual (D3), and an unpaired
receiver drops inbound frames with **no error on either side** — `client.js:520`
calls this out explicitly. The sender sees a successful send. That failure is
invisible from the sending end, so it needs a test asserting a *non*-delivery.
Left untested it surfaces later as "it says connected but nothing arrives",
which is miserable to diagnose and worse to receive as a bug report.

**Files:** `harness/peer.mts` (one headless node, JSON-Lines over stdio) and
`harness/two-peer.mts` (orchestrator and assertions).

**Scope — what this does and does not prove.** It proves the *protocol and the
published SDK* let two users converse, including pairing, delivery both ways,
CRDT sync, and the offline outbox. It does **not** exercise
`TauriIrohTransport`: the harness runs in Node against the native Iroh module,
not in the webview. Splitting S1 this way is intentional — when the bridge
fails, we now know it is the bridge.

### Harness was running untyped — fixed

`tsconfig.json` includes only `src`, so `harness/` was never typechecked.
Adding `tsconfig.harness.json` (Node lib and globals, separate program so DOM
and Node types do not leak into each other) surfaced three errors immediately,
including the upstream one in Finding 12. `npm run typecheck` now runs both.

---

## S1b — Rust half complete (2026-08-12)

`src-tauri/src/iroh_bridge.rs`. Six commands and three events. Verified in the
Tauri webview:

```
IROH PASSED  id=b97dee078c38…  addrs=4  bind=1105ms (6.4ms on reuse)
relay: https://aps1-1.relay.n0.iroh.link
```

Four addresses were discovered including a **public** one (`42.108.16.29`)
alongside the LAN and IPv6 addresses, so NAT reflection works; a relay was
assigned as fallback. `cargo check` clean.

| Command | Purpose |
| :--- | :--- |
| `iroh_start(secretKey)` | Bind with the SDK-derived transport secret, begin accepting |
| `iroh_identity()` | Current `EndpointId` + addresses |
| `iroh_connect(transportKey, directAddresses, relayUrl)` | Dial, open the byte pipe |
| `iroh_send(connId, base64)` | Write bytes |
| `iroh_disconnect(connId)` / `iroh_stop()` | Tear down |

Events: `iroh://data`, `iroh://inbound`, `iroh://closed`.

**Design decisions, all recorded in the module header:**

- **The transport secret comes from JavaScript.** A ticket's `transportKey`
  *is* the `EndpointId`, and the SDK derives it from the identity key by
  one-way HKDF. An endpoint minting its own key would advertise an
  `EndpointId` no peer could dial — and it would look like a network fault.
- **Idempotent start.** A webview reload calls it again; rebinding would
  strand peers mid-dial on the old address.
- **`iroh_connect` takes the ticket's parts, not the ticket.** Decoding is the
  SDK's job; duplicating a wire format across two languages is how the two
  drift apart.
- **Inbound reports `unverifiedTransportId`, never a `did:key`.** Iroh
  authenticates the transport key during TLS, which says nothing about
  identity ownership. Only the SDK handshake establishes that, so the field is
  named for what is actually known.
- **base64 on the wire.** A JSON array of numbers costs ~4× against ~1.33×.
- **One stream per connection, not six** — decided deliberately, see below.

### Accepted limitation: flat pipe weakens §6 preemption

All six sub-streams share one bidirectional QUIC stream, with the SDK labelling
frames — the same shape `WebSocketTransport` already uses.

The cost: over six independent QUIC streams a large `0x02` frame cannot delay
an urgent `0x03` revocation. Over one stream, priority degrades to send-queue
ordering, and a frame already in flight still finishes first. With frames
capped at 1 MB that is a bounded delay rather than a stall, and it does not
affect the S1b or S2 gates.

Taken knowingly to keep 0.2.0 small. If it needs fixing the change is confined
to this module and the transport implementation above it — a note has been
requested in the SDK docs so the trade does not quietly become "how it works".

**Still blocked:** the TypeScript half needs `createBridgedTransport` from SDK
0.2.0 (Finding 13). The Rust side is ready for it.

---

## S2 partial — the app runs on a physical Android phone (2026-08-16)

Not the gate yet (no message has crossed between two devices), but the entire
Android *risk surface* is retired. On an I2404, debug build:

```
S0 PASSED    tauri=true  priorRuns=1  init=83.6ms
IROH PASSED  id=f265615c31a1…  addrs=3
```

| Question | Answer |
| :--- | :--- |
| Does our code compile for Android? | ✅ 347 MB ARM64 `.so`, NDK r27d, 135,726 `iroh` symbols linked |
| Does it install and launch? | ✅ Both phones; displayed in 506 ms, ~530 ms median cold start over 3 runs |
| Does the SDK boot in the phone's webview? | ✅ Identity derived, IndexedDB persisted across restart |
| Does the Rust Iroh endpoint bind on a phone? | ✅ Three addresses discovered |

**Method note.** Android WebView console output does not reach `logcat`, so the
harness verdict is read the same way as on desktop — attach to the webview's
devtools socket and read the page title:

```bash
adb -s <serial> forward tcp:9223 localabstract:webview_devtools_remote_<pid>
curl -s http://localhost:9223/json
```

**Two Windows prerequisites**, both non-obvious and both costing a build cycle:

- *Windows* Developer Mode must be on — distinct from *Android* developer
  options despite the name. Tauri symlinks the built `.so` into the Android
  project, and Windows blocks that without it.
- Each phone must authorise this specific computer (`adb devices` shows
  `unauthorized` until the on-device prompt is accepted).

**Corruption, again.** The first Android build failed with 541 `memchr` NEON
errors. The real cause was `found invalid metadata files for crate 'core'` —
the `aarch64-linux-android` standard library was corrupt, and every intrinsic
error cascaded from `core` being unloadable. Its manifest was zero-filled and
dated **Aug 5 19:14 — the same minute as the corrupted cargo crates**. One
event that evening damaged files across both `~/.cargo` and `~/.rustup`.
Fixed by reinstalling the toolchain. **`~/.cargo` and `~/.rustup` should be
excluded from real-time AV scanning**, or this recurs and keeps presenting as
unrelated compiler bugs.

---

## Android toolchain — ready (2026-08-12)

`npx tauri android init` succeeds. Nothing is left to discover when the phones
are connected.

Most of it was already installed via Android Studio — SDK, build-tools,
platform-tools (`adb` 1.0.41), platforms, and a bundled JDK 21. The only
missing piece was the **NDK**, which compiles Rust for the phone.

| Component | State |
| :--- | :--- |
| NDK | **Installed** — r27d / `27.3.13750724` |
| Rust targets | `aarch64-linux-android`, `armv7-linux-androideabi`, plus `i686`/`x86_64` added by `tauri android init` for emulators |
| `ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME` | Set persistently (user scope) |
| Android project | Generated at `src-tauri/gen/android` (gitignored) |

**r27d over the newer r28c** deliberately: it is the revision most widely used
with Rust mobile builds today, so least likely to surprise us. Swapping costs
only a download.

**Download verified before installing.** Size and SHA-1 checked against
Google's package index — 781,506,724 bytes, `56607cbc…`, both exact. A first
attempt at verification reported a mismatch, which was my regex window picking
up a neighbouring package's metadata; parsing the XML properly cleared it.
Worth the second look given the 16 corrupted crates found in the cargo cache
earlier this session.

The NDK extracted as `android-ndk-r27d` and was renamed to `27.3.13750724`,
the version-numbered layout `sdkmanager` produces and tooling expects.

**Hardware confirmed available:** two Android phones, two laptops, and both
same-network and cross-network testing. That clears the last non-code
prerequisite for S2.

---

## ⏸ Background delivery — PARKED, with one finding that is not parked

**Deliberately set aside 2026-08-17.** A design is being explored separately
(store-and-forward on reconnect, possibly a blind mailbox). What follows is
what testing established, so the decision is made on evidence.

### Measured

Both phones connected and delivering. B backgrounded with the HOME key, then
three messages sent from A at increasing depths:

```
immediately backgrounded  → A: sent d6c588c2   A status: connected=true
after 30s backgrounded    → A: sent bf79f798   A status: connected=true
after 90s backgrounded    → A: <<eval-failed>> A status: connected=true

B events: 14:10:58 closed — read error: connection lost
delivered after foregrounding: 1/3
```

- **Nothing arrives while backgrounded.** B's webview was frozen by 90 s —
  it stopped answering debugger requests entirely.
- **At least one message was lost outright**, not merely delayed. (The count is
  "at least one": the third send returned `<<eval-failed>>`, so it may never
  have been issued. A clean re-run would settle it.)
- **A reported `connected=true` throughout**, including after B's connection had
  already died.

### The finding that is NOT parked — an SDK bug

The loss is **not** caused by Android suspending the app. It is caused by the
sender never learning the connection died:

| Fact | Consequence |
| :--- | :--- |
| `detachConnection()` is defined in `peer-registry.js:76` and **never called anywhere** in either package | A dead connection is never released |
| `connectedCount` counts `if (peer.connection)` — existence, not state | A `Disconnected` connection still counts |
| `listPairedConnected()` filters on `paired`, never on liveness | Dead peers are still publish targets |
| `teardown()` calls `markClosed()`, which only mutates transport-internal state | The `PeerRegistry` never hears about it |

So `isOnline()` stays true, `sendMessage` **never queues to the outbox**, and
`publish()` writes into a dead connection and resolves successfully. The outbox
— machinery built for exactly this — is bypassed.

**This is a correctness bug well beyond backgrounding.** It fires on any dropped
connection: wifi → mobile handover, a closed laptop lid, a weak signal. In every
case the sender loses messages while showing success.

**Suggested fix (upstream):** have `connectedCount`/`listConnected()` require
`connection.state === ConnectionState.Connected`, *and* have `teardown()` reach
`detachConnection(peerDid)`. The state check makes the count honest; the detach
releases the reference.

**It is a prerequisite for every offline-delivery design**, including a mailbox
— without it the client keeps writing into a dead connection instead of falling
back to anything.

### For whatever design is chosen

- The outbox **already persists to disk and hydrates on startup**, so the
  storage half of store-and-forward exists. What is missing is the *trigger*:
  `flushOutbox()` only runs from an explicit `goOnline()`, and nothing fires it
  when a peer reconnects.
- **A foreground service is what makes store-and-forward viable at all.**
  Without one the app runs only while on screen, so delivery would need both
  users to have EchoIt *open simultaneously* — near-never. With one, overlap is
  the normal case.
- A mailbox server would solve delivery outright but reverses §3.1. If taken,
  a **blind mailbox** (rotating recipient pseudonyms the server cannot link) is
  materially stronger than "we promise to delete" — the latter is policy, not
  proof, and does not survive a subpoena.
- **Undelivered state must be visible in the UI.** A tick that means "queued on
  my phone" must not look like "delivered to theirs".

---

## 🚪 S2 PASSED — THE GATE IS OPEN (2026-08-17)

**Two physical Android phones exchanged encrypted messages.** This is the
condition the master prompt set before any UI may be built.

```
A  did:key:z6MknKLSuJa3NCwYdQzneCystZWbQTNbBagHaskqLVJuo3WZ   (I2404)
B  did:key:z6Mkt2KJbgSvGoESY6YKeDuubxF5TN1x7b7K16Zx1TNcNhPT   (RMX3785)

connect took 377ms
A -> B: DELIVERED in 527ms
B -> A: DELIVERED
peers=1 paired=1 connected=true relayed=false
```

**Direct peer-to-peer, no relay.** Event log clean — one inbound, no closes, no
retries. Same wifi.

### The full ladder, every rung passed

| Step | What it proved | Result |
| :--- | :--- | :--- |
| 0 | Bridged transport over a TCP pipe (Node) | ✅ 3/3 |
| 1 | Two app instances, one machine | ✅ both ways, and on reconnect |
| 2 | Two laptops, same network | ✅ direct |
| 3 | Two laptops, **different** networks | ✅ works; slower first connect |
| **S2** | **Two physical phones** | ✅ **direct, 377 ms connect, 527 ms delivery** |

Building the ladder one variable at a time is what made each failure
attributable. When step 1 broke, step 0 passing meant it was our IPC and not
the protocol. When two laptops broke, step 1 passing meant it was the network
layer and not the bridge.

### Spike deliverables — all measured on real hardware

| Metric | Value |
| :--- | :--- |
| Release APK | **33.3 MB** (13.6 MB via Play bundle) — target was <50 MB |
| Cold start | **~530 ms** median, 506 ms to displayed |
| SDK init on device | 83.6 ms |
| Connect (same wifi) | **377 ms** |
| First message delivery | **527 ms** |
| Path | **direct**, no relay |

Cross-network connections are noticeably slower to establish — hole-punching
has to complete before traffic flows, and iroh may serve the first message over
a relay while upgrading. **That first-connect delay is a UI problem, not just a
number:** a user pairing with a friend will be staring at a screen wondering
whether it worked, so the pairing flow must show progress rather than assume
instant.

### What S2 does NOT prove

- **Background delivery.** Both phones were awake with the app in the
  foreground. Android suspends backgrounded apps, and that remains the hardest
  unsolved problem (Q8).
- **Cross-network on phones.** Only same-wifi was tested; mobile data is next.
- **That a human can do it.** The run was driven over `adb`. The bridge screen
  was laid out for a desktop window and has not been used on a phone.

---

## S1b complete — two laptops exchange messages (2026-08-17)

**Step 2 passed.** Two physical laptops on the same network, messages delivered
both ways over `createBridgedTransport` on the Tauri bridge — `peers=1`,
`connected=true`, **`relayed=false`** (direct peer-to-peer, no relay).

The ladder that got us here, each rung isolating one variable:

| Step | Result |
| :--- | :--- |
| **0** — bridged transport over a TCP pipe, in Node | ✅ 3/3 scenarios |
| **1** — two app instances, one machine | ✅ both directions, and again on reconnect |
| **2** — two laptops, same network | ✅ **direct**, both directions |
| 3 — two laptops, different networks | next |

### Three real bugs, none of which the automated tests could have found

**1. `refreshAddresses()` was never called.** The bridged transport warms its
address cache once at construction, fire-and-forget, and its own docs say
callers *"still await `refreshAddresses()` first"*. At that instant the socket
has only just bound: LAN addresses at best, no relay. `getTicket()` serves that
cache, so every published ticket pointed nowhere useful off-LAN.

My `waitForDialableAddress` polled *Rust* and correctly reported "Dialable
Anywhere" — it was reporting on the wrong thing entirely, so the screen looked
healthy while handing out unusable tickets.

**2. Connection ids were derived from the peer's transport key.** That key is
stable, so reconnecting to the same peer reused the same id;
`connections.insert` then dropped the previous sender, whose writer emitted
`closed` for that id, and the SDK tore down the channel it had just created.
Every reconnection killed itself with the remains of the last one.

**It only bites on the second connection between a pair**, which is why every
automated test passed — each used fresh instances doing a single connect. Fixed
with a monotonic counter.

**3. A pasted ticket went back into the machine it came from.** User error, but
one the code made invisible: pairing succeeded, `peers=1`, `connected=true`,
and nothing was ever delivered because the only paired peer was itself. Now
refused outright.

### Diagnostics added, and why they mattered more than the fixes

Every failure above initially presented as the same unhelpful string. What
actually moved us forward:

- **Transport event log with reasons.** Rust always sent a close reason; the
  TypeScript discarded it, collapsing "network died", "peer hung up" and
  "orderly teardown" into one message. Surfacing it is what exposed bug 2 —
  the repeated identical connection ids were visible in the log.
- **`paired=` alongside `peers=` in the status line.** `publish()` only sends
  to peers that are connected **and** paired, but the status showed only
  connected. `peers=1 paired=0` is total silent failure that looks identical to
  success.
- **Truncation detection on pasted tickets.** `decodeTicket` tolerates every
  kind of whitespace mangling — verified against newlines, CRLF, email
  soft-wrapping — so "malformed" almost always means truncated. The message now
  says so and prints the length received.
- **Self-pair refusal**, which caught bug 3 immediately.

The pattern worth keeping: **three of these failures were invisible because a
success signal was reporting on the wrong thing.** "Dialable Anywhere" described
Rust rather than the ticket; `peers=` described connections rather than
delivery; "sent" described local acceptance rather than transmission. Each one
looked like health.

---

## Decisions

### D1 — Runtime: Tauri v2 (2026-08-05)

**Targets: phones and desktop.** Browsers remain out of scope for the app.

**Reasoning.** The runtime is the one decision that is expensive to reverse, and
the deciding factor was iOS. `@number0/iroh` publishes no iOS binary (Finding
3), so any Node-in-the-app route — nodejs-mobile, React Native with the NAPI
module — reaches Android but not iOS. Under Tauri, Iroh is an ordinary Rust
dependency that compiles for `aarch64-apple-ios` like any other target, so the
problem disappears at its source instead of being worked around.

The cost is real and accepted: the TypeScript SDK runs in a webview rather than
in Node, which means shimming a small set of Node built-ins and writing a
transport bridge. That work is bounded and understood. Rebuilding the app shell
after discovering iOS is impossible would not be.

**iOS is deferred, not abandoned** — no Mac is available to build or sign. The
point of choosing Tauri now is that adding iOS later becomes a build-and-sign
exercise instead of a rewrite. A Mac is needed only to ship iOS, never to
develop against it.

**Rejected:**
- *nodejs-mobile / React Native* — cheapest-looking route right until iOS enters
  the picture, where there is no binary to load. Also inherits iOS's JIT ban.
- *Node sidecar alongside Tauri* — works nicely on desktop, but Tauri cannot
  spawn sidecar binaries on mobile, so it fails the platforms that matter most.
- *Porting the SDK to Rust* — enormous, and discards a tested 422-test codebase.

### D2 — QR pairing deprioritized (2026-08-05) — ⚠️ **REVERSED by D3**

QR is one idea for discovery, not a requirement. Pairing during the spike is
clipboard paste of an encoded ticket. This also demotes Finding 2 from a blocker
to an ergonomic wrinkle.

### D3 — Pairing is back on the critical path (2026-08-12)

**`@dicsussion/sdk@0.1.0` makes pairing mandatory AND mutual**, which reverses
D2. Both devices must call `addPeer()` with the other's X25519 key before any
traffic flows:

- the dialer must have paired, or `connect()` throws;
- **the receiver must have paired, or every inbound frame is silently dropped**
  — no messages, no CRDT sync, no vouchers.

The rationale is sound: a completed handshake authenticates *a key*, not a
relationship. `did:key` is self-asserted, so before this gate anyone holding a
public ticket — and tickets are meant to be shared — could inject messages into
a stranger's history.

**Consequences for EchoIt.** Pairing becomes a two-sided flow, not a one-way
paste, so it needs real UI design rather than a text box. A one-sided pairing
must be *visibly* incomplete: the failure mode is a peer that shows as connected
and silently receives nothing, and "it says connected but nothing sends" is a
miserable bug report to receive and a worse one to diagnose.

This effectively answers Q7 in the implementation plan. Ticket-carrying QR or a
deep link is now the natural shape, since `getTicket()` already includes the
encryption key.

---

## 1. Groundwork & Initialization (2026-08-04)

### What was built
- Extracted product and architectural constraints from `.agents/ECHOIT_MASTER_PROMPT.md` and the protocol's app strategy document.
- Created `AGENT_INSTRUCTIONS.md` — standing engineering rules, privacy constraints, SDK boundary policy, v1 scope, reporting standards.
- Created root `.gitignore` — blocks plaintext SQLite databases (`*.db`, `*.db-shm`, `*.db-wal`, `*.sqlite`), keys (`*.key`, `*.pem`, `*.secret`), and env files, enforcing `AGENT_INSTRUCTIONS.md` §3.4 and §3.5.
- Created root `README.md` pointing at the standing documents.
- `git init` on `main`. EchoIt is its own repository, per the master prompt.

### Design decisions & reasoning
- **Zero code before the runtime was chosen.** No `npm init`, no framework scaffold. Creating a `package.json` early would quietly pre-commit the decision the spike exists to make. *(That decision has now been made deliberately — see D1 — so scaffolding begins at S0.)*
- **Defensive database gitignore, written before any storage layer exists.** Doing this after the first store is created is one bad `git add -A` too late.

---

## 2. Runtime verification (2026-08-05)

### Verified by running it

Measured on this machine — Windows 11, Node v24.11.1, npm 11.6.2 — not taken
from the protocol's documentation.

- **`tsc --noEmit` on the protocol is clean.** Exit 0, re-confirmed after the ZK changes landed.
- **The SDK boots with real Iroh transport on Windows.** `npx tsx scripts/peer-cli.mts` came up, derived an identity, and printed a well-formed ticket carrying one IPv4 and two IPv6 direct addresses. Clean shutdown on `/quit`.
- **The API quoted in the master prompt matches the code**, with one correction: `connect()` takes a `PeerTicket` **object**, not a string.

**Not verified:** the protocol's 422-test count and `npm audit` status. Not run this session.

---

## Onboarding fixed on both platforms, Android re-verified on 0.5.0 (2026-08-24)

Two bugs a human found in one attempt that the whole automated suite had
missed, plus confirmation that the fixes hold on Android.

### What was broken

Reported from real use: *"as soon as I press enter after entering the 3rd, 7th
and 11th word, it throws me back at the setup page to restart the onboarding."*
No error, no explanation, recovery phrase gone.

**Bug 1 — the flow restarted itself silently.** `startNewIdentity` set
`state = "unlocking"` before its work, which unmounts `OnboardingScreen`; the
failure path set `state = "onboarding"`, mounting a **fresh** one at the intro.
The real error went to a component that no longer existed. `restoreIdentity`
behaved identically, so a mistyped recovery phrase did the same thing.

The screen already had its own `loading` driving the button spinner, so the
global flip bought nothing and cost the entire failure path.

**Bug 2 — a failed attempt left a key behind, and this one is worse.**
`storeStorageKey` runs before the client is built. A failure left a key in the
OS keychain with no identity behind it, so the **next launch takes the "key
exists, unlock" branch, skips onboarding entirely, and creates an identity
whose recovery phrase the user was never shown** — an account that cannot be
restored, with nothing to indicate anything went wrong.

Found only because the user's failed attempt left a credential on their machine
and it was noticed reappearing.

### Why the suite missed both

`drive-chat.mjs` drives onboarding too — but only ever on a clean profile,
where it always succeeds. **Every check asserted that things work, and both
bugs lived entirely in what happens when they do not.** The same blind spot
produced the stock Tauri icon shipping for three weeks: a check that only
confirms the good case cannot see either.

`drive-onboarding-failure.mjs` and `drive-android-onboarding.mjs` now drive the
unhappy path and fail loudly if the screen restarts without explaining itself.

### Android needed separate proof, not inference

Both bugs were in `AppContext` — shared code — so the fix reaches Android by
construction. **Bug 2's fix does not.** It calls `clearStorageKey` →
`keychain_delete` → `android-native-keyring-store`, and that delete had never
executed on a device. Had it been a no-op there, the code would look fixed while
the bug survived — precisely the shape of the `ndk_context` crash, which also
compiled cleanly and had simply never run.

So it was measured rather than assumed. `drive-android-onboarding.mjs` onboards
for real, deletes the key through the app's own command, and checks whether
onboarding reappears:

```
1. onboarding for real
   done → onboarded: true

2. deleting the storage key via keychain_delete
   keychain_delete → ok
   onboarding reappeared after restart: true

3. onboarding again — the database cannot be decrypted now
   bounced to intro : false
   still on confirm : true
   error displayed  : true
     Could not initialize identity: aes-gcm: invalid tag
   key left behind after the failure: false

ANDROID ONBOARDING: PASSED — fails safely and leaves no key
```

`keychain_delete` works on Android. Both fixes hold there.

### Verified on SDK 0.5.0

| Check | Result |
|---|---|
| Two phones, conversation through the real UI | **PASSED**, both directions |
| Android onboarding, happy and failing paths | **PASSED** |
| `keychain_delete` on Android | **works** — first time it has ever run |
| CSP on Android | **0 violations, 0 console errors** |
| Release APK fingerprint | **matches** `2ff2e896…99bd`, `CN=EchoIt` |
| `test:two-peer` / `test:three-peer` / `test:bridge` | 3/3 · PASS · 3/3 |
| Desktop release binary, conversation + `check:icon` | **PASSED** · 6 of 6 frames |

### Still open, and it is the same failure from the user's side

**There is no way out of a failed onboarding from inside the app.** If the
keychain entry is lost while app data survives, the user sees
`aes-gcm: invalid tag` forever with no reset, no "start fresh", nothing. The
only escape is deleting app data by hand, which no tester will know to do.

**This is more likely on Android than on Windows**: Android Keystore keys can be
invalidated by the OS, and changing the lock screen or biometrics can do it. The
machinery to fix it already exists — `markPendingReset` / `runPendingReset`, as
used by Settings → Reset Session. Offering it from the onboarding error is a
small change on a proven path.

Not done: the reset flow is one of the five things in `START_HERE` that look
wrong and are not, and it was not worth touching while the app was being tested
live.

## The updater works — proven by using it (2026-08-25)

Q21's whole point was that a tester must never be stranded on the build they
first installed. Until today that was designed, built, and **unproven**: an
update path cannot be tested without a second release to update *to*.

### Windows — check and in-place install, both verified

| Step | Result |
|---|---|
| Installed **0.1.1** from the published release | `%LOCALAPPDATA%\EchoIt`, reports 0.1.1 |
| Settings → Check now | *"Version v0.1.2 is available"* |
| **Get version v0.1.2** | Downloaded, installed, relaunched itself |
| Installed executable afterwards | **0.1.2** |
| App afterwards | *"You are on version 0.1.2 — You're on the latest version."* |

A `EchoIt-0.1.2-updater-*` folder in `%TEMP%` corroborates it: the updater
fetched the installer and ran it.

*(Read the result wrong first. Polled the file version for 60s, saw 0.1.1
throughout, and reported a failure — the install completed after the watch
window closed. The poll was too impatient; the file version and the temp folder
were what settled it.)*

### Android — the check is fixed, the install path is not the same thing

`check_for_update` now completes on a device in **0.6s** (Finding 21). But
Android has no in-place updater: *Check now* reports the version and opens the
Releases page, and the user reinstalls the APK over the top.

**Whether messages survive that reinstall is still unverified.** The release
notes claim they do — same signing key, so the app sandbox is preserved — but
claiming it and having measured it are different, and this one is only claimed.

### A flaw in our own code, found by the false alarm

`installInPlace()` wraps the whole flow in `catch {}` with no logging. While the
update looked broken there was **no way to learn why** — the error was
discarded. Falling back to the Releases page is right; discarding the reason is
the same swallowing pattern fixed in `pairing-store` earlier, in code written
after that lesson.

### Release sequence, for the record

- **v0.1.0** — first beta.
- **v0.1.1** — the three reported bugs: Android back button, chat header under
  the status bar with the keyboard open, and the "Your safe address" panel.
- **v0.1.2** — Finding 21, the Android update check that hung forever.

**0.1.0 and 0.1.1 on Android cannot check for updates at all**, including for
the release that fixes it. Those testers need one manual download; from 0.1.2
the check works. Windows was never affected.

## The Android back button, on the third attempt (2026-08-26)

Reported: *"the back button now works when I am in the chat window, but for
everywhere else it exits the app."* The intent, in the user's words: *"when
users presses to back through their phone's navigation system, we just take them
to the previous page where they were, if there's no more place to be, we ask
them if they want to exit."*

### Two approaches that could never have worked

Both used `history.pushState` and `popstate`. The device disproved each:

| Attempt | Why it failed | Evidence |
|---|---|---|
| `pushState` + `popstate` | `TauriActivity` ships `handleBackNavigation = false`, switching off wry's back callback entirely. The press never reached JS. | App exited with `history.length` 2 |
| Override it to `true` | wry only calls `goBack()` when `WebView.canGoBack()` — that tracks *native* navigation, not `pushState` entries. | App exited with `history.length` **4** |

The second is the one worth remembering: the fix was aimed at a real mechanism
that simply does not observe the thing being changed. Reading wry's source
would have shown this before either build.

### What works

`MainActivity.onWebViewCreate` — the one `open` hook that hands you the WebView
— registers its own `OnBackPressedCallback` and forwards the press to JS as
`echoit:back`. No dependence on webview history; the app always decides.

Verified on the I2404, every state read from the live DOM over CDP:

| Press | Before | After |
|---|---|---|
| 1 | Settings | Contacts |
| 2 | Contacts | Chats |
| 3 | Chats (at the floor) | exit prompt rendered |
| 4 | prompt open | prompt open, no exit |
| from an open conversation | chat with Phone B | Contacts, app alive |

The prompt check greps `document.body.innerText` for "Close EchoIt", so it is
the rendered dialog rather than React state.

### Two defects the testing found

**1. The Close button did nothing.** `getCurrentWindow().close()` is a no-op on
Android — measured: process still alive after tapping it. The exit prompt had
replaced *"back exits the app"* with *"back can never exit the app"*, which is
worse than what it fixed. `EchoItExit.exit()` is now a native bridge calling
`finish()`; `confirmExit` dispatches `pagehide` first so the checkpoint lands.

Verified: process gone, 0 activity records. And the checkpoint is real — sent
`persist-probe-211110`, exited through the prompt, relaunched, message still
there.

**2. `apply-android-back-nav.mjs` was not idempotent.** It guarded on "the file
already mentions `echoit:back`". When the body grew the exit bridge that guard
still matched, and the script produced a **second** `onWebViewCreate` override
— a file that would not compile. A guard that tests for a string the script's
own output controls stops being a guard the moment that output changes. It now
brackets its region with sentinels and strips that region before rewriting;
three consecutive runs produce one override.

This is the fourth stale/duplicated-artifact bug in this project (icon
resource, release manifest installer, and now this). The pattern: a generator
whose "already done" check is weaker than what it generates.

### Not verified

- **`ChatView` still shows "Invalid Ticket" for a handshake stall.** Seen while
  setting up a test peer: a 10s timeout was reported as an invalid ticket. The
  ticket was fine. Wrong diagnosis shown to the user; not touched here.
- Desktop is unaffected — there is no back button — but `confirmExit` now needs
  `core:window:allow-close`, added to `capabilities/default.json`.

### Ships with

`npm run android:prepare` runs signing **and** this patch. Building with only
`android:sign` yields a correctly signed APK whose back button exits on the
first press — which is exactly what shipped in 0.1.1.

## The keyboard, the safe areas, and a wrong diagnosis repeated (2026-08-27)

Reported: *"When the keyboard is open while chatting, I can scroll through and
the keyboard goes up along with the msgs, revealing a blank grey area under the
typing box."* A screenshot the user supplied is what actually cracked it.

### What was happening

This webview does not shrink for the keyboard. It keeps full height and Chrome
**pans** the visual viewport instead:

| | value |
|---|---|
| `innerHeight` | 875 |
| `visualViewport.height` | 548 |
| `visualViewport.offsetTop` | **250** |

`#root` was sized to the visible 548 but left pinned at layout-top 0, so the pan
slid it up and uncovered 250px of bare `body` below the composer. The visible
band was layout-y 250..798; the app stopped at 548.

`interactive-widget=resizes-content` was supposed to prevent this and does
nothing here — `innerHeight` stayed 875 with it set. It was recorded as
superseded rather than ineffective.

### The fix

`#root` now follows the pan: `position: fixed; top: var(--vv-offset-top)`.
`useViewportHeight` had been exporting that variable since it was written, with
a comment saying it existed so the layout could compensate — and nothing had
ever consumed it.

### The native approach, tried and abandoned

Padding the WebView by the IME inset makes the layout viewport shrink, which
removes the reason to pan. It works. It also costs the safe areas: installing an
`OnApplyWindowInsetsListener` anywhere above the WebView stops the WebView
receiving insets, and every `env(safe-area-inset-*)` collapses to 0.

| build | envTop | envBottom | result |
|---|---|---|---|
| with the listener | 0 | 0 | header under the clock, composer under the nav bar |
| without it | **36** | **43** | correct |

**This shipped to the user's phone in an unusable state** — *"The typing box is
stuck behind the navigation buttons at the bottom, I can't click on it. Same for
the header."* Restoring `acd9de1` fixed it, and doubled as the experiment that
settled the cause.

### The part worth keeping

The listener was blamed, then **exonerated on the strength of an experiment that
never ran**. A build was made with the listener removed to test it; that command
was backgrounded and only its tail read, so the `grep -c
setOnApplyWindowInsetsListener` that would have confirmed the removal was never
seen. On that basis the user was told "I did not break the safe areas" — which
was false, and reversed a correct diagnosis.

The rule this earns: *an experiment whose precondition was not verified is not
evidence.* Backgrounding a command and reading only its tail discards exactly
the precondition checks put there on purpose.

Second, smaller: `scripts/apply-android-activity.mjs` reverted on disk mid-session,
losing three confirmed edits. Which code the intervening APKs contained is not
knowable after the fact.

### Tests added

`harness/cdp/drive-android-keyboard.mjs` — asserts `#root` spans
`offsetTop..offsetTop+visualViewport.height` with the keyboard open **and after
scrolling**, the step the original "header looks right" check skipped.

Three of its own early runs reported failures that were the test measuring the
wrong thing, and each is now guarded:

- the app had been backgrounded, and the webview answered CDP from behind the
  home screen with every geometry check passing;
- the keyboard was still up from the previous run, so the closed baseline was
  taken with it open;
- `KEYCODE_ESCAPE` dismissed the keyboard *and* closed the conversation.

It now owns the app lifecycle rather than defending against each. It also cannot
be driven by synthetic events: neither CDP `Input.dispatchTouchEvent` nor
`element.focus()` raises the IME. Only `adb shell input tap` does — and while the
composer was drawn under the nav bar, that tap hit Home.

## Message times were a units bug, not a clock bug (2026-08-27)

Reported: *"fix the timing on the msgs, it always shows 10:03 pm."*

The SDK reports `timestamp` in **seconds**; `new Date()` wants milliseconds.
Measured:

```
wall = 1787801421537 (ms)   reported = 1787801421 (s)
```

Reading seconds as milliseconds put every message in January 1970 and collapsed
the gaps: three sends three seconds apart came out three *milliseconds* apart
and rendered as one identical clock time. Storage was never wrong — 3 of 3
timestamps were distinct throughout.

`toMillis` in `services/conversation.ts` normalises on the way in, at all three
points where an SDK timestamp becomes an app timestamp. It tests the magnitude
rather than assuming, so a future SDK switching units does not move the bug by a
factor of a thousand. No migration: the conversion happens on read, so messages
already stored show their true original time.

**A vector clock was suggested and is the wrong tool here.** It records causal
order and deliberately carries no wall-clock time, so there would be nothing to
display. It would address a different, real problem — two phones with skewed
clocks producing messages that sort wrongly — which is ordering, not display.

`npm run test:timestamps` covers the units, the collapse, and the zones —
including **Asia/Kathmandu (+5:45)** and **Pacific/Chatham (+12:45)**, where a fix
built from a fixed offset would fail, plus an assertion that the conversion
mentions no timezone at all. It needs no network and no device.

### Still open

With truthful timestamps, messages from different days show only a time, so a
conversation spanning days reads as out of order — `persist-probe` at 09:11 PM
sits below `Herro` at 09:15 PM because it is a day later. Day separators are not
built.

## Findings

### Finding 20 — a backgrounded peer loses messages the sender reported as delivered — 🔴 **BLOCKS BETA** *(measured 2026-08-24)*

**The question Q8 was written to answer, answered.** Two physical phones, an
I2404 (Android 16) and an RMX3785 (Android 15), `harness/cdp/test-background.mjs`:

```
baseline (both foreground): DELIVERED
B sent to background (HOME)

sent immediately after backgrounding
   A: sent 6788706c | A status: peers=1 paired=1 connected=true  relayed=false outbox=0
sent after 30s backgrounded
   A: sent 2063ead7 | A status: peers=1 paired=1 connected=true  relayed=false outbox=0
sent after 90s backgrounded (approaching Doze)
   A: sent 1a27949d | A status: peers=0 paired=1 connected=false relayed=false outbox=1

delivered AFTER foregrounding: 1/3
A status: peers=0 paired=1 connected=false outbox=1
B status: peers=0 paired=1 connected=false outbox=0
```

### Read the outbox column, not the verdict

The driver prints **LOST: 2 of 3**. The precise position is narrower and worse
in one respect, better in another:

| Message | Sender's belief at send | Outcome |
|---|---|---|
| 1 — fresh background | `connected=true`, **`outbox=0`** | Did not arrive. The sender recorded it as sent |
| 2 — 30s | `connected=true`, **`outbox=0`** | Did not arrive. The sender recorded it as sent |
| 3 — 90s | `connected=false`, **`outbox=1`** | **Correctly queued.** Still in A's outbox at the end, so recoverable on reconnect |

One of the three arrived after foregrounding. A's outbox still holds one. So of
the two that did not arrive, **at most one is recoverable** — and **at least one
message was reported sent, with an empty outbox, and never existed anywhere
again.**

That is the correctness failure, not the UX one. `outbox=0` is the app
asserting it has nothing left to deliver.

### Why, and why it is familiar

This is Finding 16's shape, one layer down. `chat-service.js` already says it:

> *"`isOnline()` is a prediction, and predictions about a network are wrong. A
> transport can hold a connection it believes is live for as long as it takes to
> notice otherwise: QUIC needs a timeout…"*

Android suspends the peer's webview instantly; QUIC does not notice for tens of
seconds. In that window `publish()` writes into a connection that is dead and
not yet known to be dead, returns a non-zero count, and the outbox is never
involved. By 90 seconds the transport has caught up — which is exactly why the
third message queued correctly and the first two did not.

**`B webview was frozen — could not be queried while backgrounded.`** The
process stayed alive the whole time; it is the webview that is suspended. So
this is not something the app can paper over from JavaScript.

### What it means for beta

The driver's own framing, written before the result was known, is the right
one: *"push or a foreground service becomes mandatory before beta."*

Shipping as-is means a tester sends a message to someone whose phone is in a
pocket, sees it accepted, and it is gone. No error, no retry, nothing in the
outbox. For a messenger that is not a rough edge.

Options, none free:

1. **A foreground service** on Android to keep the socket alive. Costs a
   permanent notification, and Android 15/16 are strict about what qualifies.
2. **Push** — needs a server and an account model, which collides with the
   product's whole posture and with §1.
3. **Make the send path pessimistic**: treat a peer as unreachable unless it has
   been *heard from* recently, and queue rather than publish. Does not fix
   delivery, but converts silent loss into honest queueing — the message would
   arrive when both are foreground, which is what the product can currently
   promise anyway. This is app- and SDK-side, needs no infrastructure, and is
   the smallest change that removes the lie.
4. Ship with it, and say plainly that messages only move while both apps are
   open. Honest, and a poor messenger.

**Option 3 is the one worth doing first** regardless of what follows it: it is
independent of the others and makes the failure visible instead of silent.

### The test measured the SDK, not the app — re-run needed *(2026-08-24)*

`test-background.mjs` drives `window.__echoit`, which is the **bridge
harness**. Grepping `bridge-harness.ts` and `bridge-screen.tsx` for
`visibilitychange`, `focus`, `reconnect` and `sweep` returns **nothing**: it is a
bare SDK client with no recovery machinery whatever.

The real app has machinery the harness lacks:

- `reconnectKnownContacts` on launch and on return to foreground
- which produces the connection that `drainAfterReconnect()` flushes the outbox
  on
- and `beginSync`, whose CRDT document exchange is a second path by which a
  missed message can still arrive

**None of it ran.** So the verdict is sound for the SDK in isolation and
overstated as a claim about EchoIt. One further detail points the same way: the
sender stayed in the foreground for the whole run, so **its** sweep never fired,
and its cooldown is 30s while the test waited exactly 30s after foregrounding.

This does not make the finding wrong — a message the sender recorded as
`outbox=0` still did not arrive, and that part is real. It means **how much the
app recovers is unmeasured.** Re-run against the normal build before deciding
how much work Option 3 is; the answer could be anywhere from "nothing is lost,
only delayed" to the harness result.

Needs both phones.

### Priority for 0.1.0 — deprioritised, by decision *(2026-08-24)*

**Background delivery is explicitly out of scope for the beta.** The goal for
0.1.0 is two peers connecting and talking without hindrance; delivery to a
phone that is asleep in a pocket is a later problem. Recorded here so it is not
re-argued: this finding is **not** a 0.1.0 blocker.

**One part of it is still in scope, and it is not the same thing.** Two failures
were measured together and only one is about backgrounding:

| | |
|---|---|
| A backgrounded phone does not receive | **Out of scope.** Needs a foreground service or push, and the product can honestly say messages move while both apps are open |
| The sender records `outbox=0` for messages that never arrive | **In scope**, because it is not confined to backgrounding |

The second happens whenever the peer stops servicing the connection faster than
QUIC notices — the screen going off, the notification shade, switching apps for
ten seconds. Both people can consider themselves "in a conversation" and a
message still evaporates with the app reporting it sent. That is a hindrance to
two peers talking, which is exactly what 0.1.0 is for.

**Option 3 is therefore the beta-relevant half**: queue unless the peer has been
*heard from* recently, rather than trusting connection state. It does not
deliver to a sleeping phone and is not meant to — it turns silent loss into
honest queueing, so the message arrives when the other app comes back rather
than never. App- and SDK-side, no infrastructure, and independent of everything
else in this finding.

*(§5b's delivery ladder matters here too: with no status on a message, a lost
one and a delivered one look identical. The ladder is what would make this
visible to a user at all.)*

### Where the messages actually died *(investigated 2026-08-24)*

The verdict above says "lost". That is what was measured, but it does not say
*where*, and the difference decides whether this needs infrastructure or a bug
fix.

**The bytes may never have left our own process.** `iroh_bridge.rs:403`, the
inbound reader:

```rust
let _ = app.emit("iroh://data", DataEvent { conn_id: conn_id.clone(), data: B64.encode(&buf[..n]) });
```

Fire-and-forget, with the result discarded by `let _ =`. Rust reads bytes off
the QUIC socket, hands them to the webview, and if the webview cannot accept
them there is no buffer, no acknowledgement, and no error. **Nothing on the JS
side can recover a missed event either** — `tauri-bridge-pipe.ts`'s `subscribe`
just registers a `listen('iroh://data')` handler; a dropped event is gone.

The timeline fits. B's own event log has the connection alive from `09:32:04`
until `read error: connection lost` at `09:33:46` — about 102 seconds. Messages
1 and 2 went at 0s and +30s, comfortably inside that window, so B's transport
was still connected when they were sent.

### The unknown that decides everything — NOT YET MEASURED

**Was B's Rust actually running?** `test-background.mjs` checks `pidof`, which
proves the process *exists*, not that its threads are *scheduled*. Android's
cached-app freezer SIGSTOPs the **whole process**, not just the webview, and
vendor ROMs are more aggressive than AOSP. If the tokio runtime was frozen too,
a Rust-side queue buys nothing.

*(Raised by MACCO, and it was right — the earlier reading here overstated its
confidence. Worth recording that the objection was the useful part, not the
agreement.)*

**The experiment, which needs no code changes:**

1. Background the app.
2. Read `/proc/<pid>/stat` `utime`/`stime` at intervals.
3. **Still accumulating** → Rust threads run → the bytes reached Rust and our
   own `emit` discarded them → **fixable app-side, no server**: buffer inbound
   frames in Rust, drain on resume. The resume hook already exists —
   `AppContext`'s `visibilitychange` + `focus` sweep is where a drain would
   hang.
4. **Frozen** → nothing app-side helps, and it is a foreground service or push.

Run this **before** writing any buffering. Building a Rust-side queue that turns
out to be frozen alongside everything else is the expensive way to learn which
branch we are on.

### One tunable noticed while looking

The endpoint binds with `presets::N0` (`iroh_bridge.rs:170`), so keepalive and
idle-timeout are whatever iroh defaults to. Neither has been examined. They
govern how long a connection survives a backgrounded peer, and they are
configuration rather than architecture.

### Upstream request — SDK-8

`publish()` reports how many peers it wrote to, and a write into a
not-yet-timed-out QUIC connection counts. The count therefore means "bytes
handed to the transport", not "delivered", while `ChatService` uses it to decide
whether to queue.

Either the count needs to mean delivery — an acknowledgement — or `ChatService`
needs a separate signal to queue on. A liveness notion based on *last inbound
traffic* rather than connection state would be enough, and is cheap: the
transport already sees every frame.


### Finding 19 — every paired contact receives every conversation, in plaintext — ✅ **FIXED in SDK 0.4.0** *(found 2026-08-21, closed 2026-08-23)*

**Resolved by `chat.createChannel(channelId, participants)`**, which makes a
channel's guest list an authorization boundary on both the envelope and sync
paths, in both directions. Verified by re-running the test that found it:
Carol's copy of the channel went from 1 message to 0. Details in the 2026-08-23
entry. SDK-7 is closed by it.

The description below is kept as written, because the mechanism is what makes
the fix legible.

**Measured, not read.** `npx tsx harness/three-peer-privacy.mts`, three real
processes over real QUIC:

```
bob's copy of the channel   : 1 message(s) ["private-to-bob-1787324837174"]
carol's copy of the channel : 1 message(s) ["private-to-bob-1787324837174"]

FAIL — carol holds the plaintext of a conversation she is not part of.
```

Alice is paired with Bob and with Carol. Bob and Carol are strangers to each
other. Alice sends one message to a channel derived from Alice's and Bob's
did:keys. **Carol was never told that channel id and never wrote to it**, and
Carol ends up holding its plaintext.

### The chain, read directly

| Step | Code | Behaviour |
|---|---|---|
| 1 | `session-manager.js:61` | `beginSync` refuses unpaired peers — so **strangers are not the problem**. Contacts are |
| 2 | `sync-engine.js:100` | A root mismatch is answered with `generateAllDocumentMessages(peerId)` |
| 3 | `sync-engine.js:141` | That iterates `documents.listDocuments()` — **every local document** — with no reference to who the peer is |
| 4 | `sync-engine.js:127` | `handleSendDelta` calls `ensureSyncDocument(docId)`: a receiver **creates** any document a peer pushes, with no check that it should have it |
| 5 | `chat-service.js:307` | `recordLocally` writes `content` into the document **as plaintext** |

Step 5 is what makes this a disclosure rather than a metadata leak. The
transport is encrypted and the envelope path (`0x02`) is per-recipient; the
document path (`0x01`) carries the message bodies themselves.

`MembershipSyncEngine` (`core/dist/crdt/membership-sync.js`) already models
per-channel member sets. **`sync-engine.js` never references it** — zero matches
for "membership" in the file. This reads as wiring that was never completed
rather than a deliberate design.

### What it would cause if shipped

EchoIt's entire proposition is private 1:1 messaging. With two or more contacts
— the ordinary case, and the case beta testers will be in on day one — **every
contact silently receives every conversation you have, and can read it.** No
warning, nothing visible in the UI, and it is worse the longer the app is used
because sync is retroactive: a contact added today receives conversations held
before they existed.

This is not the same shape as Finding 16. That was a message failing to arrive.
This is a message arriving somewhere it should never have gone.

### Why no earlier test caught it

Every test to date used **exactly two peers.** With two peers, "sync everything
to every paired contact" and "sync this conversation to its participant" are the
same behaviour. The bug needs a third party to exist, and `PROGRESS.md` recorded
the identical blind spot for Finding 16 in almost the same words. **Two peers is
not enough to test a messenger** — `harness/three-peer-privacy.mts` exists so
that this class of defect has somewhere to be caught.

### Effect on M2.4

Channel-per-pair, derived from both did:keys, is the natural design and the one
M2.4 was going to use. **It cannot be built as the SDK stands.** Options, none
free:

1. **Upstream fix — correct, and blocking.** See SDK-7 below.
2. **Encrypt content in the app before `sendMessage`**, with a key only the pair
   holds, so a leaked document is ciphertext. The channel id still discloses
   *that* Alice talks to Bob (both did:keys are in it), plus timestamps and
   message counts — hashing the id reduces that but does not remove it. It also
   puts real cryptography in the app layer, which is what the SDK exists to
   provide, and doing it badly is worse than not doing it.
3. **One contact per tester for beta.** Unrealistic; rejected for the same
   reason under Finding 16.

### The leak has TWO paths, not one *(added 2026-08-21, after MACCO)*

The finding above describes the document-sync path (`0x01`). **The live send
path leaks the same way**, and the first write-up missed it. MACCO's challenger
raised it; verified directly afterwards.

`session-manager.js:83` — `publish()`:

```js
for (const peer of this.deps.peers.listPairedConnected()) {
    const envelope = sealMessage(payload, connection.sessionKey, epoch);
    sends.push(connection.send(StreamType.E2EE_MESSAGE, envelope));
}
```

Every paired, connected peer gets the message. **There is no channel filter** —
`payload.channelId` is never consulted. The receiver runs `ingestRemote`, which
writes it into the channel document and notifies listeners.

So a message reaches an uninvolved contact by whichever path is available:
immediately over `0x02` if they are online, or later by document sync over
`0x01` if they are not. Fixing only the sync engine would close the slower half
and leave the fast one open.

**This was already in this file and nobody drew the line.** The Finding 16
correction records *"`publish()` is a broadcast to all paired-connected peers
with no per-recipient targeting"* — written as a delivery-semantics detail to
explain why a peer catches up on reconnect. It is the same sentence as this
defect, read for a different purpose.

### Upstream request — SDK-7

`CrdtSyncEngine` must scope documents to peers entitled to them. Concretely:

- `generateAllDocumentMessages(peerId)` (`sync-engine.js:141`) should filter
  `documents.listDocuments()` by a per-document participant set rather than
  offering all of them. `MembershipSyncEngine` already holds that set.
- `handleSendDelta` (`sync-engine.js:127`) needs the mirror check. Filtering
  only the send side still lets a peer **push** a document into someone who
  should not hold it, and `ensureSyncDocument` will happily create it.
- `stateRoot()` is computed over the whole manager, so two peers who share one
  channel out of several will always mismatch and always fall through to the
  document loop. A per-peer or per-document root would make the common case
  cheaper as well as correct.

**And `SessionManager.publish` must take the channel's participants too**
(`session-manager.js:83`). It currently fans out to `listPairedConnected()`
without reading `payload.channelId`. A sync-side fix alone leaves this open.

Until this lands, a channel is effectively readable by every paired peer, and
that should be stated in the SDK's documentation — the current wording implies
per-channel scoping.

### Why option 2 (encrypt in the app) is not the shortcut it looks like

`@dicsussion/core` does export `./crypto` publicly, so the primitives are
reachable without breaking the boundary rule. **The key is not.**
`client.d.ts:134` exposes `encryptionPublicKey` and nothing else; identity
secrets are derived inside `init()` from a seed the app never holds, exactly as
`create-client.ts` describes. App-layer encryption would therefore mean
inventing a second keypair and a second key exchange, carried in the ticket or
in pairing, and shipping it under a deadline. New cryptography written in a
hurry is a worse outcome than a delayed feature.

It would also only mask the content: both fan-out paths still deliver to every
contact, so message counts, timing, and the channel id — which carries both
did:keys — continue to leak the social graph.


### Finding 18 — the relay and discovery servers are undisclosed, and unchosen — 🔴 **OPEN** *(found 2026-08-21)*

`PRODUCT.md` §1 states the product's most load-bearing sentence:

> *"The only thing EchoIt asks a server is whether there's a new version.
> Everything else goes straight between your device and theirs."*

§1 calls this *"deliberately checkable — anyone can watch the network and
confirm it."* Watching the network does not confirm it.

**The word "relay" appears zero times in `PRODUCT.md`.** It appears throughout
the code: every ticket embeds a relay URL, `bridge-harness.ts:119` waits for
*"STUN and the relay"* before a ticket can be built, `status()` reports
`relayed=`, and `ProfileTab` renders **"Connected (Relay)"** as a live state.

**What is actually running.** `src-tauri/src/iroh_bridge.rs:170` is
`Endpoint::builder(presets::N0)`, and the next line is `endpoint.online().await`
— which blocks until that infrastructure answers, on every launch. Read from
`iroh-1.0.3/src/endpoint/presets.rs`, the preset wires two n0 services:

| Service | Endpoint | Contacted |
|---|---|---|
| Relay (introduction; carries traffic only on fallback) | `use1-1` / `usw1-1` / `euc1-1` / `aps1-1` `.relay.n0.iroh.link` | Every launch |
| Discovery — **publishes** this device's ID and addresses | `https://dns.iroh.link/pkarr` | Every launch |

Nobody chose this; it is the library default.

**What it does *not* mean.** The hardware measurements stand. Every test
reported `relayed=false`, which means messages went device to device and no
server carried them. Hole punching worked. Encryption is unaffected — a relay
cannot read end-to-end encrypted content.

**What it does mean.**

1. **The §1 claim is false as written**, and false in the one way §1 itself
   warns about: *"a small false claim is what makes people doubt the large true
   ones."* Number 0 can see a device ID, an IP, and roughly when someone is
   online. Whether they can also observe which device IDs reach for each other
   at setup is likely but **not verified here**.
2. **It is an availability dependency.** If n0 retires or rate-limits those
   relays, EchoIt cannot introduce peers and new connections stop working.
   There is no arrangement with them.

**Fix, in two halves.** The urgent half is copy — §1 and §4 need to describe the
connection helper honestly. Rule #4 makes the exact wording the user's to set,
so what follows is a **draft awaiting approval, not an applied change.** §1 is
untouched.

> **Draft replacement for the §1 claim**
>
> *"Two phones have no fixed address, so EchoIt uses a connection helper to
> introduce your device to your friend's. After the introduction, messages go
> straight between you. If a direct path can't be made, the helper passes the
> encrypted messages along — it can never read them. The only other server
> EchoIt talks to is the one it asks whether there's a new version."*
>
> **Draft replacement for the §4.3 Settings line** — currently *"It's the only
> time the app talks to a server"*, which is false and is **omitted** from the
> shipped UI rather than reworded:
>
> *"EchoIt asks GitHub once a day whether a newer version is available. It sends
> nothing about you or your conversations."*

Both drafts hold to §3's no-jargon rule (no "relay", no "NAT", no "hole
punching") and neither makes an absolute claim. Whether the helper is Number 0's
or ours changes the honest wording again, so this is worth settling **with** the
Phase 7 decision rather than before it.

The unhurried half is owning the infrastructure — specified as **Phase 7** in
`IMPLEMENTATION_PLAN.md`, with a provider study. Explicitly not beta work: every
direct-connection measurement in this file was taken through n0's introducers,
and swapping them invalidates all of it.

**Do not describe anything we host as "zero knowledge."** True of content, false
of metadata, and §4.2 forbids claiming protection we do not have.


### Finding 17 — a unilateral contact reports "Connected directly" — 🔴 **OPEN** *(found 2026-08-21)*

Found while producing a real knock to test the requests dot.

Instance B added instance A's ticket through Add Contact. A never added B back —
textbook `PRODUCT.md` §5 **State 1, Unilateral — Waiting for Them**. B's contact
row rendered:

> **Connected directly**

That is §5 **State 3**, the copy reserved for *bilateral* pairing, whose
explanatory line is *"Messages are moving safely, directly between your
phones."* State 1's required copy is *"Waiting for [Name] to connect back."*

**What it would cause if shipped.** This is the exact failure §5 was written to
prevent, quoted from its own opening: *"if only one person adds the other's
ticket, the dialing device shows 'connected' but messages will never be
delivered to the other side."* The transport genuinely is connected — that half
is not a lie — but the user is shown the state that means "you can talk now"
while the protocol drops everything they send. §5b compounds it: State 1 is
supposed to force outbox entries to **`Staged`**, never `Sent`, and to disable
the composer. Once the composer is wired, a user in this state would type into
an enabled box, watch messages appear sent, and be silently unheard.

Not fixed here — a different screen and a different rule from the badge, and
folding it in would have buried it inside an unrelated change.


### Finding 1 — SDK packaging — ✅ **RESOLVED 2026-08-05**

Was: no `package.json` under `packages/*`, root private with no entry point, so
`@dicsussion/sdk` could not be installed and the no-deep-imports rule was
unenforceable.

Now: `@dicsussion/sdk` and `@dicsussion/core` are real packages with `exports`
maps, and npm workspaces are configured. EchoIt can depend on them properly and
the boundary rule is enforceable.

---

### Finding 2 — Ticket codec ergonomics — 🔽 **DOWNGRADED**

`encodeTicket` / `decodeTicket` / `PeerTicket` are still absent from
`@dicsussion/sdk`'s public surface. But `@dicsussion/core` now exposes a
`./transport` entry point that exports them, so this is a **supported path**,
not a reach into internals — the app depends on two packages instead of one.

Combined with D2 (QR deprioritized), this stops being a blocker. Still worth an
upstream ergonomics request eventually, since `client.connect()` takes a
`PeerTicket` and every consumer must move one between devices somehow.

**One UX consequence survives regardless of QR.** The ticket embeds *live direct
socket addresses* — confirmed in the smoke test, which published a LAN IPv4 and
two IPv6 addresses. Those go stale when a device changes network. Any pairing
flow must tolerate a ticket whose addresses no longer dial and fall back to the
relay path rather than failing outright.

---

### Finding 3 — No iOS binary for Iroh — ⚠️ **DROVE D1**

`@number0/iroh` v1.1.0 publishes NAPI prebuilts for macOS arm64, Windows
x64/arm64, Linux x64/arm64/armv7, and **Android arm64 + armv7**. There is no
`aarch64-apple-ios` or `aarch64-apple-ios-sim` target — `aarch64-apple-darwin`
is macOS desktop, not iOS.

This is the finding that decided the runtime. See D1. It is resolved by
architecture rather than by a fix: under Tauri, Iroh is a Rust crate and the
missing NAPI binary is irrelevant.

---

### Finding 4 — ZK proofs on the message path — ✅ **RESOLVED 2026-08-05**

Was: `sendMessage` and `ingestRemote` both hardcoded `proofValid: true`, no
proof was generated, none verified, and `ZekPocProver` was never called from the
SDK package.

**Verified fixed this session.** `verifyRlnSignal` (`client.ts:714`) now
rejects:

- a missing RLN share,
- a message index outside the rolling-window quota,
- malformed field elements,
- **a message that omits its proof on a channel that requires one**
  (`client.ts:736-745`) — this closes the strip-the-proof bypass, which was the
  one that mattered,
- a proof present but failing verification.

`ingestRemote` throws *before* `recordLocally`, so a rejected message never
lands. Proof policy is per-channel (`groups.requiresProofs`), not per-node
config, so a receiver cannot weaken enforcement by changing its own settings.
The protocol's suites 3.3 and 3.4 cover this path; typecheck is clean.

**Remaining nuances, none blocking:**

- `zkProofs` defaults to `'off'`, and the only other value is `'anonymous'` — so
  identified (`did:key`) messages never carry a proof. **This is the correct
  design**: you rate-limit an identified sender by identity, and RLN exists for
  the anonymous case where you cannot. It is the master prompt's *"every message
  carries a proof"* phrasing that is inaccurate, not the code. **Do not repeat
  that phrasing in user-facing copy.**
- `verifiedTier` is hardcoded 0 and quota is always computed at tier 0, so WoT
  tiers do not yet raise quotas. Acknowledged in-code.
- `getHistory` still hardcodes `proofValid: true` and drops `zkProof`, so
  replayed history cannot distinguish "verified against a proof" from "no proof
  required" — the exact conflation `ingestRemote` added `zkProof` to solve.
  Cosmetic, since invalid messages are never stored.

---

### Finding 7 — Webview bundling: three upstream blockers, measured — 🔴 **BLOCKS S0**

*2026-08-05. Established empirically by bundling the SDK with Vite, not by
reading code.* A throwaway probe (`src/probe.ts`) imports `DicsussionClient`
and the ticket codec exactly as the app will; `vite build` then reports what
actually reaches the bundle. Re-run instructions are in the file.

**Solved on EchoIt's side** (committed in `vite.config.ts`):

| Problem | Fix |
| :--- | :--- |
| Automerge ships WASM; Rollup cannot embed it natively | `vite-plugin-wasm`, with `build.target: "es2022"` for its top-level await |
| `node:events` | Aliased to the `events` polyfill — faithful, EventEmitter behaves normally |
| `@number0/iroh` unresolvable | Aliased to `src/shims/unavailable.ts`. The SDK already imports it *dynamically* (`iroh-transport.ts:144`) and that was deliberate — but Rollup still resolves dynamic imports at build time, so it must resolve to something. Dead code here: Iroh lives in Rust. |
| `node:dgram` | Same stub. mDNS stays disabled. |

`vite-plugin-top-level-await` was deliberately **not** used: its dependency tree
pulls a vulnerable `uuid` and fails `npm audit`, which our own rules forbid.
Targeting ES2022 gets top-level await natively instead.

**Not solvable here — these are upstream, in `@dicsussion/core`:**

1. **AES-GCM via `node:crypto`** — `crypto/encryption.js:22,48` uses
   `createCipheriv`/`createDecipheriv`, which are **synchronous**. WebCrypto's
   equivalent is async, so no shim can bridge them. A sync pure-JS backend
   (`@noble/ciphers`, already in the noble family the project uses) is the way
   out. *Medium effort, mechanical.*

2. **RSA-2048 keygen via `generateKeyPairSync`** — `crypto/blind-signature.js:79`,
   reached from `identity-service.ts:142` during **identity creation**, which
   runs on every first `DicsussionClient.init()`. So this is on the S0 path, not
   an optional WoT extra. WebCrypto cannot substitute: its RSA generation is
   async and does not expose the raw private exponent the blind-signature math
   needs. *Hardest of the three.* Options: a pure-JS RSA keygen, or make blind
   keypair generation lazy and async so it never runs unless vouchers are used.

3. **Storage — `SQLiteDriver` hardcoded** (SDK-1, already recorded). Confirmed
   by the probe: `better-sqlite3` is pulled into the bundle graph and its
   `node:fs`/`path` imports get externalized.

**What this means for the plan.** S0 cannot pass until 1, 2, and 3 land
upstream. That is now the critical path — not the Tauri work, which scaffolds
and builds cleanly today. Sequencing the upstream fixes first is the difference
between S0 taking a day and taking a week of workarounds that get thrown away.

**Verified working today:** repo scaffolds, installs, typechecks (`tsc --noEmit`
exit 0), builds (`vite build` exit 0), and `npm audit` is clean — with the probe
unwired. The probe is what fails, and it fails for exactly the three reasons
above.

---

### Finding 8 — npm migration: three dev-mode resolution failures — ✅ **RESOLVED 2026-08-12**

Moving from local `file:` paths to published `@dicsussion/*@0.1.0` surfaced
three distinct failures **that only appear in `vite dev`, never in
`vite build`**. Each was invisible until the one before it was fixed, and none
could have been caught by the earlier browser-based S0 run.

The common cause: while the packages were symlinked, npm links are served as
source. Registry packages get pre-bundled by esbuild instead, which is a
completely different resolution pipeline from Rollup's.

| # | Failure | Fix |
| :--- | :--- | :--- |
| 1 | `Export 'import_datagram_socket' is not defined in module` | `optimizeDeps.exclude` for both `@dicsussion` packages — esbuild does not apply `resolve.alias` |
| 2 | `crc-32 does not provide an export named 'default'` | `optimizeDeps.include` for `crc-32`, `lz4js`, `poseidon-lite` — excluding the SDK also stopped CJS→ESM conversion for its CommonJS deps |
| 3 | `does not provide an export named 'clearDatagramBuses'` | Rebuilt `src/shims/unavailable.ts` from the barrels' actual re-export lists; 0.1.0 exports four names the local build did not |

**Lesson worth keeping: `vite build` passing is not evidence that `vite dev`
works, and vice versa.** Both belong in the verification loop from here on.

**One self-inflicted regression, recorded because the distinction is subtle.**
While rebuilding the shim I made `resolveArtifacts()` throw, applying a
"fail loudly" rule too broadly. It is *designed* to return `null` in any
non-Node runtime, and `client.js` reads `null` as "no artifacts, skip ZK" — so
throwing broke `DicsussionClient.init()` outright even with `zkProofs: 'off'`.
Its sibling `requireArtifacts()` genuinely throws by contract.

The rule now written into the shim: **a stub may return a value only when that
value is one the caller is designed to receive.** Compare `isDevelopmentCeremony`,
where `false` means "safe to proceed" — there the benign-looking return is the
lie, and throwing is correct.

---

### Finding 10 — `browser: false` cannot satisfy named re-exports — ✅ **RESOLVED upstream in 0.1.1**

`@dicsussion/core@0.1.1` and `@dicsussion/sdk@0.1.1` replaced the
`browser: false` mappings with **`browser` export conditions pointing at real
variant barrels**:

| Package | Condition target |
| :--- | :--- |
| `@dicsussion/core/transport` | `dist/transport/index.browser.js` |
| `@dicsussion/core/zk` | `dist/zk/index.browser.js` |
| `@dicsussion/sdk` (root) | `dist/browser.js` |
| `sdk/dist/engine-bootstrap.js` | `engine-bootstrap.browser.js` |

The variants export the same names as throwing stubs, mirror the constants
that lived inside Node-only modules (`CONTROL_STREAM_TAG = 0x00`,
`DICSUSSION_ALPN`, `STREAM_PRIORITY`, `MDNS_*`), and are guarded by
`tests/transport/browser-barrel-parity.spec.ts` so the duplication cannot
silently drift. They also adopt the `resolveArtifacts` → `null` /
`isDevelopmentCeremony` → throw distinction for the same reason we did.

**Effect here:** `vite.config.ts` went from **19 aliases to 2** — only the
`events` and `buffer` polyfills remain — and `src/shims/unavailable.ts` is
deleted. Verified in **both** pipelines, since build and dev use different
resolvers: `vite build` exit 0, and S0 in the Tauri webview reports
`PASSED tauri=true priorRuns=5 init=71.7ms`.

---

### Finding 14 — `iroh` 1.0.3 does not compile alongside Tauri 2 on Windows — 🔴 **BLOCKS S1b (Rust half)**

Adding `iroh = "1.0.3"` to `src-tauri` fails the build at 564/588 crates:

```
error[E0277]: the trait bound `IWbemObjectSink: windows_core::Interface` is not satisfied
error[E0277]: the trait bound `QuerySink_Impl: core::unknown::IUnknownImpl` is not satisfied
```

**The failure is not in iroh.** It is a dependency-resolution conflict:

```
wmi 0.18.4 ← netwatch 0.19.1 ← iroh 1.0.3
                             ← portmapper 0.19.1 ← iroh 1.0.3
```

`wmi 0.18.4` declares **both** of these with the same wide range:

```toml
windows      = ">=0.59, <0.63"
windows-core = ">=0.59, <0.63"
```

A range spanning semver-*incompatible* 0.x versions lets cargo satisfy the two
independently. Tauri pins `windows-core 0.61.2` through `tao` and
`webview2-com`, so cargo unified wmi's `windows` down to **0.61.3** while its
`windows-core` resolved to **0.62.2**. `IWbemObjectSink` then comes from the
0.61 tree and `Interface` from the 0.62 tree, and the bound cannot hold.

Without Tauri in the graph cargo would pick `windows 0.62.x` for wmi and it
would compile — which is why this is specifically a **Tauri + iroh** conflict
rather than a plain iroh bug.

**Attempted and rejected:** adding a direct `windows = "0.62"` dependency does
not help. Cargo reuses the `0.61.3` already in the graph because it satisfies
wmi's range; a second version does not force re-unification.

**No feature flag avoids it.** `wmi` is a mandatory
`cfg(target_os = "windows")` dependency of `netwatch`, and `netwatch` is a
mandatory dependency of `iroh`. Disabling iroh's `portmapper` feature removes
one path to it but not the direct one.

**Current state:** `iroh` has been removed from `src-tauri/Cargo.toml` so the
app builds and S0 stays reproducible. The repository is left working, not
half-migrated.

**RESOLVED 2026-08-12 via `[patch.crates-io]`.** iroh 1.0.3 now compiles
inside Tauri (1m 49s, binary 13.1 MB). Everything cheaper was tried first and
failed for a specific, recorded reason:

| Attempt | Outcome |
| :--- | :--- |
| Older iroh (0.93.2) | ❌ Clears `wmi`, then fails on `ed25519-dalek 3.0.0-pre.1` — `pkcs8::Error::KeyMalformed` went from a unit to a tuple variant. iroh 0.93.2 *requires* that pre-release, so it cannot be pinned to stable 2.x |
| `cargo update -p windows-core --precise 0.61.2` | ❌ `netwatch` requires `windows ^0.62.2`, which needs `windows-core 0.62.x` — it will not go down |
| Forcing `windows` up to 0.62 | ❌ Tauri's `tao` requires `^0.61` — it will not go up. The graph is pinned from both ends with `wmi` in between |
| Adding a direct `windows = "0.62"` dep | ❌ Cargo reuses the `0.61.3` already in the graph; a second version does not force re-unification |
| Disabling iroh features | ❌ `netwatch` is a mandatory, unfeatured dependency of `iroh` |

Also checked: iroh **1.0.0 through 1.0.3 all show the identical split**, and all
use `ed25519-dalek 3.0.0-rc.0`, which compiles. On the 1.0.x line `wmi` is the
only blocker.

**The patch is exactly two version strings.** `src-tauri/vendor/wmi` is
`wmi 0.18.4` with `">=0.59, <0.63"` → `"0.62"` for both `windows` and
`windows-core`, and nothing else changed. `Cargo.toml` carries the diagnosis
and the removal condition.

**Two caveats, deliberately not hidden:**

- It puts 391 KB / 7.5k lines of third-party source in the repo. `vendor/` must
  be committed — `[patch]` resolves by path, so a fresh clone will not build
  without it. Verified it is not caught by `.gitignore`.
- **`[patch.crates-io]` applies only to the root manifest.** It fixes *our*
  build and does nothing for any downstream consumer. This is a workaround with
  an expiry date, not a fix.

**Still worth reporting upstream** for that second reason: `wmi` floating
`windows` and `windows-core` independently across incompatible majors will hit
every Tauri user who touches iroh. The ranges should move together. Not filed —
opening an issue on a third-party repo is outward-facing and needs an explicit
go-ahead.

Worth noting this is independent of Finding 13. Even with the Rust side
compiling, the TypeScript side still cannot construct a wire-compatible
`ITransport`. **S1b needs both resolved.**

---

### Finding 13 — A custom `ITransport` cannot be built from the public API — ✅ **RESOLVED in SDK 0.2.0**

`createBridgedTransport(pipe, options)` shipped, exported from **both** barrels
including the browser one. The handshake, session-key derivation, framing, and
priority all stay inside the SDK — nothing security-critical was pushed onto
consumers, which was the whole argument.

The shipped `BridgePipe` is **flat and connection-id keyed** — `connect`,
`send`, `onData`, `onInbound`, `onClosed`, `disconnect`, `close` — rather than
the per-connection pipe objects we had sketched. That maps almost 1:1 onto the
Rust commands already built, so adapting *removed* code from our side.

Two things we asked for landed as asked: the docs state the byte-stream
contract explicitly (*"a host may split one `send` across several `onData`
calls, or coalesce several sends into one; both are correct"*), and
`BridgeInbound.unverifiedTransportId` keeps a host from being asked for a
`did:key` it cannot know.

`src/transport/tauri-bridge-pipe.ts` implements it and typechecks against the
real types.

**One gap remains, fixed in 0.2.1:** `createBridgedTransport` needs the identity
keypair, but `DicsussionClient.init()` derives the identity internally and
`ClientRuntimeOptions.transport` accepts an already-constructed instance —
chicken and egg. A transport *factory* form (`transport: (identity) => ITransport`)
resolves it and is confirmed to be landing in 0.2.1.

---

### Finding 13 (original) — A custom `ITransport` cannot be built from the public API

The Tauri bridge was designed so Rust owns a dumb Iroh byte pipe while
TypeScript performs the RFC 001 §5 handshake using core's own browser-safe
primitives — reusing tested protocol code instead of reimplementing it. Most of
what that needs *is* browser-safe: `frame-codec`, `frame-reader`, `handshake`,
`priority-queue`, `transport-key`, `compression`, `ticket-codec`. Only the two
NAPI wrappers are mapped out.

**But the barrel withholds exactly the symbols the handshake needs.**
`handshake.js` exports 12 symbols; `transport/index.js` re-exports 9. Reading
`iroh-transport.js` `setUpDialer()` — the reference implementation — a
wire-compatible dialer requires:

| Symbol | Source | Exported? |
| :--- | :--- | :--- |
| `createHandshakeInit`, `verifyHandshakeChallenge`, `createHandshakeAck`, `calculateClockOffset`, `processHandshakeInit`, `verifyHandshakeAck` | `handshake.js` | ✅ |
| **`deriveSessionKey`** | `handshake.js` | ❌ |
| **`transcriptFor`** | `handshake.js` | ❌ |
| **`HandshakeTag`** | `handshake.js` | ❌ |
| **`encodeControlJson` / `decodeControlJson`** | `json-bytes.js` | ❌ — module not re-exported at all |
| **`readStreamTag`** | `iroh-connection.js` | ❌ |
| `CONTROL_STREAM_TAG` | `iroh-connection.js` | ⚠️ re-exported, but sourced from a browser-mapped-out module, so in a browser build it resolves to our shim rather than the real `0x00` |

`deriveSessionKey` is not optional: `IrohConnection` takes a `sessionKey` and
zeroes it on close, so without it no wire-compatible connection exists.

**We are not reimplementing these.** Session-key derivation and transcript
binding are security-critical and must be byte-exact — an approximation
reconstructed from `dist/` would appear to work against our own code while
being wrong, or insecure, against a real peer. That is precisely the kind of
"reach into internals as a workaround" `AGENT_INSTRUCTIONS.md` §2 forbids.

**Two ways upstream could unblock this, in order of preference:**

1. **Export a bridged-transport factory** — something like
   `createBridgedTransport(pipe)` in `@dicsussion/core/transport`, where `pipe`
   is an abstract bi-directional byte channel. Any non-Node host needs exactly
   this: Tauri, React Native with a Rust core, Electron. It keeps the handshake
   inside the SDK where it is tested, and consumers supply only transport.
2. **Export the missing primitives** — `deriveSessionKey`, `transcriptFor`,
   `HandshakeTag`, the two `json-bytes` helpers, `readStreamTag`, and a
   browser-safe `CONTROL_STREAM_TAG`. Cheaper for upstream, but it pushes
   security-critical sequencing onto every consumer.

**Not blocked meanwhile:** the Rust half — endpoint lifecycle, ALPN, bi-stream
open/accept, and the IPC surface — is required under either resolution and is
being built now. It also settles a separate unknown: the `iroh` crate has never
been compiled into this Tauri app.

*(Aside: our shim guessed `CONTROL_STREAM_TAG = 0`, and the real value is
`0x00`. Correct by luck, not by knowledge — another reason not to reconstruct
protocol constants from the outside.)*

---

### Finding 12 — SDK types reference `better-sqlite3` without depending on its types — ⚠️ **UPSTREAM**

`@dicsussion/sdk` ships declaration files that import `better-sqlite3` types:

```
sdk/dist/storage/sqlite-driver.d.ts(7,22): error TS7016:
  Could not find a declaration file for module 'better-sqlite3'
sdk/dist/storage/migrations.d.ts(7,27): error TS7016: (same)
```

`better-sqlite3` ships no bundled types, and the SDK does not depend on
`@types/better-sqlite3`, so **every TypeScript consumer of the root entry
fails to typecheck** unless they install it themselves or hide the problem
with `skipLibCheck`. Consumers of `@dicsussion/sdk/browser` are unaffected,
since that entry never reaches the SQLite driver.

Fix upstream by adding `@types/better-sqlite3` as a dependency (not a
devDependency — it is needed to consume the published types). EchoIt installs
it directly for now.

Found only because `harness/` was brought under typecheck; it had been
invisible while the harness ran unchecked.

---

### Finding 11 — Chat content at rest is NOT encrypted — 🔴 **PRODUCT DECISION NEEDED**

Documented in the 0.1.0 migration notes: *"`storageKey` protects identity
secrets; message bodies and Automerge snapshots are stored directly."*

So `storageKey` — which the SDK now mandates — protects the identity seed, not
the conversations. Anyone with filesystem access to the device reads message
history in the clear.

**This sits directly against `AGENT_INSTRUCTIONS.md` §3.4** ("no plaintext
message content on disk outside the SDK's encrypted store"), because it turns
out the SDK's store is not encrypted for bodies. It also constrains what EchoIt
may claim: *"your messages stay on your phone"* remains true, but any stronger
implication that they are protected *on* the phone would not be.

Not a blocker for S1/S2. It **is** a blocker for marketing copy, the eventual
threat-model write-up, and any "your data is safe if you lose your phone"
claim. Options: accept and disclose plainly; encrypt at the app layer before
handing content to the SDK; or request at-rest encryption upstream.

Two related limits from the same notes, recorded so they are not rediscovered
the hard way:

- **Replicated CRDT changes are not individually authenticated.** Only paired
  peers can write, but a peer you later block can still have written arbitrary
  state — removing them from the UI does not retroactively invalidate it.
  Relevant when block/report is built (M4.3.4).
- **The WebSocket relay does not encrypt CRDT traffic.** Irrelevant to us —
  EchoIt uses Iroh/QUIC — but recorded so nobody later adds a WebSocket
  fallback "for flaky networks" and silently surrenders the protocol's main
  property.

---

### Finding 9 — Published package ships a vulnerable transitive dep — ⚠️ **UPSTREAM**

`npm install @dicsussion/sdk@0.1.0` brings 3 high-severity advisories:

```
@dicsussion/sdk → @dicsussion/core → snarkjs@0.7.6 → bfj → jsonpath → underscore@1.13.6
```

`underscore <=1.13.7` is GHSA-qpx9-hpmf-5gmw (unbounded recursion → DoS).

The protocol repo already carries `"overrides": { "underscore": "^1.13.8" }`
at its own root — but **npm `overrides` apply only from the root project and
do not reach consumers**, so every downstream consumer inherits the
vulnerability and must repeat the override. EchoIt now does; audit is clean.

Upstream should bump `snarkjs`, or document the required override in the
install instructions.

---

### Finding 10 — `browser: false` cannot satisfy named re-exports — ⚠️ **UPSTREAM**

`@dicsussion/core` and `@dicsussion/sdk` map Node-only modules to `false` via
the `browser` field. Under Rollup that substitutes an **empty** module — but
their barrels re-export named symbols from exactly those modules:

```js
core/dist/transport/index.js: export { DICSUSSION_ALPN, IrohTransport } from './iroh-transport.js';
core/dist/zk/index.js:        export { requireArtifacts, resolveArtifacts } from './artifact-paths.js';
sdk/dist/engine-bootstrap.js: import { SQLiteDriver } from './storage/sqlite-driver.js';
```

An empty module has no named exports, so resolution fails before anything can
yield `undefined`. The SDK's own guard (`typeof SQLiteDriver !== 'function'`)
assumes a bundler behaviour Rollup does not provide.

`@dicsussion/sdk/browser` only fixes the SDK barrel; `core/transport`,
`core/zk`, and `engine-bootstrap` still require consumer-side named-export
stubs. Any consumer bundling for a browser hits this. A browser-specific
subpath for `core/transport` and `core/zk`, or stub modules exporting the same
names, would remove the need.

---

### Finding 5 — Strategy doc and master prompt disagree on browsers

`ECHOIL_APP_STRATEGY.md` lists "Works everywhere: Desktop, mobile, web browsers"
as a product pillar. The master prompt says browsers are out of scope for
EchoIt, with the SDK remaining browser-usable for third parties.

**Resolved in favour of the master prompt.** Recorded so the next reader does
not inherit the ambiguity. Mildly ironic given D1 — the SDK will now run in a
webview regardless, but inside a native app shell, not as a website.

---

### Finding 6 — Protocol-side risks EchoIt inherits

- ~~**The trusted setup is single-party and development-only.**~~ ✅ **RESOLVED
  2026-08-11.** The ceremony completed with six parties, and the proving key
  shipped in `@dicsussion/core@0.1.0` is the real output. **This removes the
  absolute gate on public release.** `allowDevelopmentCeremony` is now dead
  config — we never passed it, so there was nothing to delete, and it must not
  be introduced: if a future build ever picked up a development key, that flag
  is exactly what would let it through silently. Record:
  https://github.com/mrsarthi/Ceremonial-Contributions
- **RFC 003's "sub-50 ms prover on WASM" is unachievable** — measured ~1.1 s at
  5,307 constraints. A native prover is the path to sub-100 ms. Relevant to
  mobile if per-message proving is ever enabled.

---

## Upstream requests for DicsussionProtocol

### SDK-1 — Storage driver is not selectable *(blocks S0)*

`initStorage` in `packages/HLessEnd/src/engine-bootstrap.ts:58` hardcodes
`new SQLiteDriver(storagePath)`. `IndexedDbDriver` exists and is exported from
`storage/index.ts`, but there is no way to reach it through
`DicsussionClient.init()`. `initIdentity` and the `client.ts` storage fields are
also typed to the concrete `SQLiteDriver` rather than the `IStorageDriver`
interface.

**Why it blocks:** `better-sqlite3` is a Node NAPI module and cannot load in a
webview. Without this seam the Tauri build has no way to persist anything, and
S0 cannot start.

**The change is mechanical.** Surveyed 2026-08-05: `SQLiteDriver` appears as a
*concrete type* in exactly five places, and the only method it adds beyond
`IStorageDriver` is `getDatabase()`, which **has no callers outside the driver
itself**. Nothing in the SDK depends on SQLite-specific behaviour, so widening
is a type change rather than a refactor.

| Location | Change |
| :--- | :--- |
| `engine-bootstrap.ts:29` | `readonly driver: SQLiteDriver` → `IStorageDriver` |
| `engine-bootstrap.ts:58` | Accept an injected driver; default to `new SQLiteDriver(storagePath)` |
| `engine-bootstrap.ts:78` | `storage: SQLiteDriver \| null` → `IStorageDriver \| null` |
| `client.ts:48` | Import `IStorageDriver` instead of `SQLiteDriver` |
| `client.ts:111` | `private storage: SQLiteDriver \| null` → `IStorageDriver \| null` |

Then add the seam to `ClientRuntimeOptions`, mirroring `transport` (which
already accepts `'local' | 'iroh' | ITransport`):

```ts
/** Storage backend. Defaults to SQLite; pass a driver for non-Node hosts. */
readonly storage?: IStorageDriver;
```

`IndexedDbDriver implements IStorageDriver` already, and its constructor takes
`{ databaseName?, factory? }` — so the webview call becomes
`DicsussionClient.init({}, { storage: new IndexedDbDriver(), transport })`.

**Risk:** low. No behaviour changes for existing Node callers, and the
protocol's suite should stay green unchanged.

### SDK-2 — ZK artifact loading is filesystem-bound *(needed before proofs on mobile)*

`packages/core/src/zk/artifact-paths.ts` and `zk/prover.ts` load the zkey and
wasm via `node:fs` / `node:path` / `node:url`. A webview must fetch them as
bundled assets. Not on the spike path (`zkProofs: 'off'`), but required before
anonymous messaging works in the app.

### SDK-3a — AES-GCM must not require `node:crypto` *(blocks S0)*

`packages/core/src/crypto/encryption.ts` uses `createCipheriv` /
`createDecipheriv`, which are **synchronous**. WebCrypto's AES-GCM is async, so
this cannot be shimmed — a sync implementation is required.

**Needed:** back it with `@noble/ciphers` (`gcm`), which is sync, pure JS, and
from the same family as the `@noble/curves` / `@noble/hashes` the project
already depends on. `randomBytes` → `crypto.getRandomValues`; `createHash` →
`@noble/hashes`. Mechanical, and it removes the Node dependency for
`transport/handshake.ts` and `crdt/state-root.ts` at the same time.

*Measured, not assumed — see Finding 7.*

### SDK-3b — RSA keygen runs on first init and cannot run in a webview *(blocks S0)*

`crypto/blind-signature.ts:79` calls `generateKeyPairSync('rsa', …)`, reached
from `identity-service.ts:142` during identity creation — so it fires on the
**first `DicsussionClient.init()` of every install**, not only when vouchers are
used. WebCrypto cannot substitute: its RSA generation is async and does not
expose the raw private exponent the blind-signature math needs.

**Two ways out, and the choice is the SDK's to make:**

- *Make it lazy.* Generate the blind keypair on first voucher use rather than at
  identity creation, and allow it to be async. Keeps identity creation cheap on
  every platform — arguably the better design regardless of EchoIt, since most
  users may never issue a voucher.
- *Pure-JS RSA keygen.* Works everywhere but is slow (prime search) and adds a
  dependency doing security-critical bignum work.

We would prefer the lazy option, but it changes SDK semantics, so it is a
protocol decision rather than an app one.

### SDK-4 — Ticket codec ergonomics *(low priority)*

Re-export `encodeTicket`, `decodeTicket`, `TICKET_PREFIX`, and `PeerTicket` from
`@dicsussion/sdk`. Workaround exists via `@dicsussion/core/transport`.

### SDK-5 — Fix the browsers line in `ECHOIL_APP_STRATEGY.md` *(doc)*

---

## Housekeeping

- **This directory is named `Dicsussion-Rewrite`, but the project is EchoIt.**
  EchoIt is not a rewrite of the protocol — it is an application on top of an
  unmodified one. Renaming is cheap now and awkward once remotes and CI exist.
  Left alone pending a decision, since it is the user's to make.
- Standing documents live in `.agents/`. `README.md` and `.gitignore` are at the
  repository root.
- Git initialised on `main`. No commits yet, no remote configured.

---

## Next session starts here

*Rewritten 2026-08-19. The spike is over, the gate is open, and the app shell +
onboarding are built and audited. What follows is the road through Phase 2.*

1. **Pairing UI (2.3)** — show my ticket, accept a pasted one, and handle the
   three pairing states from `PRODUCT.md` §5. Blocked on Q17/Q18, which are
   parked by choice.
2. **One-to-one chat (2.4)** and **offline/outbox (2.5)** — the outbox needs the
   `Staged` vs `Sent` distinction `PRODUCT.md` §6.2 asks for, so a half-paired
   peer never shows "sent".
3. **Q21 — updates.** Design the update mechanism **before the first GitHub
   Release**. The first build users install must already know how to update
   itself, or they are stranded on it.

### Needs a phone (batch these into one session)
- Background-delivery retest on **0.3.1**, which fixed the `detachConnection`
  liveness bug. The previous verdict (messages lost while reporting success) was
  measured against the broken build and is no longer trustworthy either way.
- **CSP on Android** — verified on WebView2 only so far.
- **The keychain on Android** — `android-native-keyring-store` compiles for
  `aarch64` but no device has run it. The self-check is already wired into the
  bridge harness, so this costs nothing extra.
- **The UI on Android** — onboarding, fonts, safe-area insets, and the reset
  flow have only been exercised on Windows.

### Still open
- **Q11** — bundle identifier and product name. Recommendation on the table:
  `io.github.mrsarthi.echoit`, `productName: "EchoIt"`. Awaiting a decision.
- **Q17 / Q18** — pairing design. Parked by choice until the above clears.
- **Q20** — keep checking whether `wmi` fixed its version ranges upstream, so
  the vendored patch in `src-tauri/vendor/wmi` can be dropped.

### Verification & test count
- **Harness tests:** 5 passing — `test:two-peer` (3), `test:bridge` (1), CSP
  message flow (1). All exercise real Iroh/QUIC across real OS processes.
- **Verified on hardware:** two laptops (direct); two phones on one network
  (direct, 377 ms connect / 527 ms delivery); two phones on mobile data behind
  double CGNAT (still direct, 1677 ms).
- **Assumed, not verified:** the protocol's 422-test count and audit status.

---

## Brand Logo & Desktop 3-Zone Navigation (2026-08-21)

### 1. Transparent 3D Logo Asset Integration
- Added the official 3D clay/terracotta 'e' logo asset in transparent PNG state (`public/logo.png`, `src/assets/logo.png`).
- Created reusable `<Logo size={...} />` component ([`src/components/ui/Logo.tsx`](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion-Rewrite/src/components/ui/Logo.tsx)) ensuring full alpha-transparency with zero artificial background borders.
- Integrated logo into all required brand touchpoints:
  - **Desktop Nav Rail**: Top brand mark (`36px`).
  - **Desktop Main Stage**: Hero resting stage illustration (`80px`).
  - **Onboarding Intro**: Header identity mark (`36px`).
  - **Chats Tab**: Stream header (`28px`) and empty state hero (`48px`).
  - **Favicon**: Window / Tab icon in `index.html`.

### 2. WhatsApp Web Style Desktop Navigation Refactor
- Refactored wide layout ($\ge 840\text{px}$) from an awkward horizontal bottom-bar in the sidebar to a full 3-Zone desktop architecture:
  - **Far-Left Nav Rail (60px)**: Top (Brand + Chats + Contacts), Bottom (Settings + Profile).
  - **Active Sidebar (340px)**: 100% vertical scrollable stream for chats/contacts/settings.
  - **Main Workspace (flex: 1)**: 1:1 active conversation or resting journal stage.
- Mobile layout ($< 840\text{px}$) preserved with standard bottom navigation on Home and full-height chat.

