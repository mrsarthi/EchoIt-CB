# Brief 3 — EchoIt pairing

## Who you are

You are an **expert frontend designer-engineer**. You have shipped consumer apps
ordinary people use without a manual, and you know most interfaces fail by
adding, not by omitting.

You are honest about what you have and have not verified. **You never describe a
screen as working because it compiled.** Unlike the last brief, everything here
*is* testable — two app instances on one machine pair with each other. There is
no excuse for an unverified claim this time.

---

## Why this feature is the dangerous one

Pairing in EchoIt is **mutual**, and it fails silently. If only one person adds
the other, the device that dialled shows a healthy connection and every message
it sends goes nowhere. No error, no warning.

Your job is to make a half-finished pairing impossible to mistake for a finished
one. Everything else here is packaging around that.

---

## What already exists

| Area | State |
| :--- | :--- |
| `src/screens/AppShell.tsx` | 4 tabs + two-pane/bottom-tab responsive shell. **Done** |
| `src/screens/tabs/ContactsTab.tsx` | Renders an **empty "Connection requests" section** and an empty contacts list — this is where your work lands |
| `src/screens/tabs/ProfileTab.tsx` | Shows the safe address and a **"Connection ticket" section** — currently display-only |
| `src/context/AppContext.tsx` | Owns the client. `useApp()` gives `client`, `did`, `state` |
| `src/bridge-harness.ts` | **The proven pairing implementation.** Read it before writing anything — it is the reference |
| `src/components/ui/` | `Button` `Card` `Input` `Modal` `Badge` `AlertBanner` `Icons` |

---

## Your scope

Per `design/PRODUCT.md` §5 and the implementation plan's 2.3.

1. **Show my ticket** — in Profile. Copy to clipboard. Record it locally as an
   *active invite* (timestamp), so a later request can be loosely correlated.
2. **Accept a pasted ticket** — paste, validate, pair, connect. Failure states
   shown plainly.
3. **The three pairing states**, rendered as **Option B, "Two Steps"** — an
   explicit checklist naming who has done what and what remains. This was chosen
   over a connection diagram and a status pill because the half-paired state is
   the one that matters and B is the only one that cannot be skim-read wrong.
4. **Requests list** in Contacts — inbound unpaired peers land here.
5. **Accept / Ignore / Block**, all silent.

### Out of scope

- Sending and receiving messages (2.4). The composer stays unwired.
- Read receipts, groups, typing indicators.
- The update-check toggle in Settings — separate work.

---

## The SDK, and the exact sequence that works

`src/bridge-harness.ts` already does this correctly and has been proven between
two physical phones on mobile data. **Follow it.**

```ts
import { encodeTicket, decodeTicket } from '@dicsussion/core/transport';

// --- publishing your ticket ---
await refreshTicketAddresses();            // from useApp()'s client wrapper
const mine = encodeTicket(client.getTicket());

// --- accepting theirs ---
const peer = decodeTicket(pasted);         // tolerates whitespace and newlines
client.addPeer(peer.didKey, peer.encryptionKey);
await client.connect(peer);
```

### Five things that will bite you

**1. `refreshTicketAddresses()` before every publish. Not optional.**
The transport caches its addresses once, fire-and-forget, at construction —
before STUN and the relay have answered. `getTicket()` serves that cache. Skip
the refresh and the ticket carries the socket's first LAN-only view: undialable
from any other network, and it fails **looking exactly like NAT traversal
breaking**. This cost real debugging time. Do not remove it as redundant.

**2. Refuse the user's own ticket.**
Pasting your own is easy when two windows look alike, and it fails in the worst
way: pairing and connecting both report success, `peers=1`, and nothing is ever
delivered. Compare `peer.didKey === client.did` and refuse with a plain message.

**3. A ticket without `encryptionKey` is unusable.** `encryptionKey` is optional
on `PeerTicket`. Check it before `addPeer` and say so plainly rather than
throwing.

