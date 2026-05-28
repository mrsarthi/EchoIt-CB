// WebRTC Service - P2P peer connection management
import * as socketService from './socketService';
import { handleIncomingMediaChunk } from './mediaTransport';


// SimplePeer will be loaded dynamically
let SimplePeer = null;

// Active peer connections
const peers = new Map(); // address -> SimplePeer instance
const connectionStates = new Map(); // address -> 'connecting' | 'connected' | 'disconnected'

// Callbacks
let dataCallback = null;
let initialized = false;

// STUN servers for NAT traversal (free Google servers)
let iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
];

/**
 * Initialize WebRTC service
 */
export async function init() {
    if (initialized) return;

    // --- TASK 7: WebRTC TURN Infrastructure ---
    // Fetch ephemeral credentials from the signaling server
    try {
        console.log('📡 WebRTC: Fetching TURN credentials...');
        const response = await fetch(`${socketService.SERVER_URL}/api/turn`);
        const servers = await response.json();
        
        if (Array.isArray(servers) && servers.length > 0) {
            iceServers = servers;
            console.log('✅ WebRTC: Loaded TURN/ICE servers from registry');
        }
    } catch (err) {
        console.warn('⚠️ WebRTC: Failed to fetch TURN servers, using public STUN fallback:', err.message);
    }

    // Dynamically import SimplePeer to avoid SSR/initialization issues
    try {
        const module = await import('simple-peer');
        SimplePeer = module.default || module;
        console.log('✓ SimplePeer loaded');
    } catch (err) {
        console.error('Failed to load SimplePeer:', err);
        return;
    }

    // Listen for incoming signals from socket service (Primary)
    socketService.onSignal(({ from, signal }) => {
        handleIncomingSignal(from, signal);
    });



    initialized = true;
}

/**
 * Handle incoming WebRTC signal
 */
function handleIncomingSignal(fromAddress, signal) {
    const addressKey = fromAddress.toLowerCase();
    let peer = peers.get(addressKey);

    // If no peer exists, create one (we're receiving a call)
    if (!peer) {
        peer = createPeer(addressKey, false);
    }

    // Apply the signal (only if peer was created successfully)
    if (peer) {
        peer.signal(signal);
    }
}

/**
 * Create a peer connection
 * @param {string} peerAddress - Address of the peer
 * @param {boolean} initiator - Whether we're initiating the connection
 */
function createPeer(peerAddress, initiator) {
    const addressKey = peerAddress.toLowerCase();
    if (!SimplePeer) {
        console.error('SimplePeer not loaded yet');
        return null;
    }

    console.log(`🔗 Creating peer connection to ${addressKey.slice(0, 10)}... (initiator: ${initiator})`);

    connectionStates.set(addressKey, 'connecting');

    // V3 Hardening: Add a connection timeout
    const connectionTimeout = setTimeout(() => {
        if (connectionStates.get(addressKey) === 'connecting') {
            console.warn(`⏳ P2P connection to ${addressKey.slice(0, 10)} timed out.`);
            connectionStates.set(addressKey, 'disconnected');
            if (peers.has(addressKey)) {
                peers.get(addressKey).destroy();
                peers.delete(addressKey);
            }
        }
    }, 7000); // 7 seconds (aggressive for mobile failover)

    const peer = new SimplePeer({
        initiator,
        trickle: true,
        config: {
            iceServers: iceServers // Task 7: Use dynamic ICE servers
        }
    });

    // Send signals to the other peer via signaling server
    peer.on('signal', (signal) => {
        // 1. Try Socket (Primary)
        if (socketService.isConnected()) {
            socketService.sendSignal(peerAddress, signal);
        } else {
            console.warn('⚠️ Server disconnected. Cannot send WebRTC signal.');
        }
    });

    // Connection established
    peer.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log(`⚡ P2P connected to ${addressKey.slice(0, 10)}!`);
        connectionStates.set(addressKey, 'connected');
    });

    // Receive data from peer
    peer.on('data', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // --- Layer 4: Media Chunk Routing ---
            if (message.type === 'MEDIA_CHUNK') {
                handleIncomingMediaChunk(message);
                return;
            }

            console.log(`📩 Received P2P message from ${peerAddress.slice(0, 10)}`);
            if (dataCallback) {
                dataCallback(message, peerAddress);
            }
        } catch (err) {
            console.error('Failed to parse P2P message:', err);
        }
    });

    // Connection closed
    peer.on('close', () => {
        console.log(`🔌 P2P connection closed with ${addressKey.slice(0, 10)}`);
        connectionStates.set(addressKey, 'disconnected');
        peers.delete(addressKey);
    });

    // Error handling
    peer.on('error', (err) => {
        console.error(`P2P error with ${addressKey.slice(0, 10)}:`, err.message);
        connectionStates.set(addressKey, 'disconnected');
        peers.delete(addressKey);
    });

    peers.set(addressKey, peer);
    return peer;
}

/**
 * Connect to a peer
 * @param {string} peerAddress
 */
export async function connectToPeer(peerAddress) {
    const addressKey = peerAddress.toLowerCase();
    // Check if already connected
    const existingPeer = peers.get(addressKey);
    if (existingPeer && !existingPeer.destroyed) {
        return existingPeer;
    }

    // Check if peer is online
    const isOnline = await socketService.checkOnline(addressKey);
    if (!isOnline) {
        console.log(`Peer ${addressKey.slice(0, 10)} is offline, using relay`);
        return null;
    }

    // Create new connection as initiator
    return createPeer(addressKey, true);
}

/**
 * Send data to a peer via P2P
 * @param {string} peerAddress
 * @param {Object} data
 * @returns {boolean} Success
 */
export function sendToPeer(peerAddress, data) {
    const addressKey = peerAddress.toLowerCase();
    const peer = peers.get(addressKey);

    if (peer && peer.connected && !peer.destroyed) {
        try {
            peer.send(JSON.stringify(data));
            console.log(`⚡ Sent P2P message to ${addressKey.slice(0, 10)}`);
            return true;
        } catch (err) {
            console.error('P2P send failed:', err);
            return false;
        }
    }

    return false;
}

/**
 * Subscribe to incoming P2P data
 * @param {Function} callback
 */
export function onData(callback) {
    dataCallback = callback;
}

/**
 * Get connection type for a peer
 * @param {string} peerAddress
 * @returns {'p2p' | 'relay' | 'offline'}
 */
export function getConnectionType(peerAddress) {
    const addressKey = peerAddress.toLowerCase();
    const state = connectionStates.get(addressKey);
    if (state === 'connected') return 'p2p';

    // Check if online via relay
    const peer = peers.get(addressKey);
    if (!peer || peer.destroyed) {
        return 'relay'; // Will use server relay
    }

    return state === 'connecting' ? 'relay' : 'offline';
}

/**
 * Check if peer is P2P connected
 * @param {string} peerAddress
 */
export function isPeerConnected(peerAddress) {
    const addressKey = peerAddress.toLowerCase();
    const peer = peers.get(addressKey);
    return peer && peer.connected && !peer.destroyed;
}

/**
 * Destroy a peer connection
 * @param {string} peerAddress
 */
export function destroyPeer(peerAddress) {
    const addressKey = peerAddress.toLowerCase();
    const peer = peers.get(addressKey);
    if (peer) {
        peer.destroy();
        peers.delete(addressKey);
        connectionStates.delete(addressKey);
    }
}

/**
 * Destroy all peer connections
 */
export function destroyAll() {
    peers.forEach((peer, address) => {
        peer.destroy();
    });
    peers.clear();
    connectionStates.clear();
}
