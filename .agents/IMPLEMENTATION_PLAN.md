# EchoIt — Implementation Plan (0 → beta)

*Written 2026-08-05. Companion to [`PROGRESS.md`](./PROGRESS.md) (what happened)
and [`AGENT_INSTRUCTIONS.md`](./AGENT_INSTRUCTIONS.md) (how we work).*

**Read the [Open Questions](#open-questions) section first.** Several answers
change the shape of later phases, and a few change whether a phase exists at
all.

---

## Where we actually are

| | Status |
| :--- | :--- |
| Repo, docs, standing rules | ✅ Done |
| Runtime decision (Tauri v2, phones + desktop) | ✅ Done |
| Tauri scaffold, SDK linked, webview shims | ✅ Done — typechecks, builds, audit clean |
| Rust / MSVC / JDK / Android SDK on this machine | ❌ **None installed** |
| SDK runs in a webview | ❌ Blocked on 3 upstream fixes |

Two independent blockers, and they can be worked in parallel by different people:

- **Toolchain** — nothing Tauri can be *built* until Rust and MSVC Build Tools
  are installed. Android needs JDK + SDK + NDK on top.
- **Upstream SDK** — SDK-1, SDK-3a, SDK-3b (Finding 7). Measured by bundling,
  not guessed.

---

## Phase 0 — Foundations

### 0.1 Toolchain *(blocked on a decision — see Q1)*

| Milestone | Exit criteria |
| :--- | :--- |
| **M0.1.1** Rust + MSVC | `cargo --version` works; `cargo build` succeeds in `src-tauri/` |
| **M0.1.2** Desktop dev loop | `npm run tauri dev` opens a window on Windows |
| **M0.1.3** Android toolchain | JDK 17+, Android SDK, NDK, `rustup target add aarch64-linux-android armv7-linux-androideabi` |
| **M0.1.4** Android init | `npm run tauri android init` succeeds; debug APK builds |

VS Build Tools is a multi-GB install requiring UAC. It is the long pole here.

### 0.2 Scaffold ✅ **COMPLETE**

Tauri v2 + React 19 + Vite 7. SDK linked by path. Webview shims committed:
Automerge WASM via `vite-plugin-wasm`, `node:events` → `events`, and
`@number0/iroh` / `node:dgram` stubbed. `npm audit` clean.

### 0.3 Upstream unblocking *(blocked on a decision — see Q2)*

Not EchoIt's code. Per the boundary rule these land in `../DicsussionProtocol`.

| Milestone | Change | Effort |
| :--- | :--- | :--- |
| **M0.3.1** SDK-1 | Widen storage types to `IStorageDriver`; add `runtime.storage` seam | Small — 5 lines + a field |
| **M0.3.2** SDK-3a | Back AES-GCM with `@noble/ciphers`; `randomBytes`/`createHash` to noble + WebCrypto | Medium, mechanical |
| **M0.3.3** SDK-3b | Make blind-keypair generation lazy + async, **or** pure-JS RSA keygen | Medium — needs a design call |
| **M0.3.4** Regression | Protocol suite still green (422) after all three | — |

**Exit:** the S0 probe (`src/probe.ts`) builds and runs in a browser.

---

## Phase 1 — The Spike *(the gate)*

No UI beyond throwaway harnesses until S2 passes. Each stage gates the next.

### 1.1 S0 — SDK in a webview

| Milestone | Exit criteria |
| :--- | :--- |
| **M1.1.1** Bundles | `vite build` succeeds with the probe wired in |
| **M1.1.2** Boots | `DicsussionClient.init()` resolves in the webview; `client.did` is a valid `did:key` |
| **M1.1.3** Persists | Message sent to self survives a full app restart (IndexedDB) |
| **M1.1.4** Measured | Bundle size + cold start recorded in `PROGRESS.md` |

### 1.2 S1 — Real QUIC between two desktops

| Milestone | Exit criteria |
| :--- | :--- |
| **M1.2.1** Rust Iroh endpoint | `src-tauri` owns an Iroh endpoint; commands expose connect/send; frames arrive as Tauri events |
| **M1.2.2** `TauriIrohTransport` | Implements `ITransport`; injected via `runtime.transport` |
| **M1.2.3** Loopback | Two instances on one machine exchange an encrypted message |
| **M1.2.4** Two machines | Same, across a real network. Record direct vs relayed |
| **M1.2.5** Different networks | One tethered. Record which networks force relay |

The `ITransport` surface is small — `connect`/`onConnection`/`close`, plus
`IConnection` with `send`/`onFrame`/`close`/`peerDid`/`clockOffset`/`state`.

### 1.3 S2 — Android *(THE GATE)*

| Milestone | Exit criteria |
| :--- | :--- |
| **M1.3.1** Installs | Debug APK runs on a physical device |
| **M1.3.2** Boots | Identity derives; storage persists across restart |
| **M1.3.3** **One message crosses** | Between two physical devices. **This opens the gate.** |
| **M1.3.4** Measured | APK size, cold start, handshake time, direct vs relay |

Use `/android-device-test`. Artifact required: screenshot or capture.

### 1.4 S3 — iOS readiness *(paper only, no Mac)*

Confirm nothing in S0–S2 forecloses iOS: Iroh still compiles as a Rust crate,
no Node-only import reached the bundle, no Android-only plugin on a critical
path. Record exactly what a Mac session would need to do.

---

## Phase 2 — Core messaging

First real UI. Everything here is single-user or two-user; no groups yet.

### 2.1 App shell & state — ✅ **COMPLETE** (reopened and closed 2026-08-19)

Built to `DESIGN.md` §2 and audited by running it: the 840px crossover was
verified on a real OS window resize, with no state where both nav types or
neither appear. Contacts already renders an empty requests section, which is
where 2.3 lands.
- **M2.1.1** ✅ Layout, error boundary, and a single `DicsussionClient`
  lifecycle owner in `src/context/AppContext.tsx`. Init is guarded against
  StrictMode's double-invoke — an unguarded effect built two clients over one
  database, which is how the pre-UI harness failed too.
- **M2.1.2** ✅ State exposed via `useApp()`; connection status on `HomeScreen`.
- **M2.1.3** ✅ **Home shell with a 4-tab bottom bar** — Chats · Contacts ·
  Settings · Profile. Per `DESIGN.md` §2A the bar exists **only** on Home; it is
  not a global app chrome.
- **M2.1.4** ✅ **Full-height chat view** — opening a conversation hides the tab bar
  entirely and replaces it with the composer (`DESIGN.md` §2B).
- The boot-state switch (`checking | onboarding | unlocking | ready | error`)
  stays as-is and sits *above* this navigation. Onboarding must never show tabs.

### 2.2 Identity & onboarding
- **M2.2.1** ✅ First run derives the identity, shows the 12-word phrase, and
  requires 3 of them back before continuing.
- **M2.2.2** `storageKey` — **derived from the recovery phrase** (Q14), then
  **cached in the OS keychain** (Windows DPAPI / Android Keystore) so the KDF
  runs once at setup rather than on every launch. **Never** hardcoded or omitted
  (constraint §3.5).

  **Status: ✅ complete on Windows.** Keychain in `src-tauri/src/keychain.rs` +
  `src/keychain.ts`; derivation in `src/services/identity.ts` (BIP-39 seed with
  the domain-separating passphrase `echoit:storage-key:v1`, first 32 bytes,
  base64), wired through `AppContext`. Android runtime is **unproven** — it
  compiles and the self-check is wired into the bridge harness, but no device
  has run it.

  *Why both, and not one or the other:* §3.5 was written assuming a
  device-generated key, which the keychain protects well but which dies with the
  device — restore from phrase would come back to unreadable history. Deriving
  from the phrase makes history portable; the keychain is then a cache, not the
  source of truth. It keeps the key out of app-readable storage between launches
  while leaving the phrase as the one thing that can reconstruct it. This also
  makes the future QR multi-device plan (Q12) viable, since a second device
  holding the same phrase derives the same key.
- **M2.2.3** ✅ Restore from recovery phrase, in `OnboardingScreen`.
- **M2.2.4** ✅ Reset — erases the keychain key *and* the local database. The
  erase is deferred across a reload (`src/services/pending-reset.ts`) because
  the SDK holds its IndexedDB connection open for the life of the page and
  offers no way to close it, so an in-place delete is always blocked.

### 2.3 Pairing *(Q17/Q18 settled 2026-08-19; needs M2.1.3 first)*

Structure chosen from the pairing lab: **Option B, "Two Steps"** — an explicit
two-item checklist naming who has done what and what remains. Chosen over the
connection-diagram and single-status-pill options because the state that matters
is the half-paired one, and B is the only one that cannot be skim-read wrong.

- **M2.3.1** Show my ticket; copy to clipboard; record it as an **active invite**
  (timestamp + optional label) so inbound requests can be correlated.
- **M2.3.2** Accept a pasted ticket; connect; show failure states plainly.
- **M2.3.3** Handle a **stale ticket** — embedded addresses go stale, so fall
  back to relay rather than failing (see Q7).
- **M2.3.4** The three pairing states as Option B, per `PRODUCT.md` §5.
- **M2.3.5** **Requests list.** `onPeerConnected` with `paired: false` appends
  to it. **Never notifies** — no push, no banner, no badge.
- **M2.3.6** **Accept / Ignore / Block, all silent.** Ignore removes the knock
  (it returns if they knock again); Block is permanent. Nothing is ever sent to
  the far side — see `PRODUCT.md` §5 for why this must not be "improved" later.

*Dropped as unnecessary complexity (2026-08-19):* invite correlation windows,
notification throttling, timed cooldowns, and a strict-mode toggle. They existed
to decide whether to notify — and since nothing notifies, none of them earn their
keep. Revisit only if the quiet list proves too quiet in real use.

### 2.4 One-to-one chat
- **M2.4.1** Send and receive; optimistic local echo.
- **M2.4.2** History from `getHistory`, correctly ordered.
- **M2.4.3** Delivery states: sending / sent / failed.

### 2.5 Offline & outbox
- **M2.5.1** Queue while offline; flush on reconnect.
- **M2.5.2** Honest offline UI — never show "sent" for something queued.

**Exit:** two people install, pair, and hold a conversation across a restart and
an offline period.

---

## Phase 3 — Groups

SDK support exists (`createGroup`, `joinGroup`, membership CRDT, genesis
anchors). Scope depends on Q5.

- **M3.1** Create a group; membership tree persists.
- **M3.2** Invite flow; import a group via its genesis anchor.
- **M3.3** Group chat send/receive/history.
- **M3.4** Leave a group; departure tombstone announced.

---

## Phase 4 — Product surface

### 4.1 Design system *(use the `impeccable` skill)*
- **M4.1.1** `PRODUCT.md` + `DESIGN.md` — audience, voice, personality. Source
  the voice from the master prompt: *"Your messages stay on your phone."*
  **Never lead with crypto or decentralization language.**
- **M4.1.2** Tokens: color (light + dark), type scale, spacing, motion.
- **M4.1.3** Component set: buttons, inputs, lists, sheets, toasts.

### 4.2 Core screens
- **M4.2.1** Conversation list · **M4.2.2** Chat view · **M4.2.3** Contact
  detail & verification · **M4.2.4** Settings.

### 4.3 Conversation features
- **M4.3.1** **Delivery & read status** — the avatar ladder in `PRODUCT.md` §5b
  (Staged → Sent → Delivered → Read). **Blocked on M4.3.0.** Togglable, and
  "receipts off" must not render as "unread".
- **M4.3.0** **Profile layer** — display name + picture, with a monogram
  fallback. A prerequisite for M4.3.1, not a nicety: there is nothing to
  desaturate without it.
- **M4.3.2** Typing indicators · **M4.3.3** Replies and reactions ·
  **M4.3.4** Block/report (local list only, sharing the M2.3.6 mechanism).

### 4.4 Search
- **M4.4.1** Local-only message search. No server indexing, ever.

### 4.5 Backup & recovery
- **M4.5.1** Re-display recovery phrase behind auth.
- **M4.5.2** Full restore-on-new-device flow, tested end to end.

---

## Phase 5 — Platform hardening

### 5.1 Background delivery *(the hardest unsolved problem — see Q8)*
Android kills backgrounded processes. A P2P messenger that only receives while
open is not a messenger. Options: foreground service with a persistent
notification; push wake-up; or accept the limitation and say so plainly in beta.

- **M5.1.1** Measure what actually happens when backgrounded.
- **M5.1.2** Implement the chosen strategy.
- **M5.1.3** Battery over 1h idle-connected.

### 5.2 Notifications
- **M5.2.1** Local notifications for messages received while running.
- **M5.2.2** Remote push — **only if Q8 selects it**, and note the tension: FCM
  means Google sees delivery metadata, which sits against the product's
  premise even though it never sees content.

### 5.3 Lifecycle & resilience
- **M5.3.1** Network changes (wifi ↔ cellular) reconnect cleanly.
- **M5.3.2** Cold start from a killed state restores conversations.
- **M5.3.3** Storage migration path for schema changes.

---

## Phase 6 — Quality & release

### 6.1 Tests
- **M6.1.1** Unit tests for app logic.
- **M6.1.2** Integration tests against a real client instance.
- **M6.1.3** **Failure-mode tests** — peer lies, message replayed, network dies
  mid-send, storage corrupted. These are the valuable ones (§6).
- **M6.1.4** CI running typecheck + tests + audit.

### 6.2 Security
- **M6.2.1** `/echoit-guardrails` clean across the whole tree.
- **M6.2.2** `/security-review` on the full diff.
- **M6.2.3** Verify no plaintext on disk outside the encrypted store — inspect
  the actual database and logs on a device.
- **M6.2.4** Threat-model write-up: what EchoIt protects against and what it
  does not.

### 6.3 Performance
- **M6.3.1** Cold start, message latency (P90), APK size against the strategy
  doc's targets (<100 ms P90, <50 MB, <5%/h battery).

### 6.4 Beta packaging *(see Q9)*
- **M6.4.1** Release signing; keystore stored outside the repo — `.gitignore`
  already blocks `*.jks`/`*.keystore`.
- **M6.4.2** Release builds for Android + Windows.
- **M6.4.3** Distribution channel set up.
- **M6.4.4** Crash reporting **only** if it cannot carry content, contacts, or
  `did:key` (constraint §3.3). Default: none.
- **M6.4.5** Onboarding docs and a feedback path for testers.

### 6.5 Known release gate
**The trusted setup is single-party and development-only.** The current
`rln_final.zkey` must not ship publicly — a real ceremony needs the Hermez
transcript plus ≥5 Phase-2 contributors. Whether this blocks *beta* depends on
Q6; it absolutely blocks public release.

---

## Phase 7 — Future: owning the connection layer *(post-beta)*

*Added 2026-08-21. Not beta work — see "Why not before beta" at the end.*

### 7.0 What we found

`src-tauri/src/iroh_bridge.rs:170` builds the endpoint with
`Endpoint::builder(presets::N0)`. Read from the crate source on this machine
(`iroh-1.0.3/src/endpoint/presets.rs`), that preset is documented as *"the
default relay servers provided by Number 0"* plus *"the DNS Address Lookup
service ... publishes to and resolves from the n0.computer dns server
`iroh.link`."*

Nobody chose this. It is the library default, and it means **two** dependencies
on infrastructure operated by the company that makes Iroh:

| Service | What it does | Where it points today | How to replace |
|---|---|---|---|
| **Relay** | Introduces two peers so hole punching can land; carries encrypted traffic **only** when a direct path cannot be made | `use1-1`, `usw1-1`, `euc1-1`, `aps1-1` `.relay.n0.iroh.link` | `RelayMode::Custom(RelayMap)` |
| **Discovery (pkarr)** | Publishes a signed record of this device's ID and addresses; resolves other peers' | `https://dns.iroh.link/pkarr` | `PkarrPublisher::builder(url)` / `PkarrResolver::builder(url)` |

**Replacing only the relay leaves half the exposure in place** — the publisher
still writes to n0 on every launch. Both must move together.

Iroh supports this as a first-class path: `iroh-relay` 1.0.3 ships a real server
binary (`[[bin]] name = "iroh-relay"`, behind the `server` feature).

### 7.0.1 Correct the mental model

The relay is **not** a fallback-only service. It is contacted on **every
launch**, by every user, because introduction is its main job. Carrying traffic
is the rare part — every hardware test to date reported `relayed=false`.

This is good news for cost: the frequent work (registration, introduction) is
tiny; the expensive work (relaying bytes) is rare.

### 7.1 Provider study *(researched 2026-08-21)*

Requirements: **always on** (a sleeping relay makes introductions fail, which
presents to a user as "can't connect" — indistinguishable from the network being
down), **a UDP listener** (`ServerConfig.quic` is the QUIC address-discovery
half; without it hole punching degrades and more sessions fall back to relaying,
which costs more bandwidth), and **egress headroom**.

#### Free, and actually viable — Oracle Cloud Always Free

| | |
|---|---|
| Compute | 2 OCPU / 12 GB ARM Ampere A1 — **halved** from 4/24 on 2026-06-15, enforced 2026-08-18. Plus 2 × AMD micro VMs |
| **Egress** | **10 TB / month** |
| UDP | Full VM with root and your own security lists — not a PaaS, so yes |
| Cost | $0. A credit card is required for identity verification and is not charged unless you upgrade |

**The UDP caveat, and why it probably does not bite us.** Oracle's network
firewall drops *fragmented* UDP datagrams when ingress rules are restricted to
specific ports — a 1000-byte datagram passes, 1200 fails. The documented fix is
to allow **all** UDP ports in the ingress rule rather than a range. Separately,
QUIC deliberately keeps datagrams at or below ~1200 bytes precisely to avoid IP
fragmentation, so an iroh relay should sit under the threshold by design.
**Verify with a real relay before relying on this** — it is reasoning from two
facts, not a measurement.

**The real risk is idle reclamation.** Oracle deems a compute instance idle if
95th-percentile CPU is under 20% across 7 days, and idle Always Free instances
*may* be reclaimed. A relay for a small beta is close to the definition of idle.
Oracle's own documentation is not consistent here — one page says Always Free
resources are not reclaimed, another says idle ones may be. **Treat reclamation
as likely rather than settled**, and budget for the paid fallback below.
Accounts idle 30 days may also be suspended.

#### Free, and not viable

| Option | Why not |
|---|---|
| **Google Cloud `e2-micro` always free** | **1 GB/month egress.** Oracle gives 10 TB. A single relayed conversation could exhaust the month |
| **Render / Fly / Railway and PaaS generally** | HTTP/TCP oriented, no arbitrary UDP listener, and free tiers sleep. Render was the original idea and is the wrong shape for this |

#### Cheapest sound paid option — Hetzner CX22

**€4.35/month** (~$4.59) for 2 vCPU, 4 GB RAM, 40 GB NVMe, full root, UDP
unrestricted. Hetzner raised some plan prices on 2026-04-01, so check current
figures at purchase. Netcup's RS 1000 G12 is stronger per euro on raw
performance if that ever matters; for a relay it will not.

#### Recommendation

Try **Oracle Always Free** first — 10 TB of egress is the number that matters and
nothing else free comes close. Expect to need the **Hetzner CX22 at €4.35** if
idle reclamation or ARM capacity shortages bite, and treat that €4.35 as the real
budget rather than a surprise.

### 7.2 Milestones

- **M7.2.1** Stand up `iroh-relay` with both halves configured — `relay`
  (HTTPS) and `quic` (UDP address discovery). Confirm a real client reaches it.
- **M7.2.2** Stand up a pkarr publish/resolve endpoint, or accept that discovery
  stays with n0 and **say so in the disclosure**. Half a migration described as
  a whole one is worse than not migrating.
- **M7.2.3** Point the app at both: `RelayMode::Custom`,
  `PkarrPublisher::builder(url)`, `PkarrResolver::builder(url)`. This replaces
  `presets::N0`, so the crypto provider must be set explicitly — copy what the
  `N0` preset does rather than reinventing it.
- **M7.2.4** Measure again on real hardware. Every direct-connection figure in
  `PROGRESS.md` was taken through n0's introducers; none of it carries over.
  Two phones, mobile data, `relayed=false` or the migration is not done.
- **M7.2.5** **Custom relay URL in Settings** — the bring-your-own-relay idea, as
  an advanced setting rather than a default. It is what makes the hosted default
  trustworthy: *"we run one so it works; point it at your own if you'd rather."*
  Asking an ordinary user to run a relay cannot be the default — that is the
  audience EchoIt explicitly is not built for.
- **M7.2.6** Disclosure copy in `PRODUCT.md` §1 and §4. See Finding 18.

### 7.3 Verbal rule for whatever we host

**Never call it "zero knowledge".** It is true of content — messages are
end-to-end encrypted and a relay cannot read them. It is false of metadata: a
relay must see IP addresses, device IDs and timing, because that is the job.
§4.2 forbids claiming protection we do not have, and this would be the same
overclaim the audits already caught with "hardware keychain" and "Initializing
encrypted database".

Call it a **connection helper**, and say what it sees.

### Why not before beta

The transport layer is the one part of EchoIt with real hardware proof behind
it — two phones, mobile data, double CGNAT, direct, 1677 ms. Every one of those
measurements was taken with n0 doing introduction. Swapping that out invalidates
all of them and puts the only proven layer at risk days before a beta.

The urgent half of this is **one paragraph of copy** (Finding 18), not a
migration.

---

## Critical path

```
Toolchain (0.1) ─┐
                 ├─→ S0 → S1 → S2 [GATE] → Phase 2 → Phase 4 → Phase 6 → beta
Upstream (0.3) ──┘                      └→ Phase 3 ─┘   Phase 5 ─┘
```

Phases 0.1 and 0.3 are independent — do them in parallel. Phase 3 and Phase 5
can overlap Phase 4.

---

## Open Questions

*Revised 2026-08-18. Most were answered in one pass — see "Settled" below.
Only genuinely open items remain here.*

### Awaiting a decision

**Q11 — bundle identifier.** `io.github.mrsarthi.echoit` is accidental: Tauri's scaffold
took `wfors` from the Windows username. Reverse-DNS should be a domain you
control. Recommended: **`io.github.mrsarthi.echoit`** — the Flathub/F-Droid
convention for projects without a domain, unambiguous and free. Alternatives
(`app.echoit`, `com.echoit.app`) require actually owning the domain.
`productName` should also become `EchoIt`, not `echoit`.

**Free to change now, expensive after release** — the identifier keys the app
data directory, so changing it later strands every existing install's messages.

**Q6 — which route for proof cost, if anonymous messaging is ever enabled.**
Precomputed proof pool, or a native Rust prover (~10× faster, and we already
have a Rust layer). Not needed for beta, since anonymous messaging is out of
scope. Deferred, not rejected.

**Q17 / Q18 — pairing design. ✅ CLOSED 2026-08-19.** Both concerns resolved by
the same answer. An inbound peer has no name because the protocol drops unpaired
peers' messages — so names travel out of band in the invite, as unverified
claims. And a ticket holder cannot "trigger a prompt" at all: nothing notifies.
Knocks wait in a Requests list; Accept, Ignore, or Block, all silent. See
`PRODUCT.md` §5.

### New work this raised

**Q21 — app updates. Design settled 2026-08-20** (MACCO analysis; every
checkable claim independently verified against the repo).

**Two tracks, both in the first release.**

| | Windows | Android |
| :--- | :--- | :--- |
| Mechanism | `tauri-plugin-updater`, in-place | **None exists in Tauri v2.** Rust command checks the release feed, `opener` launches the Release page; user reinstalls the APK over the old one |
| Must be baked into v0.1.0 | minisign **public key** in `plugins.updater.pubkey`, and the literal endpoint URL | the **release keystore** — final and backed up off-machine |

**The CSP is not a blocker.** The desktop updater fetches its manifest and
artifact in Rust, outside the webview. But a frontend `fetch()` to github.com
*would* be blocked, so the Android check must be a `#[tauri::command]`. **Do not
widen `connect-src`** — Q16 is closed and verified; reopening it for this would
be an avoidable regression.

**The single most expensive thing to get wrong: the Android signing key.**
Android refuses an update signed by a different key, so testers must uninstall —
and uninstall wipes the app sandbox, including the SharedPreferences blob the
Android keyring store uses. With no server copy (§3.1), **their message history
is gone**. The recovery phrase restores identity, not history. Generate the
release keystore, back it up off-machine, and use it for the first beta APK.

**Verified gaps in this repo today:**

1. No updater dependency, permission, or `bundle.createUpdaterArtifacts` — the
   `.sig` files an updater needs are only emitted when that flag is true.
2. Android `getByName("release")` has **no `signingConfig`** — only minify and
   proguard.
3. `src-tauri/gen/` is gitignored, so any Gradle signing edit is **non-durable**
   and will be lost on the next `android init`.
4. `capabilities/default.json` is one unscoped capability (`core:default`,
   `opener:default`). The updater permission needs its own file with
   `"platforms": ["windows"]` plus a `#[cfg(desktop)]` guard on registration —
   follow the per-target pattern already used for the keyring stores.
5. `targets: "all"` — must name one Windows artifact. **NSIS**, since it is the
   one supporting passive/silent update installs.
6. **A raw `.exe` cannot be updated in place.** Beta must move from "copy the
   exe" to "run the installer", or the updater has nothing to update.
7. No Windows Authenticode signing, so every updater-installed build trips
   SmartScreen. Acceptable for beta *if stated to testers*; budget a
   certificate before public release.
8. The endpoint URL is compiled in, so **the GitHub remote must exist before
   v0.1.0 is built**, not before it is uploaded.

**Settled 2026-08-20: silent check, throttled to once per 24h.**

Checked against §3 before accepting: §3.3 bans analytics carrying **message
content, contact identifiers, or `did:key`**. An update check carries none of
those — it is a plain GET for a manifest — so this is compatible. It is not,
however, free of consequence, and the terms matter:

- **Throttled to once per 24 hours**, not once per launch. A last-checked
  timestamp lives locally. Identical UX, a fraction of the beacons — someone who
  opens the app twenty times a day should not ping GitHub twenty times.
- **The request carries nothing.** No custom User-Agent with a device or install
  identifier, no query parameters, no counters. Whatever the plugin sends by
  default is what it sends; nothing is added. Adding anything here would be
  §3.3 by the back door.
- **Toggleable in Settings, default on**, and **disclosed** — see `PRODUCT.md`
  §4.3. A privacy product does not get to make a silent network call and not
  mention it.

**What GitHub can observe:** an IP address, and roughly when the app was opened.
Not who you talk to, not what you said, not your `did:key`. Worth stating plainly
rather than pretending it is nothing.

**The upside, which is real:** this makes a strong claim checkable — the *only*
server EchoIt ever contacts is GitHub, to ask whether a newer version exists.
Everything else is device to device.

---

## Settled

| # | Question | Decision |
| :--- | :--- | :--- |
| **Q14** | Chat content at rest | **Encrypt it.** Key **derived from the recovery phrase**, so a restored device can read old history. Accepts that the phrase unlocks everything |
| **Q5** | Groups in v1 | **1:1 only for beta.** Groups deferred |
| **Q6** | Anonymous messaging / WoT | **Out of beta** (`zkProofs: 'off'`). Proof-cost route deferred with it |
| **Q15** | 32-bit Android | **Dropped.** 64-bit only — `aarch64` alone. Cuts APK size |
| **Q8** | Background delivery | **As-is for now.** A separate approach is being explored |
| **Q9** | Distribution | **GitHub Releases** for the APK — which raises Q21 |
| **Q10** | Platform targets | **Windows + Android only.** No macOS/Linux/iOS for now |
| **Q16** | CSP | **Closed.** Strict policy applied and verified — zero violations, full message flow still passes. See below |
| **Q12** | Multi-device | **Deferred.** A QR-based design exists for a future update |
| **Q13** | Repo name | **Done.** Repo is `EchoIt-CB`; fresh start pushed to `main` |
| **Q19** | File the `wmi` upstream report | **Set aside** |
| **Q20** | Remove the vendored `wmi` patch | **Keep checking** whether upstream has fixed the version ranges |
| **Q1–Q4, Q7** | Toolchain, upstream ownership, SDK-3b, frontend stack, pairing | Settled earlier — see git history of this file |

### What the settled answers change

- **Q14 + Q12 interact.** Deriving the at-rest key from the recovery phrase is
  what makes the future QR multi-device plan viable: a second device holding
  the same phrase can read the same history. A device-bound keychain key could
  not have.
- **Q5 removes roughly half the UI surface** for beta — no member lists,
  invites, group creation, or leave flows.
- **Q15 + Q10 narrow the build matrix** to two targets, which makes release
  automation for Q21 markedly simpler.
- **Q14 makes M2.2.2 (keychain) mandatory rather than merely overdue**, since
  key handling is now on the critical path for message storage, not just
  identity.

### Q16 — the policy that shipped

`src-tauri/tauri.conf.json`, `app.security.csp`:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self' ipc: http://ipc.localhost;
object-src 'none';
base-uri 'self';
form-action 'none';
frame-ancestors 'none'
```

Method: apply the strictest plausible policy first and relax only what actually
breaks — the reverse (start permissive, tighten later) never converges, because
nothing forces you to find out what the slack was hiding.

Nothing broke. Verified twice against the bridge harness on WebView2:

1. **Boot** — reached `BRIDGE READY did=z6MkvKp5UvdL relay=true`. 0 CSP
   violations, 0 console errors, captured over CDP (`Log.entryAdded`,
   `Runtime.exceptionThrown`, `Runtime.consoleAPICalled`).
2. **Full message flow** — two instances paired, connected, and exchanged
   messages both directions. `STEP 1 PASSED`, direct (`relayed=false`).

Two notes on the policy itself:

- **`'wasm-unsafe-eval'` is required, not optional.** Automerge is a 3.8 MB WASM
  blob; without it, storage does not initialize at all. It permits WASM
  compilation only — it does not re-enable `eval()` or `new Function()` on
  JavaScript, so the usual reason to fear an `unsafe-` token does not apply.
- **`connect-src` allows `ipc:` and `http://ipc.localhost`** because that is how
  Tauri v2 carries IPC on Windows. No external origin is reachable: every network
  operation goes through Rust, which is exactly the property we want — the
  webview cannot phone home even if a dependency tries.

**Still to verify:** Android uses a different webview engine. The policy is
believed portable (`wasm-unsafe-eval` is standard Chromium), but it has not been
run there. Fold this into the next Android session alongside the 0.3.1
background-delivery retest.