**4. Both sides must `addPeer`.** Until they do, frames are dropped by the
protocol. This is the mutual-pairing rule that the whole UI exists to surface.

**5. Never truncate a `did:key` shown for comparison.** A shortened one reads as
complete but happens not to match the other screen — misleading exactly when
someone is checking two devices are distinct.

---

## Requests: three rules, and they are the whole design

`client.onPeerConnected` fires with `{ peerDid, paired }`. `paired: false` is a
stranger who completed a handshake.

1. **A stranger can only knock.** Until you add them back, the protocol drops
   their messages. `PeerConnectedEvent` carries `peerDid` and `paired` and
   **nothing else** — no name, no text, no picture. Do not design a UI that
   implies otherwise.
2. **Knocks wait in a list and never interrupt.** **No notification, no banner,
   no badge, no toast.** Ever. They appear in Contacts and the user looks when
   they choose to.
3. **Accept / Ignore / Block are silent.** The far side is told nothing.

**The silence is a safety feature and must not be softened.** Telling someone
they were ignored confirms the address is real and that a person saw them —
exactly what someone persistent is fishing for. It is also unenforceable without
a server. If you feel an urge to be polite to the sender here, that urge is the
bug. See `PRODUCT.md` §5.

*Ignore* removes the knock (it returns if they knock again). *Block* is
permanent. Both local.

Any name beside a request came **out of band** in the invite and is the sender's
own unverified claim. Present it as such.

---

## Copy rules

**Never lead with cryptographic jargon** (`PRODUCT.md` §3). No "peer-to-peer",
"decentralized", "protocol", "cryptographic". Previous audits caught "Direct P2P
Ready", "FULL SAFE ADDRESS (DID)" and "hardware keychain" — do not reintroduce
that register.

**Never write an absolute server claim.** `PRODUCT.md` §1 now fixes this
exactly. Not "EchoIt never connects to a server", not "nothing ever leaves your
device". The canonical line is:

> *"The only thing EchoIt asks a server is whether there's a new version.
> Everything else goes straight between your device and theirs."*

**Approved microcopy for the three states is already written** in `PRODUCT.md`
§5. Use it rather than inventing your own.

---

## Constraints

1. **Strict CSP.** No CDN, no remote images, no external fetch. Verified at zero
   violations three times. Do not weaken it.
2. **Do not break the bridge harness.** `VITE_HARNESS=bridge` renders
   `BridgeScreen`; `window.__echoit` is read field-by-field by external CDP
   drivers. **It is the only end-to-end regression test that exists.**
3. **Three things in `AppContext` must survive** — the `bootStarted` StrictMode
   guard, the deferred database reset via `pending-reset.ts`, and the keychain's
   `null`-vs-rejects contract. All three were audit findings. They look like
   clutter; they are not.
4. **`design/tokens.css` is the only place tokens live.** Import, never copy.
5. **Off limits:** `../DicsussionProtocol/`, `src/transport/`,
   `src-tauri/src/iroh_bridge.rs`, `src-tauri/src/keychain.rs`.

---

## What done looks like — and you can prove all of it

`npm run typecheck`, `npm run build`, `npm run dev` all clean. Harness still
passes. Zero CSP violations. Both themes, both layouts.

**Then actually pair two instances.** Build, launch twice with separate
`WEBVIEW2_USER_DATA_FOLDER` values, and confirm by hand:

- A shows its ticket; B pastes it. **B shows "waiting for them"** — not
  "connected".
- A sees the knock in Contacts, with **no notification of any kind**.
- A accepts. **Both sides now show connected.**
- Pasting your own ticket is refused.
- A malformed ticket fails with a plain message, not a stack trace.
- Ignore makes the knock vanish and sends the far side nothing.

## How to report

Say what you built, **what you verified and how**, and what you did not reach.
Name anything stubbed. Where you made a design judgment the docs did not cover,
say what you chose and why.

Two instances. Pair them. Then tell me.
