//! Iroh endpoint owned by Rust, driven from the webview over Tauri IPC.
//!
//! The webview runs the Dicsussion SDK but cannot open a QUIC socket, so the
//! native side owns the endpoint and moves bytes. Everything above the wire —
//! the RFC 001 §5 handshake, session-key derivation, framing, priority
//! banding — stays in the SDK, which is where it is tested. This module
//! deliberately knows nothing about any of it, and that is the point: a bug
//! here is a plumbing bug, never a protocol bug.
//!
//! ## Why the secret key comes from JavaScript
//!
//! A peer's ticket advertises a `transportKey`, which *is* the Iroh
//! `EndpointId`. The SDK derives it from the identity key by domain-separated
//! HKDF, and the derivation is one-way — it cannot be recomputed from the
//! `did:key` alone. So the endpoint must be bound with the key the SDK
//! derived. An endpoint minting its own key would advertise an `EndpointId`
//! no peer could dial, and the failure would look like a network problem.
//!
//! ## The pipe contract: ordered bytes, and nothing else
//!
//! **Do not add length prefixing, chunk headers, or any framing here.** The
//! contract is an ordered byte stream: chunks are forwarded exactly as QUIC
//! delivers them, split or coalesced, and boundaries carry no meaning. The
//! SDK frames its own control messages during the handshake and hands
//! everything afterwards to `FrameReader`, which reassembles from a byte
//! stream regardless of how it was chopped up.
//!
//! If both sides prefix, the handshake breaks — the SDK would read our header
//! as the first bytes of its own message. A well-meaning "let me preserve
//! message boundaries" change here is precisely the bug to avoid.
//!
//! **Order is the one guarantee that matters**, and it is load-bearing: a
//! single reader task per connection reads sequentially and emits in the order
//! it read. Nothing may be introduced that could reorder or drop a chunk.
//!
//! ## One stream per connection, not six
//!
//! RFC 001 §6 gives the protocol six sub-streams. This bridge carries all of
//! them over a single bidirectional QUIC stream and lets the SDK label each
//! frame, exactly as `WebSocketTransport` already does.
//!
//! The cost is real and worth stating: over six independent QUIC streams a
//! large `0x02` frame cannot delay an urgent `0x03` revocation, because they
//! are separate streams. Over one stream, priority becomes send-queue
//! ordering — a frame already in flight still finishes first. With frames
//! capped at 1 MB that is a bounded delay, not a stall, and it does not
//! affect the S1b/S2 gates. If it ever needs fixing, the change is confined
//! to this file and the transport implementation that talks to it.
//!
//! ## Identity is not established here
//!
//! Inbound connections report an `unverifiedTransportId`, never a `did:key`.
//! Iroh authenticates the *transport* key during TLS, which proves who owns
//! the endpoint and says nothing about who owns the identity. Only the SDK
//! handshake establishes that. Naming the field for what is actually known
//! keeps a caller from treating a connection as authenticated too early.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use iroh::{
    endpoint::{presets, Connection},
    Endpoint, EndpointAddr, EndpointId, RelayUrl, SecretKey, TransportAddr,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

/// ALPN identifying this protocol during the QUIC handshake (RFC 001 §4.2).
///
/// Must match `DICSUSSION_ALPN` in `@dicsussion/core/transport`. A mismatch is
/// refused during TLS with no protocol-level explanation, so these two are
/// worth keeping in step deliberately.
pub const DICSUSSION_ALPN: &[u8] = b"dicsussion/1";

/// Chunk size for reads. Frames are reassembled by the SDK's `FrameReader`,
/// so the bridge is free to deliver whatever the network hands it.
const READ_CHUNK: usize = 64 * 1024;

type Connections = Arc<Mutex<HashMap<String, mpsc::Sender<Vec<u8>>>>>;

/**
 * Connection ids must be unique per *connection*, never per peer.
 *
 * They were originally derived from the peer's transport key, which is stable
 * — so reconnecting to the same peer produced the same id. Inserting it into
 * the connection map then dropped the previous attempt's sender, whose writer
 * task promptly emitted `closed` for that id, and the SDK tore down the
 * channel it had just created. Every reconnection killed itself with the
 * remains of the last one, and only on the second attempt, which is why it
 * survived every single-shot test.
 */
static NEXT_CONN_ID: AtomicU64 = AtomicU64::new(1);

fn next_conn_id(direction: &str, peer_hint: &str) -> String {
    let n = NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed);
    // The peer fragment is kept for readability in logs; the counter is what
    // guarantees uniqueness.
    format!("{direction}-{n}-{}", &peer_hint[..peer_hint.len().min(8)])
}

#[derive(Default)]
pub struct IrohState {
    endpoint: Arc<Mutex<Option<Endpoint>>>,
    connections: Connections,
}

