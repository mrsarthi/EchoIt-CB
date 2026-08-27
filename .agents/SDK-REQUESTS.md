# What the app needs from the protocol

*Written 2026-08-27, after building the features that did not need it.*

Three requested features cannot be built honestly on the current SDK surface.
This is what each needs and, more importantly, **why the obvious app-level
workaround is worse than waiting** — so that a future session does not
"unblock" itself by building one.

Everything here was checked against `@dicsussion/sdk@0.6.0` by reading
`node_modules/@dicsussion/sdk/dist/*.d.ts`, not from memory.

---

## 1. Presence — an ephemeral message that is not stored

### The gap

`DicsussionClient` exposes `onPeerConnected` and **no matching disconnect
event**. `isOnline` exists but reports *our own* node's state, not a peer's.

A green dot driven by `onPeerConnected` alone switches on and never switches
off: it would show "online" for someone who closed the app hours ago. That is
the Finding 17 mistake — asserting a state from a signal that does not carry
it.

### Why not do it in the app

WhatsApp-style presence needs a heartbeat. Sending one as an ordinary message
would work and would also grow the CRDT document forever: **a ping every 30
seconds is ~2,900 permanent entries per conversation per day**, on both
devices, replicated and checkpointed. Message history is already unencrypted at
rest (Finding 11); filling it with pings makes that worse for no user-visible
gain.

### What would close it

Either of:

- **An ephemeral send** — delivered to connected peers, never written to the
  document, no outbox, dropped if the peer is offline. Presence, typing
  indicators, and read receipts all sit on this one primitive.

  ```ts
  chat.sendEphemeral(channelId, payload: Uint8Array): Promise<void>
  chat.onEphemeral(channelId, handler: (from: string, payload: Uint8Array) => void): () => void
  ```

- **Or presence directly**, if the transport already knows:

  ```ts
  client.onPeerPresence(handler: (peer: { did: string; online: boolean; lastSeen?: number }) => void): () => void
  client.peerPresence(did: string): { online: boolean; lastSeen?: number }
  ```

The first is more useful — typing indicators and read receipts need it too. The
second is less work if iroh already surfaces connection liveness.

### What ships meanwhile

`src/services/presence.ts` derives presence from inbound traffic: heard from
within `ONLINE_WINDOW_MS` (2 min) → "Online", otherwise "last seen …". Honest,
and **conservative in the right direction** — it under-reports online rather
than claiming someone is there who is not. A peer who is online but idle reads
as "last seen 3 minutes ago".

Swapping in a real signal means changing `presenceFrom`'s input. Nothing else
in the app needs to move.

---

## 2. Profile exchange — name, picture, bio

### The gap

Nothing in the SDK carries user-visible profile data. `trust-service` has a
"profile", but that is the RFC 004 §8 trust score, unrelated.

Today a contact's name is whatever **you** typed when adding them. The other
person cannot tell you what they are called.

### Why not do it in the app

Encoding profiles as specially-tagged chat messages works and leaks: the tag
would have to be filtered out of the chat view everywhere, forever, and any
client that did not know the convention would render `{"__profile":...}` as a
message. Avatars would sit in message history as base64 — permanent, per
update, on both devices.

### What would close it

A small mutable per-peer record, synced like a document rather than appended
like a message, so that updating a picture replaces it instead of adding to a
list:

```ts
interface PeerProfile {
  displayName?: string;
  bio?: string;
  avatar?: { mime: string; bytes: Uint8Array };  // or a blob handle, see §3
  updatedAt: number;
}

identity.setMyProfile(profile: Partial<PeerProfile>): Promise<void>
identity.getPeerProfile(did: string): PeerProfile | undefined
identity.onPeerProfile(handler: (did: string, profile: PeerProfile) => void): () => void
```

Points worth settling in the protocol rather than the app:

- **A size cap on `avatar`**, enforced by the SDK. Without one the first person
  to set a 12MB photo replicates it to everyone they talk to.
- **Whether a profile is visible before pairing.** It should not be: a ticket is
  shareable, and an unpaired stranger learning your name and face from one is a
  privacy regression against PRODUCT.md §5's "nothing is ever pushed" posture.
- **Local nickname wins.** If someone sets their display name to something
  abusive, the name I typed should keep priority. The app will do this, but the
  SDK should not assume its value is the one shown.

---

## 3. Media transfer — images, files

### The gap

`chat-service` carries `content: string`. There is no attachment, blob, or
stream API.

### Why not do it in the app

Base64 in a message body is the only app-level option. It is ~33% larger than
the file, it goes into the CRDT document permanently, and it is loaded into
memory whole on both sides. A handful of phone photos would make a
conversation document larger than every text message combined, forever, with no
way to delete one.

There is also no progress and no resumption: a 10MB send over a flaky mobile
link either completes or is retried from zero.

### What would close it

Content-addressed blobs, transferred separately from the message that
references them:

```ts
blobs.put(bytes: Uint8Array | ReadableStream, mime: string): Promise<BlobRef>
blobs.get(ref: BlobRef): Promise<Uint8Array>
blobs.onProgress(ref: BlobRef, handler: (sent: number, total: number) => void): () => void
chat.sendMessage({ channelId, content, attachments?: BlobRef[] })
```

iroh has blob transfer built in, which is likely why this is less work than it
looks.

Worth settling in the protocol:

- **Chunking and resumption**, so a dropped connection does not restart a send.
- **Whether blobs are garbage collected** when the referencing message is gone,
  and what happens to a blob whose sender is offline when the recipient asks.
- **A cap, and what the UI is told when it is exceeded** — an error the app can
  phrase, not a rejected send it cannot explain. The app currently reports a
  handshake timeout as "Invalid Ticket", which is what happens when failures
  arrive without distinguishable causes.

---

## Ordering

If these land one at a time, **ephemeral send first**. It is the smallest, it
unblocks presence, typing indicators, and read receipts together, and it is the
one whose absence is currently visible to users as a dot that means something
other than what everyone assumes.
