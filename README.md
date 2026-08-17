# EchoIt

> **"Your messages stay on your phone. We can't read them. We don't want to."**

EchoIt is a local-first, end-to-end encrypted messaging app designed as a privacy-respecting WhatsApp alternative for everyday users. Conversations live entirely on the device—no servers hold message history or metadata.

Built on the [Dicsussion protocol](https://github.com/mrsarthi/DicsussionProtocol) SDK, consumed from npm as [`@dicsussion/sdk`](https://www.npmjs.com/package/@dicsussion/sdk) (Apache-2.0). The protocol is developed separately and used here unmodified.

---

## Documentation & Standing Rules

Before contributing to or altering this project, you **must** read and abide by the standing rules in `.agents/`:

1. **[`.agents/AGENT_INSTRUCTIONS.md`](./.agents/AGENT_INSTRUCTIONS.md)**: The source of truth for architectural constraints, coding conventions, privacy requirements, and how to work within this repository.
2. **[`.agents/PROGRESS.md`](./.agents/PROGRESS.md)**: The durable memory of the project. Current status, decisions and their reasoning, findings, and upstream requests.
3. **[`.agents/IMPLEMENTATION_PLAN.md`](./.agents/IMPLEMENTATION_PLAN.md)**: The phased route from here to beta, with exit criteria per milestone and the open questions blocking progress.
4. **[`.agents/ECHOIT_MASTER_PROMPT.md`](./.agents/ECHOIT_MASTER_PROMPT.md)**: The core product and technical specification defining scope and vision.

---

## Current Status

**Runtime decided: Tauri v2**, targeting Android, iOS, and desktop. Iroh compiles as an ordinary Rust dependency there, which is the only route that keeps iOS open — `@number0/iroh` publishes no iOS binary, so any approach running Node inside the app reaches Android but never iOS. The reasoning and rejected alternatives are recorded as decision D1 in `PROGRESS.md`.

No application code exists yet, by design. The master prompt sets a hard gate: **no UI until one encrypted message has crossed between two real devices.** The spike that clears it runs in four stages (S0–S3), the first of which is testable on a desktop today.

Currently blocked on one upstream change — the SDK hardcodes its SQLite storage driver, so the browser-compatible `IndexedDbDriver` cannot be selected from a webview. Tracked as **SDK-1** in [`.agents/PROGRESS.md`](./.agents/PROGRESS.md).

iOS is deferred until a Mac is available to build and sign. It is not abandoned; the runtime was chosen specifically so that adding it later is a build exercise rather than a rewrite.
