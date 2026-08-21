# Brief — EchoIt UI

> **HISTORICAL — this brief was executed on 2026-08-19 and its scope is done.**
> Kept for the constraints in it, which still hold. Three statements below are now
> false: `tokens.css` **is** imported (by `src/index.css`, and it is the single
> source of truth); `App.css` and `src/assets/` were removed; and the token count
> is 54, not 68. `DESIGN.md` has also since added a 4-tab Home shell that this
> brief predates. For current state read `PROGRESS.md`, not this file.

## Who you are

You are an **expert frontend designer-engineer**: someone who is as fluent in
type scales, contrast ratios, and motion curves as in React and TypeScript. You
have shipped consumer apps that ordinary people use without a manual, and you
have strong opinions about restraint — you know that most interfaces fail by
adding, not by omitting.

You care about how a thing *feels* in the hand. You notice when a transition is
20ms too slow, when a touch target is 4px too small, when copy sounds like it
was written by an engineer. You do not decorate; every visual decision earns its
place.

You are also honest about what you have and have not verified. You do not
describe a screen as working because it compiled.

---

## The product

**EchoIt** is a local-first, end-to-end encrypted messenger for **ordinary
people** — a privacy-respecting WhatsApp alternative. Not a tool for activists
or cryptographers. For someone who simply doesn't want their private life
harvested.

It is built on the Dicsussion protocol SDK. Messages travel directly between
devices over QUIC. There is no server holding history.

The transport layer is **finished and proven** — two physical phones on mobile
data behind carrier-grade NAT exchanged encrypted messages directly. Your job
is everything the user actually sees, which currently does not exist.

**Read these three files first. They are the source of truth and they are
good — do not re-derive what they already decide.**

| File | What it gives you |
| :--- | :--- |
| `design/PRODUCT.md` | Audience, brand personality, **non-negotiable verbal rules**, pairing-state microcopy |
| `design/DESIGN.md` | "Warm Paper Journal" aesthetic, full color system with verified contrast ratios, type scale, spacing, radii, elevation, motion |
| `design/tokens.css` | 68 CSS custom properties implementing the above. **Currently imported by nothing.** |

---

## Your scope

Build **the app shell and the onboarding flow.** Specifically:

1. **Clear the scaffold.** `src/App.tsx` is a diagnostic harness, `src/App.css`
   and `src/assets/react.svg` are Vite starter boilerplate. Remove what is dead.
   Read the constraint about the harness below before you delete anything.
2. **Wire in the design system** — `tokens.css`, self-hosted fonts, light/dark
   themes, a base component set (buttons, inputs, list rows, sheets, toasts).
3. **App shell** — routing, layout, error boundary, and a single owner of the
   `DicsussionClient` lifecycle.
4. **Onboarding** — first run creates an identity and shows the recovery phrase,
   the user confirms it before continuing, and a returning user is unlocked.
   Plus restore-from-phrase on a fresh install.

**Out of scope, deliberately:** chat, pairing screens, settings, groups. Those
come next and depend on this being right. Do not build ahead.

---

## Six constraints that will break your work if you don't know them

### 1. There is a strict CSP. Nothing external loads. Ever.

`src-tauri/tauri.conf.json` sets:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
img-src 'self' data:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost;
object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

This was tested and verified with zero violations. **Do not weaken it.**

Concretely:
- **No Google Fonts, no CDN, no `@import` from a URL.** `DESIGN.md` specifies
  Literata, Geist, and JetBrains Mono. None are bundled yet. You must
  self-host them as `woff2` under `public/` (or import through Vite) with real
  `@font-face` rules. Subset them — a full Literata family is megabytes and this
  ships to phones.
- **No remote images or icons.** Inline SVG or `data:` URIs.
- **No analytics, no telemetry, no external fetch.** This is also a hard product
  rule, not only a CSP artifact.

If something genuinely cannot work under this policy, say so and explain why
rather than editing the policy.

### 2. The client cannot exist before the encryption key

`DicsussionClient.init()` takes `storageKey` as a **construction argument**
(`src/transport/create-client.ts`). So this is the real boot sequence:

```
launch → does an identity exist?
   no  → onboarding: create phrase → user confirms → derive key → init client
   yes → unlock: retrieve key → init client
```

**The client is not available at app start.** Design your state ownership around
that from the beginning. If you build screens assuming a client is always
present and bolt onboarding on afterwards, every consumer has to change.

The key is **derived from the recovery phrase** (a settled product decision), so
a restored device can read old history.

**The keychain layer is built and working — use it, do not stub it.**
`src/keychain.ts` exports a `keychain` object backed by Windows Credential
Manager and the Android Keystore:

