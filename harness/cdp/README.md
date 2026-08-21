# CDP verification drivers

Scripts that drive a **running** EchoIt build over the Chrome DevTools Protocol
and report what actually happened. They are how every claim in `PROGRESS.md` was
checked — none of it was inferred from the code compiling.

They are not unit tests. Each one needs an app already running with a remote
debugging port open, so the launch incantation matters as much as the script.

## Launching a build so a driver can reach it

**Windows — one instance:**

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" \
  src-tauri/target/debug/echoit.exe
```

**Windows — two instances that must be independent.** Each needs its **own
WebView2 profile**, or they share IndexedDB and quietly behave as one app:

```bash
WEBVIEW2_USER_DATA_FOLDER=/tmp/wv-a WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" src-tauri/target/debug/echoit.exe &
WEBVIEW2_USER_DATA_FOLDER=/tmp/wv-b WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223" src-tauri/target/debug/echoit.exe &
```

Give each ~15 seconds before driving it. The SDK has to boot, bind an Iroh
socket, and reach a relay.

**Android** — the driver forwards to the phone's webview socket itself; it only
needs the app running and `adb` reachable.

## The drivers

| Script | Needs | What it proves |
| :--- | :--- | :--- |
| `drive-bridge.mjs` | Two instances, `VITE_HARNESS=bridge` build, ports 9222/9223 | Two peers pair, connect, and exchange messages both ways. **The core regression** — run it after any change to transport, storage, or the harness |
| `csp-check.mjs <port>` | One instance, any build | Reloads the page and reports **CSP violations and console errors**. Run after any UI change |
| `resize-test.mjs` | One instance, port 9222, normal build | Resizes the real OS window across the 840px breakpoint and checks the layout swaps cleanly, with no state showing both nav types or neither |
| `drive-onboarding.mjs <port>` | One instance on first run | Completes onboarding: generates a phrase, answers the 3-word check, lands in the app |
| `drive-phones.mjs <serialA> <serialB>` | Two Android devices, app running on both | **The S2 gate.** One encrypted message between two physical phones |
| `test-background.mjs <serialA> <serialB>` | Two Android devices | **Background delivery.** Sends at three depths while one phone is backgrounded, then distinguishes *queued* from *lost* |
| `lib-cdp.mjs` | — | Shared attach/evaluate/click helper. Import it rather than re-writing the WebSocket plumbing |

## Two things that will waste your time if you don't know them

**A fresh WebView2 profile does not mean a fresh app.** The encryption key lives
in the **Windows Credential Manager**, which is machine-wide. Two instances with
separate profiles still find the same key and skip onboarding. To force a true
first run:

```bash
cmdkey /delete:LegacyGeneric:target=storage-key.io.github.mrsarthi.echoit
```

**`SetWindowPos` goes stale.** `resize-test.mjs` resizes the real window, and
after the app has been running a while the handle stops responding — every
width reads the same. Restart the app and re-run; a sweep where `w` never
changes is a broken test, not a broken layout.

## Adding a driver

Report **what happened**, not that something ran. The most valuable line any of
these produces is one that distinguishes two failure modes — `outbox=N` in
`status()` exists solely so "queued and will arrive" cannot be mistaken for
"vanished", which is exactly the ambiguity that made an earlier background run
inconclusive.
