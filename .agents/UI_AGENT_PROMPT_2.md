# Brief 2 — EchoIt navigation shell

## Who you are

You are an **expert frontend designer-engineer**. You have shipped consumer apps
that ordinary people use without a manual, and you have strong opinions about
restraint — you know most interfaces fail by adding, not by omitting.

You notice when a transition is 20ms too slow, a touch target 4px too small, or
copy that sounds like it was written by an engineer. You do not decorate.

You are honest about what you have and have not verified. **You never describe a
screen as working because it compiled.** The last brief's work was audited and
ten findings came back; the two that mattered were a lifecycle bug and a reset
that silently didn't reset. Both looked fine.

---

## What already exists

Onboarding and the client lifecycle are **built, audited and working**. Do not
rebuild them.

| Area | State |
| :--- | :--- |
| `src/context/AppContext.tsx` | Owns the `DicsussionClient` lifecycle. Exposes `state`, `client`, `did`, `error`, `keychainAvailable`, `theme`, `setTheme`, `startNewIdentity`, `restoreIdentity`, `resetApp` |
| `src/screens/OnboardingScreen.tsx` | First run, recovery phrase, 3-word confirmation, restore. Done |
| `src/screens/HomeScreen.tsx` | A **single placeholder screen**. Holds the safe address, a theme toggle, and a lock/reset control. This brief breaks it up |
| `src/components/ui/` | `Button` `Card` `Input` `Modal` `Badge` `AlertBanner` `Icons` — use these, extend rather than replace |
| `src/index.css` | Imports `design/tokens.css`, self-hosts Literata / Geist / JetBrains Mono |
| `design/tokens.css` | **The single source of truth for every token.** 54 of them. Do not copy values out of it |

**There is no navigation of any kind.** The shell switches on the boot state
(`checking | onboarding | unlocking | ready | error`) and lands on one screen.

**There are zero media queries in `src/`,** and the window is 800×600 with no
minimum. Desktop today is a phone-shaped column in a small box.

---

## Your scope

Build the navigation shell, at both sizes, per **`design/DESIGN.md` §2** — read
§2A, §2B and §2C before writing anything.

1. **Four destinations**: **Chats · Contacts · Settings · Profile.**
2. **Narrow (`< 840px`)**: bottom tab bar, on Home *only*. Opening a conversation
   goes full height and hides the bar.
3. **Wide (`>= 840px`)**: two panes. Conversation list in a permanent left
   sidebar with the destination rail at its foot; conversation on the right; a
   resting empty state when nothing is selected.
4. **Redistribute today's `HomeScreen`**: safe address and connection ticket →
   **Profile**; theme switcher and lock/reset → **Settings**. Chats becomes the
   conversation list (empty state only for now). Contacts is the paired-peer list
   with a visible, empty **Requests** section.
5. **Chat screen shell** — header, message area, composer. Layout only.
6. **Window sizing** in `src-tauri/tauri.conf.json`: minimum ~`380×500` so the
   narrow layout always fits, default nearer `1100×720` so two-pane is what
   people meet first.
7. **Keyboard** on wide: `Enter` sends, `Shift+Enter` newlines, `Escape` closes,
   arrows move through the list.

### Out of scope — deliberately

- **Sending or receiving messages.** That is 2.4. Build the composer and the
  message area; wire nothing.
- **Pairing, and the request accept/ignore/block logic.** That is 2.3 and lands
  next, on top of your Contacts tab.
- **Read receipts.** Blocked on a profile-picture layer that does not exist.
- **Groups.** 1:1 only for beta.

Build the *places* these things will live. Do not build ahead of them.

---

## Constraints that will break your work

### 1. Switch on width, never on platform

No `navigator.platform`, no `userAgent`, no Tauri OS check. A desktop window
dragged under 840px **must** get the phone layout — that is correct behaviour,
not degradation. Use a container query or a matchMedia hook, one place, one
breakpoint.

This is the single most expensive thing to get wrong, because every screen
inherits it.

### 2. The strict CSP — nothing external loads, ever

`src-tauri/tauri.conf.json` sets:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
img-src 'self' data:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost;
object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