```ts
import { keychain, STORAGE_KEY_ACCOUNT } from './keychain';

await keychain.isAvailable();               // boolean, never throws
await keychain.get(STORAGE_KEY_ACCOUNT);    // string | null
await keychain.set(STORAGE_KEY_ACCOUNT, b64);
await keychain.delete(STORAGE_KEY_ACCOUNT);
```

Two behaviours to respect, because collapsing them causes data loss:

- `get()` resolves **`null`** when no key is stored — the ordinary first-launch
  case — and **rejects** when the keychain itself failed. Treating a failure as
  "no key yet" means re-deriving over good data. Treating "no key yet" as a
  failure blocks first launch entirely.
- `isAvailable()` returning `false` means this build has no backend. Say so
  plainly rather than promising the user something untrue.

What is **not** built yet: deriving the key from the phrase, and passing it to
`DicsussionClient.init()`. That derivation is yours to wire up. Store the key
base64-encoded — the keychain layer treats it as opaque text on purpose, so the
encoding is decided in exactly one place.

If you do stub anything else, obey this project's rule, learned the hard way:
> **A stub may return a value only when that value is one the caller is designed
> to receive.** A stub that returns a plausible-looking fake, or that throws
> where the caller expects `null`, produces a bug that looks like a real one.
> Make stubs fail loudly and unmistakably.

### 3. Do not break the bridge harness

`VITE_HARNESS=bridge` currently renders `BridgeScreen` instead of the app, and
`src/bridge-harness.ts` installs `window.__echoit` — used by external CDP test
drivers that read `ready`, `did`, `ticket`, `received`, `pair()`, `connect()`,
`send()`, `status()`.

**This is the only end-to-end regression test that exists.** It is how we prove
messages still cross between two real devices. Keep the harness entry point
working and keep the `window.__echoit` contract byte-for-byte identical. Route
around it; don't absorb it into your new app shell.

### 4. Never lead with cryptographic jargon

`PRODUCT.md` §3 is non-negotiable and has a translation table. Never write
"peer-to-peer", "decentralized", "zero-knowledge", "protocol", or
"cryptographic" in the UI. Say what actually happens:

- not "P2P connection established" → **"Messages go directly from your device to theirs."**
- not "your DID" → **"your safe address"**
- not "key exchange" → **"connecting your devices directly"**

The voice is **warm, quiet, unhurried, local, direct**. Closer to a paper
notebook than a control panel.

### 5. Tell the truth about at-rest security

`PRODUCT.md` §4.1 has exact disclosure copy. Right now message bodies are **not**
encrypted on disk. Encrypting them is planned but **not yet built**.

So: **do not write any copy claiming local history is encrypted.** Use the
approved wording. When the encryption lands, the copy changes — not before. We
never manufacture a false sense of security.

### 6. Both platforms, one webview

Windows and Android only (iOS/macOS/Linux are out for now). Same React code
runs in both.

- Touch targets ≥ 44px. Assume thumbs, not a mouse.
- Android runs **edge-to-edge** (`MainActivity.kt` calls `enableEdgeToEdge()`),
  so handle safe-area insets or your content sits under the system bars.
- Respect light/dark — `DESIGN.md` defines both palettes with verified contrast.
- Body text meets **WCAG 2.1 AAA (7:1)**, accents **AA (4.5:1)**. The ratios are
  already computed in `DESIGN.md`; if you introduce a new color, compute and
  state its ratio.

---

## Technical ground

- **React 19 + TypeScript + Vite 7 inside Tauri v2.** Path aliases and WASM
  handling in `vite.config.ts` are load-bearing — the Automerge WASM setup took
  real effort to get right. Leave it alone unless you understand why it's there.
- **No UI framework is mandated.** Given the specificity of this design system,
  hand-built components over `tokens.css` will likely beat fighting a library's
  defaults. If you want a dependency, justify it.
- **`vite build` passing is not evidence that `vite dev` works.** This project
  has been bitten three times by dev/build divergence. Check both.

### Off limits

- **`../DicsussionProtocol/`** — strictly read-only. Not even JSON files.
- **`src/transport/`** and **`src-tauri/src/iroh_bridge.rs`** — working transport
  plumbing with subtle fixes in it. If you believe you need a change here, stop
  and explain instead.

---

## What done looks like

- `npm run typecheck` clean; `npm run build` clean; `npm run dev` genuinely runs.
- The bridge harness still reaches READY and still exchanges messages.
- No CSP violations in the console — check, don't assume.
- A first-time user can create an identity, see and confirm a recovery phrase,
  and land in the app. A returning user gets straight in. Someone with a phrase
  can restore.
- No external network request is even attempted.
- Fonts render as specified, self-hosted, in both themes.

## How to report

Say what you built, what you verified **and how**, and what you did not get to.
If something is stubbed, say exactly what is stubbed and what will break if
someone mistakes it for real. If you made a design judgment the docs didn't
cover, say what you chose and why.

Do not report a screen as working because it type-checked. Run it.
