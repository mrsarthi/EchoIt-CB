# EchoIt

> **"Your messages stay on your phone. We can't read them. We don't want to."**

EchoIt is a local-first, end-to-end encrypted messenger built for ordinary
people — a privacy-respecting alternative to the mainstream messengers, not a
tool for cryptographers. Messages travel device to device over QUIC, and
**no server holds message history**.

Built on the [Dicsussion protocol](https://github.com/mrsarthi/DicsussionProtocol)
SDK, consumed from npm as [`@dicsussion/sdk`](https://www.npmjs.com/package/@dicsussion/sdk)
(Apache-2.0). The protocol is developed separately and used here unmodified.

**Targets: Windows and Android (`aarch64`).** 1:1 conversations only for beta —
no groups. iOS is deferred rather than abandoned: the runtime was chosen so that
adding it later is a build exercise, not a rewrite.

> **On what EchoIt tells a server:** the precise, approved wording lives in
> `design/PRODUCT.md` §1 and was **settled on 2026-08-30**. There are two
> servers, not one — a connection helper on every launch (§4.4) and the daily
> update check (§4.3). Do not write a server claim of your own here or
> anywhere else; copy §1 exactly.

---

## Documentation & Standing Rules

Before contributing to or altering this project, you **must** read and abide by
the standing documents in `.agents/`:

1. **[`.agents/START_HERE.md`](./.agents/START_HERE.md)** — start here. What the
   project is, where it actually stands, the six non-negotiable rules, and the
   five things that look wrong and are not.
2. **[`.agents/AGENT_INSTRUCTIONS.md`](./.agents/AGENT_INSTRUCTIONS.md)** —
   architectural constraints, the five privacy requirements, and the boundary
   rule for the protocol repository.
3. **[`.agents/PROGRESS.md`](./.agents/PROGRESS.md)** — the durable memory:
   status, decisions and their reasoning, findings, and upstream requests.
   Newest first; large, so search it rather than reading end to end.
4. **[`.agents/IMPLEMENTATION_PLAN.md`](./.agents/IMPLEMENTATION_PLAN.md)** —
   the phased route to beta, exit criteria per milestone, and the settled
   questions table (Q1–Q21).
5. **[`.agents/RELEASING.md`](./.agents/RELEASING.md)** — the release runbook.
   Four of its steps are marked UNRECOVERABLE; those are the ones whose failure
   lands on people who have already installed.
6. **[`.agents/ECHOIT_MASTER_PROMPT.md`](./.agents/ECHOIT_MASTER_PROMPT.md)** —
   the original product and technical specification.

**The working agreement:** *nothing is done because it compiled.* Every claim in
`PROGRESS.md` was checked by running something. `harness/cdp/README.md` has the
drivers and the launch incantations.

---

## Current Status

**Runtime: Tauri v2.** Iroh compiles as an ordinary Rust dependency there, which
is the only route that keeps iOS open — `@number0/iroh` publishes no iOS binary,
so any approach running Node inside the app reaches Android but never iOS.
Recorded as decision D1 in `PROGRESS.md`.

**The spike gate is open.** Two physical phones on mobile data behind
carrier-grade NAT exchanged encrypted messages **directly**, not relayed.

**Working, and verified by running it:**

- A conversation between **two physical phones**, both directions, through the
  real screens — not a harness.
- The same on the **signed Windows release binary**, not a debug build.
- Onboarding, identity, recovery phrase and restore.
- The OS keychain on both platforms — Windows Credential Manager, and the
  Android Keystore, which survives an APK reinstall.
- A strict CSP at **zero violations** on WebView2 and on Android.
- Pairing, contacts, requests, and reconnect-on-resume.

**Not built:** groups, read receipts, and the delivery-status ladder
(`PRODUCT.md` §5b).

**Known and deliberate for 0.1.0:** a backgrounded phone does not receive
messages. The beta promise is that messages move while both apps are open. The
measurement and the reasoning are Finding 20.

---

## Verifying it yourself

```bash
npm ci
npm run typecheck && npm run build   # necessary, nowhere near sufficient
npm run test:two-peer                # 3 scenarios, real QUIC, two OS processes
npm run test:three-peer              # does a 1:1 channel stay 1:1?
```

`vite build` passing is not evidence `vite dev` works — this project has been
bitten by that three times. Check both.

---

## Licence

See [LICENSE](./LICENSE). The Dicsussion protocol SDK is Apache-2.0 and
developed in its own repository.
