import { createLightNode, waitForRemotePeer, createEncoder, createDecoder } from '@waku/sdk';
import protobuf from 'protobufjs';

const APP_NAME = 'decentrachat';
const PROTO_VERSION = 'v3';

// Define the protobuf structure for our messages
const WakuMessage = new protobuf.Type('WakuMessage')
    .add(new protobuf.Field('payload', 1, 'string'))
    .add(new protobuf.Field('signature', 2, 'string', 'optional'));

let wakuNode = null;
const activeSubscriptions = new Map(); // topic -> subscription

let messageCallback = null;

import nacl from 'tweetnacl';

/**
 * Derive a unique, opaque Waku Content Topic for a conversation.
 * Uses SHA-512 (truncated to 32 bytes) to prevent communication graph leakage.
 */
export async function getConversationTopic(toAddress, fromAddress = null, isGroup = false) {
    let id;
    if (isGroup) {
        id = toAddress.toLowerCase();
    } else {
        // Sort addresses for consistent topic derivation in 1-1 chats
        const sorted = [toAddress.toLowerCase(), fromAddress?.toLowerCase()].filter(Boolean).sort();
        id = sorted.join('_');
    }

    // Hash the ID to make it opaque (using tweetnacl to avoid secure context issues)
    const encoder = new TextEncoder();
    const data = encoder.encode(id);
    const hashBuffer = nacl.hash(data).slice(0, 32); // first 32 bytes
    const hashArray = Array.from(hashBuffer);
    const hashedId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const type = isGroup ? 'group' : 'dm';
    return `/${APP_NAME}/${PROTO_VERSION}/${type}/${hashedId}`;
}

/**
 * Initialize the Waku Light Node and connect to the public Waku network
 */
export async function initWaku() {
    if (wakuNode) return;

    try {
        console.log('🌐 Waku: Starting Light Node...');
        
        // Start a Light Node for mobile/browser environments
        wakuNode = await createLightNode({ defaultBootstrap: true });
        await wakuNode.start();
        
        console.log('🌐 Waku: Waiting for peers...');
        await waitForRemotePeer(wakuNode);
        
        const connections = wakuNode.libp2p.getConnections();
        console.log(`✅ Waku: Connected to ${connections.length} peers in the mesh network`);
        
    } catch (err) {
        console.error('❌ Waku Initialization Failed:', err);
        wakuNode = null;
    }
}

/**
 * Send an encrypted payload into the Waku gossip network
 * @param {Object} payload The fully encrypted message payload object
 * @param {string} toAddress The recipient address or groupId
 * @param {string} fromAddress Our address
 * @param {boolean} isGroup Whether it's a group message
 * @returns {boolean} Success state
 */
export async function sendViaWaku(payload, toAddress, fromAddress, isGroup = false) {
    if (!wakuNode) {
        console.warn('Waku node is not initialized');
        return false;
    }

    try {
        const topic = await getConversationTopic(toAddress, fromAddress, isGroup);
        const PUBSUB_TOPIC = "/waku/2/default-waku/proto";
        const encoder = createEncoder({ 
            contentTopic: topic, 
            routingInfo: { pubsubTopic: PUBSUB_TOPIC } 
        });
        
        // Stringify payload since encryption handles the security layer
        const payloadStr = JSON.stringify(payload);
        
        // Encode using protobuf
        const message = WakuMessage.create({ payload: payloadStr });
        const serialized = WakuMessage.encode(message).finish();

        // Push to the network using Lightpush (saves bandwidth)
        const result = await wakuNode.lightpush.send(encoder, {
            payload: serialized
        });

        if (result.errors && result.errors.length > 0) {
            console.error(`⚠️ Waku Lightpush errors on topic ${topic}:`, result.errors);
            return false;
        }

        console.log(`🚀 Waku: Message pushed to mesh on isolated topic: ${topic}`);
        return true;
    } catch (err) {
        console.error('Waku send error:', err);
        return false;
    }
}

/**
 * Subscribe to a specific conversation's isolated topic
 */
export async function subscribeToTopic(topic) {
    if (!wakuNode || activeSubscriptions.has(topic)) return;

    try {
        // Ensure we are connected to peers before subscribing, to prevent silent hangs
        await waitForRemotePeer(wakuNode);

        const PUBSUB_TOPIC = "/waku/2/default-waku/proto";
        const decoder = createDecoder(topic, { pubsubTopic: PUBSUB_TOPIC });
        const subscription = await wakuNode.filter.subscribe([decoder], (wakuMessage) => {
            if (!wakuMessage.payload) return;

            try {
                // Decode protobuf
                const decoded = WakuMessage.decode(wakuMessage.payload);
                // Parse JSON payload
                const payload = JSON.parse(decoded.payload);
                
                console.log(`📩 Waku: Received message on topic ${topic}`);
                
                if (messageCallback) {
                    messageCallback(payload);
                }
            } catch (err) {
                console.error('Waku Message Decoding Error:', err);
            }
        });
        
        activeSubscriptions.set(topic, subscription);
        console.log(`🎧 Waku: Subscribed to isolated topic: ${topic}`);
    } catch (err) {
        console.error(`Waku Filter Subscribe Error on ${topic}:`, err);
    }
}

/**
 * Register a callback to receive incoming Waku messages
 * @param {Function} callback 
 */
export function onWakuMessage(callback) {
    messageCallback = callback;
}