/// What the webview needs to build a `PeerTicket`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointIdentity {
    /// 32-byte Iroh `EndpointId`, hex encoded — the ticket's `transportKey`.
    pub endpoint_id: String,
    pub direct_addresses: Vec<String>,
    pub relay_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataEvent {
    conn_id: String,
    /// base64: a JSON array of numbers costs ~4x on the wire, base64 ~1.33x.
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InboundEvent {
    conn_id: String,
    /// The peer's Iroh `EndpointId`. **Not** an authenticated identity — see
    /// the module docs. The SDK handshake decides who this actually is.
    unverified_transport_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClosedEvent {
    conn_id: String,
    reason: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

/// Bind the endpoint using the SDK-derived transport secret and start
/// accepting inbound connections.
///
/// Idempotent: a webview reload calls this again, and rebinding would strand
/// peers already dialling the previous address.
#[tauri::command]
pub async fn iroh_start(
    secret_key: Vec<u8>,
    app: AppHandle,
    state: State<'_, IrohState>,
) -> Result<EndpointIdentity, String> {
    let bytes: [u8; 32] = secret_key
        .as_slice()
        .try_into()
        .map_err(|_| format!("transport secret must be 32 bytes, got {}", secret_key.len()))?;

    let mut guard = state.endpoint.lock().await;

    if guard.is_none() {
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(SecretKey::from_bytes(&bytes))
            .alpns(vec![DICSUSSION_ALPN.to_vec()])
            .bind()
            .await
            .map_err(|e| format!("failed to bind Iroh endpoint: {e}"))?;

        // Addresses are discovered asynchronously; without this the first
        // ticket advertises an empty address set and is relay-only.
        endpoint.online().await;

        spawn_accept_loop(endpoint.clone(), app, state.connections.clone());
        *guard = Some(endpoint);
    }

    Ok(describe(guard.as_ref().expect("bound above")))
}

/// Current identity and addresses. Addresses change with the network, so a
/// long-lived ticket should be refreshed from this rather than cached.
#[tauri::command]
pub async fn iroh_identity(state: State<'_, IrohState>) -> Result<EndpointIdentity, String> {
    let guard = state.endpoint.lock().await;
    let endpoint = guard
        .as_ref()
        .ok_or_else(|| "Iroh endpoint not started; call iroh_start first".to_string())?;
    Ok(describe(endpoint))
}

/// Shut the endpoint down, closing every live connection.
#[tauri::command]
pub async fn iroh_stop(state: State<'_, IrohState>) -> Result<(), String> {
    state.connections.lock().await.clear();
    if let Some(endpoint) = state.endpoint.lock().await.take() {
        endpoint.close().await;
    }
    Ok(())
}

// ─── Dial / send / close ─────────────────────────────────────────────────

/// Dial a peer and open the byte pipe.
///
/// Takes the ticket's parts rather than the ticket itself: decoding is the
/// SDK's job, and duplicating a wire format in two languages is how the two
/// drift apart.
#[tauri::command]
pub async fn iroh_connect(
    transport_key: Vec<u8>,
    direct_addresses: Vec<String>,
    relay_url: Option<String>,
    app: AppHandle,
    state: State<'_, IrohState>,
) -> Result<String, String> {
    let key: [u8; 32] = transport_key
        .as_slice()
        .try_into()
        .map_err(|_| format!("transportKey must be 32 bytes, got {}", transport_key.len()))?;

    let endpoint = {
        let guard = state.endpoint.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| "Iroh endpoint not started".to_string())?
            .clone()
    };

    let id = EndpointId::from_bytes(&key).map_err(|e| format!("invalid transportKey: {e}"))?;

    let mut addrs = std::collections::BTreeSet::new();
    for addr in &direct_addresses {
        match addr.parse() {
            Ok(socket) => {
                addrs.insert(TransportAddr::Ip(socket));
            }
            // One malformed address should not sink a dial that can still
            // succeed via the others or the relay.
            Err(_) => continue,
        }
    }
    if let Some(url) = relay_url.as_ref() {
        if let Ok(parsed) = url.parse::<RelayUrl>() {
            addrs.insert(TransportAddr::Relay(parsed));
        }
    }

    let connection = endpoint
        .connect(EndpointAddr { id, addrs }, DICSUSSION_ALPN)
        .await
        .map_err(|e| format!("dial failed: {e}"))?;

    let (send, recv) = connection
        .open_bi()
        .await
        .map_err(|e| format!("failed to open stream: {e}"))?;

    let conn_id = next_conn_id("out", &hex(&id.as_bytes()[..8]));
    register(conn_id.clone(), send, recv, connection, app, state.connections.clone()).await;

    Ok(conn_id)
}

/// Write bytes to a connection. `data` is base64.
#[tauri::command]
pub async fn iroh_send(
    conn_id: String,
    data: String,
    state: State<'_, IrohState>,
) -> Result<(), String> {
    let bytes = B64
        .decode(data.as_bytes())
        .map_err(|e| format!("payload is not valid base64: {e}"))?;

    let sender = {
        let guard = state.connections.lock().await;
        guard.get(&conn_id).cloned()
    };

    sender
        .ok_or_else(|| format!("no such connection: {conn_id}"))?
        .send(bytes)
        .await
        .map_err(|_| format!("connection {conn_id} is closed"))
}

#[tauri::command]
pub async fn iroh_disconnect(
    conn_id: String,
    state: State<'_, IrohState>,
) -> Result<(), String> {
    state.connections.lock().await.remove(&conn_id);
    Ok(())
}

// ─── Internals ───────────────────────────────────────────────────────────

fn spawn_accept_loop(endpoint: Endpoint, app: AppHandle, connections: Connections) {
    tauri::async_runtime::spawn(async move {
        while let Some(incoming) = endpoint.accept().await {
            let connection = match incoming.await {
                Ok(connection) => connection,
                // A failed inbound handshake is routine — a scan, a stale
                // dial, a peer that gave up. Not worth tearing the loop down.
                Err(_) => continue,
            };

            let (send, recv) = match connection.accept_bi().await {
                Ok(pair) => pair,
                Err(_) => continue,
            };

            let remote = hex(connection.remote_id().as_bytes());

            let conn_id = next_conn_id("in", &remote);

            let _ = app.emit(
                "iroh://inbound",
                InboundEvent {
                    conn_id: conn_id.clone(),
                    unverified_transport_id: remote,
                },
            );

            register(
                conn_id,
                send,
                recv,
                connection,
                app.clone(),
                connections.clone(),
            )
            .await;
        }
    });
}

/// Wire a stream pair to the webview: one task drains outbound writes, one
/// pumps inbound reads out as events.
async fn register(
    conn_id: String,
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    connection: Connection,
    app: AppHandle,
    connections: Connections,
) {
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(64);
    connections.lock().await.insert(conn_id.clone(), tx);

    // Writer.
    let writer_id = conn_id.clone();
    let writer_app = app.clone();
    let writer_conns = connections.clone();
    let writer_conn = connection.clone();
    tauri::async_runtime::spawn(async move {
        // Distinguish the two ways this loop ends. They mean opposite things:
        // a write failure is the network dying under us, while the channel
        // closing is an orderly teardown from above. Reporting both as
        // "write side closed" hid a real fault behind a routine message.
        let reason = loop {
            match rx.recv().await {
                Some(bytes) => {
                    if let Err(e) = send.write_all(&bytes).await {
                        // Ask the connection why, not just the stream — QUIC
                        // reports the useful cause at connection level
                        // (timeout, reset, path failure).
                        break match writer_conn.close_reason() {
                            Some(close) => format!("write failed: {e} (connection: {close})"),
                            None => format!("write failed: {e}"),
                        };
                    }
                }
                None => break "closed by host (disconnect or teardown)".to_string(),
            }
        };

        let _ = send.finish();
        writer_conns.lock().await.remove(&writer_id);
        let _ = writer_app.emit(
            "iroh://closed",
            ClosedEvent {
                conn_id: writer_id,
                reason,
            },
        );
    });

    // Reader.
    tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; READ_CHUNK];
        let reason = loop {
            match recv.read(&mut buf).await {
                Ok(Some(n)) if n > 0 => {
                    let _ = app.emit(
                        "iroh://data",
                        DataEvent {
                            conn_id: conn_id.clone(),
                            data: B64.encode(&buf[..n]),
                        },
                    );
                }
                Ok(Some(_)) => continue,
                Ok(None) => break "peer closed the stream".to_string(),
                Err(e) => break format!("read error: {e}"),
            }
        };

        connections.lock().await.remove(&conn_id);
        drop(connection);
        let _ = app.emit("iroh://closed", ClosedEvent { conn_id, reason });
    });
}

fn describe(endpoint: &Endpoint) -> EndpointIdentity {
    let addr = endpoint.addr();
    let mut direct_addresses = Vec::new();
    let mut relay_url = None;

    for transport in addr.addrs.iter() {
        match transport {
            TransportAddr::Ip(socket) => direct_addresses.push(socket.to_string()),
            // Keep the first relay only: a ticket carries a single
            // `derpRelay`, so advertising more would not round-trip.
            TransportAddr::Relay(url) if relay_url.is_none() => {
                relay_url = Some(url.to_string());
            }
            _ => {}
        }
    }

    EndpointIdentity {
        endpoint_id: hex(addr.id.as_bytes()),
        direct_addresses,
        relay_url,
    }
}
