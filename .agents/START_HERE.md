# START HERE

*Written 2026-08-21, at the point the project moved into this repository from a
scratch folder. Read this first, then follow the map at the bottom.*

---

## What EchoIt is

A local-first, end-to-end encrypted messenger **for ordinary people** — a
privacy-respecting WhatsApp alternative, not a tool for activists or
cryptographers. Built on the sibling Dicsussion protocol SDK, consumed from npm.

Messages go device to device over QUIC. **No server holds history.**

Targets: **Windows and Android (`aarch64`) only.** 1:1 conversations only for
beta — no groups.

---

## Where things actually stand

**Working and proven on real hardware:**

- Transport. Two physical phones on mobile data behind carrier-grade NAT
  exchanged encrypted messages **directly**, not relayed.
- Onboarding, identity, recovery phrase, restore.
- OS keychain (Windows Credential Manager verified; Android compiles but has
  **never run on a device**).
- Navigation shell — 4 destinations, responsive at 840px, three-zone desktop.
- Pairing UI, requests list, reconnect-on-resume.
- Android release keystore, generated and used to sign a real APK.

**Not built:** sending and receiving messages (the composer is not wired),
groups, read receipts, the updater.

**The one thing blocking beta:** background delivery has never been measured on
0.3.2. Everything needed to measure it now exists — see "How to verify".

---

## Six rules that are not negotiable

1. **`../DicsussionProtocol/` is strictly read-only.** Not even JSON files. It is
   a separate repository with its own release cycle.
2. **The five privacy constraints** in `AGENT_INSTRUCTIONS.md` §3: no server-side
   message storage, no key escrow, no analytics carrying message content /
   contacts / `did:key`, no plaintext message content on disk, `storageKey` from
   the OS keychain. These are product promises, not preferences.
3. **The CSP must not be weakened.** `src-tauri/tauri.conf.json`. Verified at
   zero violations four separate times. It is what makes "the app cannot phone
   home" a checkable claim rather than a promise.
4. **Never write an absolute server claim.** Not "EchoIt never connects to a
   server" — that is false. The exact approved line is in `design/PRODUCT.md` §1.
5. **Never lead with cryptographic jargon in UI copy.** `PRODUCT.md` §3 has the
   translation table. Audits have caught "Direct P2P Ready", "hardware keychain",
   and "Initializing encrypted database" — the last two also being *false*.
6. **Do not break the bridge harness.** `VITE_HARNESS=bridge` renders
   `BridgeScreen`, and `window.__echoit` is read field-by-field by external
   drivers. It is the only end-to-end regression test that exists.

---

## Five things that look wrong and are not

Each was a real bug once. Removing any of them silently reintroduces it.

| Where | What | Why |
| :--- | :--- | :--- |
| `AppContext` | `bootStarted` ref guard | React StrictMode double-invokes effects; without it two clients open the same IndexedDB |
| `AppContext` + `services/pending-reset.ts` | Reset marks a flag, reloads, and erases the database **before React mounts** | The SDK holds its IndexedDB connection open for the life of the page and has no `close()`. An in-place delete fires `onblocked` and silently leaves the data |
| `AppContext` | `contacts.length` in the reconnect effect's deps | Contacts load in a separate effect keyed on `did`, resolving *after* the client. Without it the first sweep runs against an empty list and dials nobody — and the symptom is silence |
| `services/reconnect.ts` | `refreshTicketAddresses()` before dialling | A stored ticket carries the addresses a peer had when it was made. Stale ones fail looking exactly like the network being down |
| `bridge-harness.ts` | `outbox=N` in `status()` | Without it, "queued and will arrive" and "vanished" are indistinguishable from outside |

**The general rule this project learned the hard way:** *a stub may return a
value only when that value is one the caller is designed to receive.* A
plausible-looking fake produces a bug that looks real.

---

## How to verify anything

**Nothing is done because it compiled.** Every claim in `PROGRESS.md` was checked
by running something.

`harness/cdp/README.md` has the drivers and the launch incantations. The short
version:

```bash
npm run typecheck && npm run build     # necessary, nowhere near sufficient
npm run test:two-peer                  # 3 scenarios, real QUIC, two OS processes
node harness/cdp/drive-bridge.mjs      # two app instances exchange messages
node harness/cdp/csp-check.mjs 9222    # CSP violations + console errors
```

**`vite build` passing is not evidence `vite dev` works.** This project has been
bitten three times. Check both.

---

## Open decisions and known debts

- **Requests badge.** The nav rail shows a count badge for pending connection
  requests. `PRODUCT.md` §5 says knocks must produce **no badge**. Either drop
  the badge or amend the rule — currently the code and the doc disagree.
- **388 KB logo**, shipped twice (bundle + favicon), displayed at 80px.
- **Updater (Q21)** — designed in `IMPLEMENTATION_PLAN.md`, not built. Must exist
  **in the first release** or every tester is stranded.
- **Both copies of the Android keystore need backing up off-machine.** Losing it
  means testers must uninstall, and uninstalling destroys their message history.
- **Android**: keychain and CSP have never been exercised on a device.

---

## Read in this order

1. **This file.**
2. **`PROGRESS.md`** — the decision log, newest first. Large; read the top
   sections and search rather than reading end to end.
3. **`IMPLEMENTATION_PLAN.md`** — milestones and the settled-questions table.
   Q1–Q21 are answered there with reasoning.
4. **`AGENT_INSTRUCTIONS.md`** — standing rules and the boundary rule.
5. **`design/PRODUCT.md`** and **`design/DESIGN.md`** — voice, verbal rules,
   pairing microcopy, palette, layout. `design/tokens.css` is the **single
   source of truth** for every token; import it, never copy values out.

When something here contradicts the code, **the code is not automatically
right** — check which was written later, and say so rather than silently
picking one.
