# Releasing EchoIt

*Written 2026-08-23, before the first release.*

Most steps here are ordinary. Four are not, because getting them wrong cannot be
undone by shipping a fix — the people already holding a build are the ones who
suffer. Those four are marked **UNRECOVERABLE**.

---

## The repository split — deliberate, do not "fix" it

| | |
| :--- | :--- |
| **Development** | `mrsarthi/EchoIt-CB` — source, branches, history. This is `origin`. |
| **Publishing** | `mrsarthi/EchoIt-Messenger` — releases and downloads only. |

Decided 2026-08-23. A future session will notice that the updater points at a
repository the code does not live in and will want to align them. **That is the
intended arrangement**, not a mistake.

Consequences to work with rather than around:

- Releases are created with `--repo mrsarthi/EchoIt-Messenger`.
- Tags in the publishing repo do not correspond to commits there. That is fine;
  the manifest and artifacts are what installs consume.
- The publishing repo **must stay public.** The update check is an
  unauthenticated GET; making it private breaks updates for everyone, silently,
  and the app will report "couldn't check for updates" indefinitely.

---

## Before the first release

### 1. Back up the signing material — **UNRECOVERABLE**

Four files, all gitignored, all currently in exactly one place:

```
src-tauri/echoit-release.jks        Android signing key
src-tauri/keystore.properties       its password
src-tauri/echoit-updater.key        updater signing key (minisign)
src-tauri/updater.properties        its password
```

**Losing the keystore** means Android refuses every future update, so testers
must uninstall — and uninstalling wipes the app sandbox, including the message
store. There is no server copy. The recovery phrase restores identity, **not
history**.

**Losing the updater key** means no build you ever produce again will be
accepted as an update by an existing install.

Copy all four off this machine before shipping anything.

### 2. Confirm the version

`src-tauri/tauri.conf.json` `version` is the single source. The frontend reads it
through Vite's `__APP_VERSION__` and the updater compares against it, so a bump
here reaches everything. Bump it *before* building.

---

## Windows

```bash
TAURI_SIGNING_PRIVATE_KEY_PATH=src-tauri/echoit-updater.key \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<from src-tauri/updater.properties> \
npx tauri build
```

**Both variables are required.** Without them Tauri still produces an installer,
but no `.sig` — and an unsigned artifact is one the updater will refuse. The
build succeeds either way, which is what makes this easy to miss.

Then:

```bash
npm run release:manifest
```

That writes `latest.json` from the built artifact — reading the real signature
and deriving the download URL from the same endpoint the app checks, so the two
cannot disagree. Tauri does **not** generate this file; hand-writing it is how
the signature and URL drift apart.

---

## Android

`src-tauri/gen/` is gitignored and regenerated, so signing configuration there is
temporary by construction.

```bash
npx tauri android init          # only when gen/ is absent
npm run android:sign            # AFTER every init, before every release build
npx tauri android build --apk --target aarch64
```

### Verify who signed it — **UNRECOVERABLE if wrong**

```bash
apksigner verify --print-certs <path-to-apk>
```

The SHA-256 must equal the fingerprint recorded in `PROGRESS.md`:

```
2F:F2:E8:96:68:F3:17:48:CC:2B:11:06:C8:17:4A:B6:2F:01:7B:BF:58:A5:19:49:24:2B:E3:7B:30:E1:99:BD
```

A mismatch means the build would strand every existing install. Do not publish
it. This check exists because configuration proven by reading a Gradle file has
been wrong before.

---

## Publish

```bash
gh release create v<version> --repo mrsarthi/EchoIt-Messenger \
  "src-tauri/target/release/bundle/nsis/<installer>.exe" \
  latest.json \
  "<path-to-apk>"
```

`latest.json` **must** be an asset on the release, because the endpoint compiled
into the app is
`https://github.com/mrsarthi/EchoIt-Messenger/releases/latest/download/latest.json`.

---

## Verify the release from outside

Do not assume the endpoint works because the file was uploaded.

```bash
curl -sI https://github.com/mrsarthi/EchoIt-Messenger/releases/latest/download/latest.json
curl -s https://api.github.com/repos/mrsarthi/EchoIt-Messenger/releases/latest | head -20
```

Then in the app: **Settings → Check now**. Before a release exists it reports
`release feed returned 404 Not Found`, which is correct and distinguishable from
success — the check reports failure separately from "up to date" precisely so a
stranded tester is never told they are current.

**The in-place desktop update is unproven** and cannot be proven until a *second*
release exists to update to. Say so rather than implying it works. `installInPlace()`
falls back to the release page when the plugin finds nothing, so the button
always does something — but download-and-replace has never run.

---

## What ships with known gaps

State these to testers rather than letting them discover them:

- **Message history is not encrypted at rest** (Finding 11). The Profile tab
  says so; do not soften it.
- **Background delivery on Android** — measure it before claiming anything.
- **`PRODUCT.md` §1 currently overstates the server position** (Finding 18): the
  app contacts Number 0's relay and discovery services on every launch. Drafted
  replacement wording is in `PROGRESS.md`, awaiting approval.
- **Whoever adds a contact second can message first.** The other side's composer
  unlocks on the first incoming message. Expected, not a bug.