Verified with zero violations twice. **Do not weaken it.** No CDN, no Google
Fonts, no remote images — inline SVG or `data:` URIs. Fonts are already
self-hosted; adding a weight means adding a subsetted `woff2`, not a link tag.

If something genuinely cannot work under this policy, say so rather than editing
the policy.

### 3. Do not break the bridge harness

`VITE_HARNESS=bridge` renders `BridgeScreen`, and `src/bridge-harness.ts`
installs `window.__echoit`, read field-by-field by external CDP drivers:
`ready`, `did`, `ticket`, `received`, `pair()`, `connect()`, `send()`,
`status()`.

**It is the only end-to-end regression test that exists** — how we prove
messages still cross between two real devices. Keep the entry point working and
the contract identical. Route around it; never absorb it into the shell.

### 4. Three things in `AppContext` that must survive

These were bugs found in audit. They look like clutter. They are not.

- **The `bootStarted` ref guard.** React StrictMode double-invokes effects in
  dev; without the guard two `DicsussionClient` instances open the same
  IndexedDB. Verified: exactly one client per launch. Do not "clean it up".
- **The deferred reset.** `resetApp` marks a flag, reloads, and
  `runPendingReset()` erases the database in `main.tsx` *before React mounts*.
  It cannot be done in place — the SDK holds the IndexedDB connection open for
  the life of the page and has no `close()`, so `deleteDatabase` fires
  `onblocked` and the data survives. An earlier attempt treated `onblocked` as
  success and silently reported a deletion that never happened.
- **The keychain contract.** `keychain.get()` resolves `null` when no key is
  stored — the ordinary first-launch case — and **rejects** when the keychain
  failed. Collapsing those means either re-deriving over good data or blocking
  first launch.

### 5. Never lead with cryptographic jargon

`PRODUCT.md` §3 is non-negotiable. Never write "peer-to-peer", "decentralized",
"zero-knowledge", "protocol", or "cryptographic" in the UI. The audit caught
"Direct P2P Ready" and "FULL SAFE ADDRESS (DID)" — do not reintroduce that
register.

Voice is **warm, quiet, unhurried, local, direct**. A paper notebook, not a
control panel.

### 6. Tell the truth about at-rest security

Message bodies are **not** encrypted on disk. `PRODUCT.md` §4.1 has the approved
disclosure copy. Do not write anything implying local history is protected — the
audit caught "Initializing encrypted database", which was false.

### 7. `design/tokens.css` is the only place tokens live

The last round duplicated the token set into `src/index.css` and the two drifted.
That has been fixed. Import, never copy. If you need a value that does not exist,
add it to `tokens.css` and say so.

---

## Technical ground

- React 19 + TypeScript + Vite 7 in Tauri v2. **No router is installed.** Adding
  one is your call — justify it. Four destinations and one detail view may not
  warrant a dependency, but a hand-rolled switch that later needs history and
  deep links is worse. Decide deliberately and say why.
- `vite.config.ts` handles Automerge WASM and Node shims. It took real effort.
  Leave it alone.
- **`vite build` passing is not evidence `vite dev` works.** This project has
  been bitten three times. Check both.

### Off limits

- `../DicsussionProtocol/` — strictly read-only, not even JSON.
- `src/transport/`, `src-tauri/src/iroh_bridge.rs`, `src-tauri/src/keychain.rs` —
  working plumbing with subtle fixes. If you think you need a change, stop and
  explain instead.

---

## What done looks like

- `npm run typecheck` and `npm run build` clean; `npm run dev` genuinely runs.
- The bridge harness still reaches READY and still exchanges messages.
- Zero CSP violations — check the console, do not assume.
- **Resizing one window** from 1200px to 500px moves between two-pane and bottom
  tabs, with no dead states in between and nothing overlapping.
- All four destinations reachable at both sizes; onboarding never shows tabs.
- A conversation opens and closes correctly in both layouts.
- Keyboard shortcuts work on wide.
- Both themes still correct on every new screen.

## How to report

Say what you built, **what you verified and how**, and what you did not reach.
Name anything stubbed and what breaks if someone mistakes it for real. Where you
made a design judgment the docs did not cover, say what you chose and why.

Run it. Resize it. Then tell me.
