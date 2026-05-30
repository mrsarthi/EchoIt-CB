import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
    initMessaging,
    sendEncryptedMessage,
    subscribeToMessages,
    registerUser,
    sendDeliveryReceipt,
    sendReadReceipt,
    onMessageReceipt,
    getHistory,
    sendTypingStatus,
    onTypingStatus,
    searchUser,
    flushPendingMessages,
    getUsersStatus,
    connectToPeer,
    decryptReceivedMessage
} from '../services/messageService';
import { getStoredKeys } from '../crypto/keyManager';
import {
    onConnectionChange,
    onUserStatus,
    onReconnect,
    getUser,
    emitCreateGroup,
    emitDeleteGroup,
    onGroupCreated,
    onGroupDeleted,
    onGroupMemberRemoved,
    ackOfflineMessages,
    onGroupAvatarUpdated,
    onReaction,
    updateSocketProfile,
    emitUpdateGroupAvatar
} from '../services/socketService';
import {
    saveMessage,
    getLocalHistory,
    saveMessagesBulk,
    saveContacts,
    getSavedContacts,
    clearHistory,
    migrateOldHistory,
    setJoinedAt,
    getMediaWatchList
} from '../services/storageService';
import { getLoadedMessages, loadPreviousEpoch, getLatestEpochIndex, migrateToYjs } from '../services/stateEngine';

import { getConversationTopic, subscribeToTopic } from '../services/wakuService';
import { initSwarmSync } from '../services/swarmSync';

export function useChat(myAddress) {
    const [messages, setMessages] = useState([]);
    const [contacts, setContacts] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    
    // Pagination (Epochs)
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const currentEpochRef = useRef(-1);
    
    const [error, setError] = useState(null);
    const [connectionType, setConnectionType] = useState('offline');
    const [serverConnected, setServerConnected] = useState(false);
    
    // Profile State
    const [myAvatar, setMyAvatar] = useState(() => localStorage.getItem('decentrachat_avatar') || null);
    const [myStatus, setMyStatus] = useState(() => localStorage.getItem('decentrachat_status') || null);
    const [myTrustScore, setMyTrustScore] = useState(0);
    const [myTrustStage, setMyTrustStage] = useState(1);
    const [myRegisteredAt, setMyRegisteredAt] = useState(null);

    const activeChatRef = useRef(null);
    const keysRef = useRef(null);
    const initializedRef = useRef(false);
    const syncCleanupRef = useRef(null);
    const statusUnsubscribeRef = useRef(null);
    const reconnectUnsubscribeRef = useRef(null);
    const [flushingOutbox, setFlushingOutbox] = useState(false);

    // Keep activeChatRef in sync
    useEffect(() => {
        activeChatRef.current = activeChat;
    }, [activeChat]);

    const [typingStatus, setTypingStatus] = useState({}); // { [chatId]: { [userAddress]: timestamp } }
    const typingTimeoutRef = useRef({});

    // Cleanup typing timeouts
    useEffect(() => {
        return () => {
            Object.values(typingTimeoutRef.current).forEach(timeout => clearTimeout(timeout));
        };
    }, []);

    // Persist contacts whenever they change
    useEffect(() => {
        if (contacts.length > 0) {
            saveContacts(contacts);
        }
    }, [contacts]);

    const fetchOfflineMessages = async () => {
        const { getSocket } = await import('../services/socketService');
        const socket = getSocket();
        if (socket) socket.emit('fetchOfflineMessages');
    };

    const createGroup = useCallback(async (groupName, memberAddresses) => {
        const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const allMembers = [...new Set([myAddress, ...memberAddresses])];
        const groupContact = {
            address: groupId, 
            username: groupName,
            isGroup: true,
            members: allMembers,
            admins: [myAddress],
            lastMessageTime: Date.now(),
            unreadCount: 0,
            online: true
        };

        setContacts(prev => [groupContact, ...prev]);
        setActiveChat({ address: groupId, info: groupContact, isGroup: true, members: groupContact.members });

        emitCreateGroup(groupId, groupName, allMembers, [myAddress], null);

        return groupContact;
    }, [myAddress]);

    const deleteGroup = useCallback(async (groupId) => {
        if (!groupId) return;

        let groupMembers = [];
        setContacts(prev => {
            const group = prev.find(c => c.address === groupId && c.isGroup);
            if (group) groupMembers = group.members || [];
            return prev;
        });

        setContacts(prev => prev.filter(c => c.address !== groupId));
        await clearHistory(groupId);
        if (activeChatRef.current?.address === groupId) {
            setActiveChat(null);
            setMessages([]);
        }

        if (groupMembers.length > 0) {
            emitDeleteGroup(groupId, groupMembers);
        }

        console.log(`🗑️ Group ${groupId} deleted and members notified`);
    }, []);

    const removeMember = useCallback(async (groupId, memberAddress) => {
        if (!groupId || !memberAddress) return;
        if (memberAddress.toLowerCase() === myAddress?.toLowerCase()) {
            await deleteGroup(groupId);
            return;
        }

        let currentMembers = [];

        setContacts(prev => prev.map(c => {
            if (c.address === groupId && c.isGroup) {
                currentMembers = c.members || [];
                return {
                    ...c,
                    members: (c.members || []).filter(
                        m => m.toLowerCase() !== memberAddress.toLowerCase()
                    )
                };
            }
            return c;
        }));

        const { emitRemoveGroupMember } = await import('../services/socketService');
        emitRemoveGroupMember(groupId, memberAddress, currentMembers);

        localStorage.setItem(`tripwire_${groupId}`, '100');

        if (activeChatRef.current?.address === groupId) {
            setActiveChat(prev => ({
                ...prev,
                members: (prev.members || []).filter(
                    m => m.toLowerCase() !== memberAddress.toLowerCase()
                ),
                info: {
                    ...prev.info,
                    members: (prev.info?.members || []).filter(
                        m => m.toLowerCase() !== memberAddress.toLowerCase()
                    )
                }
            }));
        }
        console.log(`👤 Removed ${memberAddress.slice(0, 10)} from group ${groupId}`);
    }, [myAddress, deleteGroup]);

    // ====== REACTIONS ======

    const applyReaction = (msgs, messageId, emoji, from, action) => {
        return msgs.map(m => {
            if (m.id !== messageId) return m;
            const reactions = { ...(m.reactions || {}) };
            const list = [...(reactions[emoji] || [])];
            const idx = list.findIndex(a => a.toLowerCase() === from.toLowerCase());

            if (action === 'add' && idx === -1) {
                list.push(from);
            } else if (action === 'remove' && idx !== -1) {
                list.splice(idx, 1);
            }

            if (list.length > 0) {
                reactions[emoji] = list;
            } else {
                delete reactions[emoji];
            }
            return { ...m, reactions };
        });
    };

    const toggleReaction = useCallback(async (messageId, emoji) => {
        if (!messageId || !emoji || !myAddress) return;

        const msg = messages.find(m => m.id === messageId);
        if (!msg) return;
        const existing = (msg.reactions?.[emoji] || []);
        const alreadyReacted = existing.some(a => a.toLowerCase() === myAddress.toLowerCase());
        const action = alreadyReacted ? 'remove' : 'add';

        setMessages(prev => applyReaction(prev, messageId, emoji, myAddress, action));

        const chatId = activeChatRef.current?.address;
        if (chatId) {
            const updated = applyReaction([msg], messageId, emoji, myAddress, action)[0];
            await saveMessage(chatId, updated);
        }

        const ac = activeChatRef.current;
        const { emitReaction } = await import('../services/messageService');
        if (ac?.isGroup) {
            emitReaction(messageId, emoji, action, null, ac.address, ac.members);
        } else {
            const to = ac?.address;
            emitReaction(messageId, emoji, action, to, null, null);
        }
    }, [messages, myAddress]);

    const sendTyping = useCallback((isTyping) => {
        if (!activeChat || !myAddress) return;

        if (activeChat.isGroup) {
            activeChat.members?.forEach(memberAddr => {
                if (memberAddr.toLowerCase() !== myAddress.toLowerCase()) {
                    sendTypingStatus(memberAddr, isTyping, activeChat.address);
                }
            });
        } else {
            sendTypingStatus(activeChat.address, isTyping);
        }
    }, [activeChat, myAddress]);

    // Cleanup existing connection listeners before re-binding
    useEffect(() => {
        if (!myAddress || initializedRef.current) return;

        let mounted = true;

        (async () => {
            await initMessaging();
            await migrateToYjs();
            await migrateOldHistory();

            const fetchOwnProfile = async () => {
                try {
                    const profile = await getUser(myAddress);
                    if (profile && mounted) {
                        if (profile.trustScore !== undefined) setMyTrustScore(profile.trustScore);
                        if (profile.trustStage !== undefined) setMyTrustStage(profile.trustStage);
                        if (profile.registeredAt !== undefined) setMyRegisteredAt(profile.registeredAt);
                    }
                } catch (err) {
                    console.debug('Failed to fetch own profile:', err);
                }
            };
            
            fetchOwnProfile();
            await setJoinedAt(Date.now());

            const syncGroups = async () => {
                try {
                    const { getMyGroups } = await import('../services/socketService');
                    const serverGroups = await getMyGroups();
                    if (serverGroups && serverGroups.length > 0) {
                        setContacts(prev => {
                            const newContacts = [...prev];
                            let changed = false;

                            serverGroups.forEach(sg => {
                                const existing = prev.find(c => c.address.toLowerCase() === sg.address.toLowerCase());
                                if (!existing) {
                                    newContacts.push(sg);
                                    changed = true;
                                } else if (JSON.stringify(existing.members) !== JSON.stringify(sg.members)) {
                                    const idx = newContacts.findIndex(c => c.address.toLowerCase() === sg.address.toLowerCase());
                                    newContacts[idx] = { ...existing, members: sg.members };
                                    changed = true;
                                }
                            });

                            return changed ? newContacts : prev;
                        });
                    }
                } catch (err) {
                    console.error('Failed to sync groups:', err);
                }
            };

            syncGroups();
            onReconnect(syncGroups);

            const cachedContacts = await getSavedContacts();
            if (mounted && cachedContacts.length > 0) {
                setContacts(cachedContacts);
                
                // Subscribe to Waku topics for all contacts
                cachedContacts.forEach(async (c) => {
                    const topic = await getConversationTopic(c.address, myAddress, c.isGroup);
                    subscribeToTopic(topic);
                });

                // Also subscribe to our own "discovery" topic for new incoming chats
                getConversationTopic(myAddress).then(topic => subscribeToTopic(topic));

                const addresses = cachedContacts.map(c => c.address);
                getUsersStatus(addresses).then(statuses => {
                    if (!mounted) return;
                    setContacts(prev => prev.map(c => {
                        const statusObj = statuses[c.address.toLowerCase()];
                        if (statusObj) {
                            return { 
                                ...c, 
                                online: statusObj.online, 
                                lastSeen: statusObj.lastSeen,
                                ...(statusObj.avatar !== undefined && statusObj.avatar !== null && { avatar: statusObj.avatar }),
                                ...(statusObj.status !== undefined && statusObj.status !== null && { status: statusObj.status }),
                                ...(statusObj.trustScore !== undefined && { trustScore: statusObj.trustScore }),
                                ...(statusObj.trustStage !== undefined && { trustStage: statusObj.trustStage }),
                                ...(statusObj.registeredAt !== undefined && { registeredAt: statusObj.registeredAt })
                            };
                        }
                        return c;
                    }));
                }).catch(err => console.debug('Failed to sync initial contact statuses', err));
            }

            const keys = await getStoredKeys();
            if (!keys || !mounted) return;
            keysRef.current = keys;

            onTypingStatus(({ from, isTyping, groupId }) => {
                const chatId = groupId || from;
                setTypingStatus(prev => {
                    const chatStatus = prev[chatId] || {};
                    if (!isTyping) {
                        const newStatus = { ...chatStatus };
                        delete newStatus[from];
                        return { ...prev, [chatId]: newStatus };
                    }
                    return { ...prev, [chatId]: { ...chatStatus, [from]: Date.now() } };
                });
                const timeoutKey = `${chatId}_${from}`;
                if (typingTimeoutRef.current[timeoutKey]) clearTimeout(typingTimeoutRef.current[timeoutKey]);
                if (isTyping) {
                    typingTimeoutRef.current[timeoutKey] = setTimeout(() => {
                        setTypingStatus(prev => {
                            const chatStatus = prev[chatId];
                            if (!chatStatus) return prev;
                            const newStatus = { ...chatStatus };
                            delete newStatus[from];
                            return { ...prev, [chatId]: newStatus };
                        });
                    }, 5000);
                }
            });

            subscribeToMessages(async (msg) => {
                // Handle batch history updates from Swarm Sync (Layer 5)
                if (msg.type === 'SWARM_SYNC_BATCH') {
                    if (activeChatRef.current?.address?.toLowerCase() === msg.chatId?.toLowerCase()) {
                        console.log(`🐝 SwarmSync: Refreshing messages for ${msg.chatId}`);
                        const refreshedMessages = getLoadedMessages(msg.chatId);
                        setMessages(refreshedMessages);
                    }
                    return;
                }

                const contactId = msg.groupId || msg.from;
                const isGroup = !!msg.groupId;

                // Trigger Waku subscription for new conversation
                getConversationTopic(contactId, myAddress, isGroup).then(topic => subscribeToTopic(topic));

                let processedMsg = msg;
                if (processedMsg.decryptionFailed && !processedMsg.isRetry && !processedMsg.groupId) {
                    try {
                        const { verifyRecipientKey, decryptReceivedMessage } = await import('../services/messageService');
                        const contact = contacts.find(c => c.address.toLowerCase() === processedMsg.from?.toLowerCase());
                        const changed = await verifyRecipientKey(processedMsg.from, contact);
                        if (changed) {
                            const retried = await decryptReceivedMessage({ ...processedMsg, isRetry: true }, keysRef.current, myAddress);
                            if (!retried.decryptionFailed) processedMsg = retried;
                        }
                    } catch (err) { console.error('Emergency key refresh failed:', err); }
                }

                const isActive = activeChatRef.current?.address?.toLowerCase() === contactId?.toLowerCase();
                if (processedMsg.from && processedMsg.from.toLowerCase() !== myAddress.toLowerCase()) {
                    if (isActive) processedMsg.status = 'read'; 
                }

                try {
                    await saveMessage(contactId, processedMsg);
                    if (processedMsg.id) ackOfflineMessages([processedMsg.id]);
                } catch (err) { console.error('Failed to persist incoming message:', err); }

                if (processedMsg.from && processedMsg.from.toLowerCase() !== myAddress.toLowerCase()) {
                    sendDeliveryReceipt(processedMsg.from, processedMsg.id, contactId);
                    if (isActive) sendReadReceipt(processedMsg.from, processedMsg.id, contactId);
                }

                setMessages(prev => {
                    const exists = prev.some(m => m.id === processedMsg.id);
                    if (exists) return prev.map(m => m.id === processedMsg.id ? processedMsg : m);
                    const activeAddress = activeChatRef.current?.address?.toLowerCase();
                    if (!activeAddress) return prev;
                    const isActiveGroup = activeChatRef.current?.isGroup;
                    let isRelevant = isActiveGroup ? processedMsg.groupId === activeAddress : (!processedMsg.groupId && (processedMsg.from?.toLowerCase() === activeAddress || processedMsg.to?.toLowerCase() === activeAddress));
                    if (isRelevant) return [...prev, processedMsg];
                    return prev;
                });

                if (msg.from && msg.from.toLowerCase() !== myAddress.toLowerCase()) {
                    setContacts(prev => {
                        const contactId = msg.groupId || msg.from;
                        const isGroup = !!msg.groupId;
                        const existingIndex = prev.findIndex(c => c.address.toLowerCase() === contactId.toLowerCase());
                        const isCurrentChat = activeChatRef.current?.address?.toLowerCase() === contactId.toLowerCase();

                        if (existingIndex === -1) {
                            const newContact = isGroup ? {
                                address: msg.groupId,
                                username: msg.groupName || 'Unknown Group',
                                isGroup: true,
                                members: msg.members || [myAddress, msg.from],
                                lastMessageTime: msg.timestamp,
                                unreadCount: isCurrentChat ? 0 : 1,
                                online: true
                            } : {
                                address: msg.from,
                                username: msg.senderUsername,
                                lastMessageTime: msg.timestamp,
                                unreadCount: isCurrentChat ? 0 : 1,
                                online: true,
                                lastSeen: Date.now()
                            };
                            return [newContact, ...prev];
                        } else {
                            const updated = [...prev];
                            updated[existingIndex] = {
                                ...updated[existingIndex],
                                lastMessageTime: msg.timestamp,
                                unreadCount: isCurrentChat ? 0 : (updated[existingIndex].unreadCount || 0) + 1,
                                online: true,
                                lastSeen: Date.now(),
                                ...(isGroup && msg.members && { members: msg.members }),
                                ...(!isGroup && msg.senderUsername && { username: msg.senderUsername })
                            };
                            updated.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
                            return updated;
                        }
                    });
                }
            }, keys);

            onGroupCreated((data) => {
                const { id, groupId, groupName, members, admins, createdBy } = data;
                if (!groupId) return;
                if (id) ackOfflineMessages([id]);
                setContacts(prev => prev.some(c => c.address.toLowerCase() === groupId.toLowerCase()) ? prev : [{
                    address: groupId,
                    username: groupName || 'Unknown Group',
                    isGroup: true,
                    members: members || [myAddress, createdBy],
                    admins: admins || [createdBy],
                    lastMessageTime: data.timestamp || Date.now(),
                    unreadCount: 0,
                    online: true
                }, ...prev]);
            });

            onGroupDeleted(async (data) => {
                const { id, groupId } = data;
                if (!groupId) return;
                if (id) ackOfflineMessages([id]);
                setContacts(prev => prev.filter(c => c.address !== groupId));
                await clearHistory(groupId);
                if (activeChatRef.current?.address === groupId) {
                    setActiveChat(null);
                    setMessages([]);
                }
            });

            onGroupMemberRemoved((data) => {
                const { groupId, memberAddress } = data;
                if (!groupId || !memberAddress) return;
                setContacts(prev => prev.map(c => {
                    if (c.address === groupId && c.isGroup && c.members) {
                        return { ...c, members: c.members.filter(m => m.toLowerCase() !== memberAddress.toLowerCase()) };
                    }
                    return c;
                }));
            });

            onGroupAvatarUpdated((data) => {
                const { id, groupId, avatar } = data;
                if (!groupId) return;
                if (id) ackOfflineMessages([id]);
                setContacts(prev => prev.map(c => (c.address === groupId && c.isGroup) ? { ...c, avatar } : c));
                if (activeChatRef.current?.address === groupId) {
                    setActiveChat(prev => ({ ...prev, info: { ...prev.info, avatar } }));
                }
            });

            onReaction((data) => {
                const { id, messageId, emoji, from, action } = data;
                if (!messageId || !emoji || !from) return;
                if (id) ackOfflineMessages([id]);
                setMessages(prev => prev.some(m => m.id === messageId) ? applyReaction(prev, messageId, emoji, from, action || 'add') : prev);
                const chatId = activeChatRef.current?.address;
                if (chatId) {
                    getLocalHistory(chatId).then(history => {
                        const msg = history.find(m => m.id === messageId);
                        if (msg) saveMessage(chatId, applyReaction([msg], messageId, emoji, from, action || 'add')[0]);
                    });
                }
            });

            // ====== MEDIA SWARM LOGIC ======
            import('../services/socketService').then(({ onMediaQuery, onMediaOffer, offerMedia }) => {
                const handledQueries = new Set();
                
                onMediaQuery(async (data) => {
                    const { mediaId, chatId } = data.signal;
                    if (handledQueries.has(mediaId)) return; // Don't respond if someone else already offered
                    
                    const { hasMedia, getMedia } = await import('../services/storageService');
                    if (await hasMedia(mediaId)) {
                        console.log(`[Media Swarm] 🩺 I have ${mediaId}, offering to re-seed...`);
                        offerMedia(chatId, mediaId);
                        handledQueries.add(mediaId); // Prevent duplicate reseeding
                        
                        // Grab the manifest from our messages
                        let targetMsg = null;
                        setMessages(prev => {
                            targetMsg = prev.find(m => m.mediaId === mediaId);
                            return prev;
                        });
                        
                        // If not in current chat view, search local storage history
                        if (!targetMsg) {
                            const history = await getLocalHistory(chatId);
                            targetMsg = history.find(m => m.mediaId === mediaId);
                        }
                        
                        if (targetMsg?.manifest) {
                            const base64Data = await getMedia(mediaId);
                            const { reseedMediaToRelays } = await import('../services/mediaTransport');
                            await reseedMediaToRelays(base64Data, targetMsg.manifest);
                        }
                    }
                });

                onMediaOffer((data) => {
                    const { mediaId } = data.signal;
                    console.log(`[Media Swarm] 🤫 Peer offered ${mediaId}. Staying silent.`);
                    handledQueries.add(mediaId);
                });
            });
            // ===============================

            onMessageReceipt(({ messageId, type, from, chatId }) => {
                if (from) {
                    setContacts(prev => {
                        if (prev.some(c => c.address.toLowerCase() === from.toLowerCase())) return prev;
                        getUser(from).then(freshUser => {
                            if (freshUser) {
                                setContacts(latest => latest.some(c => c.address.toLowerCase() === from.toLowerCase()) ? latest : [...latest, {
                                    address: freshUser.address,
                                    username: freshUser.username,
                                    avatar: freshUser.avatar,
                                    online: freshUser.online,
                                    lastMessageTime: Date.now(),
                                    unreadCount: 0,
                                    trustScore: freshUser.trustScore,
                                    trustStage: freshUser.trustStage,
                                    registeredAt: freshUser.registeredAt
                                }]);
                            }
                        }).catch(() => {});
                        return prev;
                    });
                }
                
                // Update messages state, preventing downgrading from 'read' to 'delivered'
                setMessages(prev => prev.map(m => {
                    if (m.id === messageId) {
                        const currentType = m.receipts?.[from.toLowerCase()];
                        if (currentType === 'read' && type === 'delivered') return m;
                        return { ...m, receipts: { ...(m.receipts || {}), [from.toLowerCase()]: type } };
                    }
                    return m;
                }));

                if (from && messageId) {
                    // For DMs, the chatId for storage is the peer's address (from), 
                    // whereas for groups it is the groupId.
                    const storageChatId = (chatId && chatId.startsWith('group_')) ? chatId : from;
                    import('../services/storageService').then(s => s.updateMessageReceipt(storageChatId, [messageId], from, type).catch(() => {}));
                }
            });

            onConnectionChange(async (isConnected) => {
                setServerConnected(isConnected);
                if (!isConnected) setConnectionType('offline');
            });

            statusUnsubscribeRef.current = onUserStatus((data) => {
                const { address: userAddr, online, lastSeen, avatar, status, trustScore, trustStage, registeredAt } = data;
                setContacts(prev => prev.map(c => (!c.isGroup && c.address.toLowerCase() === userAddr.toLowerCase()) ? { 
                    ...c, online, lastSeen, 
                    ...(avatar && { avatar }), 
                    ...(status && { status }),
                    ...(trustScore !== undefined && { trustScore }),
                    ...(trustStage !== undefined && { trustStage }),
                    ...(registeredAt !== undefined && { registeredAt })
                } : c));
                if (activeChatRef.current?.address?.toLowerCase() === userAddr.toLowerCase() && !activeChatRef.current.isGroup) {
                    setActiveChat(prev => ({ 
                        ...prev, online, lastSeen, 
                        ...(avatar && { avatar }), 
                        ...(status && { status }),
                        info: {
                            ...prev.info,
                            online,
                            lastSeen,
                            ...(avatar && { avatar }),
                            ...(status && { status }),
                            ...(trustScore !== undefined && { trustScore }),
                            ...(trustStage !== undefined && { trustStage }),
                            ...(registeredAt !== undefined && { registeredAt })
                        }
                    }));
                }
                if (online && myAddress) {
                    flushPendingMessages(myAddress, ({ id, msgStatus }) => {
                        setMessages(prev => prev.map(m => m.id === id ? { ...m, status: msgStatus, transport: 'relay' } : m));
                    }).catch(() => {});

                    // Check Media Watch List (Phase 3: Presence Trigger)
                    getMediaWatchList().then(async (watchList) => {
                        if (watchList.length > 0) {
                            const { requestMedia } = await import('../services/socketService');
                            const { getSavedContacts } = await import('../services/storageService');
                            const savedContacts = await getSavedContacts();
                            
                            watchList.forEach(item => {
                                let shouldRequest = false;
                                if (item.chatId.toLowerCase() === userAddr.toLowerCase()) {
                                    shouldRequest = true; // Direct message peer came online
                                } else {
                                    const group = savedContacts.find(c => c.address === item.chatId && c.isGroup);
                                    if (group && group.members && group.members.some(m => m.toLowerCase() === userAddr.toLowerCase())) {
                                        shouldRequest = true; // A group member came online
                                    }
                                }
                                
                                if (shouldRequest) {
                                    console.log(`[Media Swarm] 🔄 Peer ${userAddr.slice(0,6)} online. Re-requesting ${item.mediaId}`);
                                    requestMedia(item.chatId, item.mediaId);
                                }
                            });
                        }
                    }).catch(() => {});
                }
            });

            if (!mounted) return;
            fetchOfflineMessages();
            initializedRef.current = true;

            reconnectUnsubscribeRef.current = onReconnect(async () => {
                console.log('🔄 Reconnect detected. Syncing...');
                fetchOfflineMessages();
                fetchOwnProfile();
                setFlushingOutbox(true);
                try {
                    await flushPendingMessages(myAddress, ({ id, status }) => {
                        setMessages(prev => prev.map(m => m.id === id ? { ...m, status, transport: 'relay' } : m));
                    });
                } catch (err) { console.error('Outbox flush failed:', err); } finally { setFlushingOutbox(false); }

                setContacts(currentContacts => {
                    const contactsToSync = [...currentContacts];
                    (async () => {
                        for (const contact of contactsToSync) {
                            if (contact.isGroup) continue;
                            try {
                                const serverHistory = await getHistory(contact.address);
                                if (serverHistory && serverHistory.length > 0) {
                                    const localHistory = await getLocalHistory(contact.address);
                                    const existingIds = new Set(localHistory.map(m => m.id));
                                    const newMsgs = serverHistory.filter(m => !existingIds.has(m.id));
                                    if (newMsgs.length > 0) {
                                        await saveMessagesBulk(contact.address, newMsgs);
                                        const isActiveChat = activeChatRef.current?.address?.toLowerCase() === contact.address.toLowerCase();
                                        setContacts(prev => prev.map(c => c.address.toLowerCase() === contact.address.toLowerCase() ? { ...c, lastMessageTime: Math.max(c.lastMessageTime || 0, ...newMsgs.map(m => m.timestamp)) } : c));
                                        if (isActiveChat && keysRef.current) {
                                            const { decryptReceivedMessage } = await import('../services/messageService');
                                            for (const msg of newMsgs) {
                                                const decrypted = await decryptReceivedMessage(msg, keysRef.current, myAddress);
                                                setMessages(prev => prev.some(m => m.id === decrypted.id) ? prev : [...prev, decrypted].sort((a, b) => (a.savedAt || a.timestamp) - (b.savedAt || b.timestamp) || (a.id || '').localeCompare(b.id || '')));
                                            }
                                        }
                                    }
                                }
                            } catch {
                                // Silent skip for sync failures
                            }
                        }
                    })();
                    return currentContacts;
                });
            });
        })();

        const handleFocus = () => {
            const chat = activeChatRef.current;
            if (!chat) return;
            setMessages(prev => {
                let changed = false;
                const unreadIds = [];
                const updated = prev.map(m => {
                    if (m.from?.toLowerCase() !== myAddress?.toLowerCase() && m.status !== 'read') {
                        sendReadReceipt(m.from, m.id, chat.address);
                        unreadIds.push(m.id);
                        changed = true;
                        return { ...m, status: 'read' };
                    }
                    return m;
                });
                
                if (changed && unreadIds.length > 0) {
                    import('../services/storageService').then(s => 
                        s.updateMessageReceipt(chat.address, unreadIds, myAddress, 'read').catch(() => {})
                    );
                }
                
                return changed ? updated : prev;
            });
        };
        window.addEventListener('focus', handleFocus);
        let nativeListener = null;
        if (Capacitor.isNativePlatform()) {
            nativeListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) handleFocus(); });
        }
        return () => {
            mounted = false;
            window.removeEventListener('focus', handleFocus);
            if (nativeListener) nativeListener.then(l => l.remove()).catch(() => {
                // Already removed
            });
            if (statusUnsubscribeRef.current) statusUnsubscribeRef.current();
            if (reconnectUnsubscribeRef.current) reconnectUnsubscribeRef.current();
            Object.values(typingTimeoutRef.current).forEach(t => clearTimeout(t));
        };
    }, [myAddress]);

    useEffect(() => {
        if (!activeChatRef.current || activeChatRef.current.isGroup) return;
        setContacts(prev => prev.some(c => c.address.toLowerCase() === activeChatRef.current.address.toLowerCase() && c.unreadCount > 0) ? prev.map(c => c.address.toLowerCase() === activeChatRef.current.address.toLowerCase() ? { ...c, unreadCount: 0 } : c) : prev);
    }, [messages, activeChat]);

    const sendMessage = useCallback(async (content, replyTo = null, type = 'text', metadata = {}) => {
        if (!activeChat || !myAddress) {
            setError('No active chat');
            return;
        }
        try {
            if (activeChat.isGroup) {
                const start = Date.now();
                const { sendGroupMessage } = await import('../services/messageService');
                await sendGroupMessage(activeChat.address, content, activeChat.members, replyTo, { groupName: activeChat.info?.username || 'Group', type, ...metadata });
                const sentMessage = { id: `msg_${start}_${myAddress}`, from: myAddress, content, replyTo, timestamp: start, status: 'sent', groupId: activeChat.address, isGroup: true, type, ...metadata };
                await saveMessage(activeChat.address, sentMessage);
                setMessages(prev => [...prev, sentMessage]);
                return sentMessage;
            } else {
                const sentMessage = await sendEncryptedMessage(myAddress, activeChat.address, content, replyTo, { type, ...metadata }, activeChat.publicKey);
                const enrichedMessage = { ...sentMessage, ...metadata };
                await saveMessage(activeChat.address, enrichedMessage);
                setMessages(prev => [...prev, enrichedMessage]);
                return enrichedMessage;
            }
        } catch (err) {
            setError({ message: err.message, level: err.level || 'error' });
            throw err;
        }
    }, [activeChat, myAddress]);

    const openChat = useCallback(async (address, userInfo = null) => {
        console.log('🔵 openChat called:', { address, userInfo: userInfo?.username, activeChatRef: activeChatRef.current?.address });
        if (!address) { console.error('❌ openChat called with no address'); return; }
        if (activeChatRef.current?.address?.toLowerCase() === address.toLowerCase()) {
            console.log('🔵 openChat: already viewing this chat, skipping');
            return;
        }
        let contact = contacts.find(c => c.address.toLowerCase() === address.toLowerCase());
        console.log('🔵 openChat: contact found?', !!contact, contact?.username);
        if (!contact && userInfo) {
            contact = { address: userInfo.address, username: userInfo.username, lastMessageTime: Date.now(), unreadCount: 0, online: false };
            setContacts(prev => [contact, ...prev]);
        }
        if (contact) {
            setContacts(prev => prev.map(c => c.address.toLowerCase() === address.toLowerCase() ? { ...c, unreadCount: 0 } : c));
        }
        console.log('🔵 openChat: setting activeChat now');
        setActiveChat({ address, info: contact || userInfo || { address }, isGroup: contact?.isGroup || false, members: contact?.members || [] });
        if (contact && !contact.isGroup) {
            import('../services/messageService').then(async ({ verifyRecipientKey }) => {
                const changed = await verifyRecipientKey(address, contact);
                if (changed) {
                    const freshUser = await getUser(address);
                    if (freshUser) {
                        setContacts(prev => prev.map(c => c.address.toLowerCase() === address.toLowerCase() ? { ...c, publicKey: freshUser.publicKey, isVerified: false, trustScore: freshUser.trustScore, trustStage: freshUser.trustStage, registeredAt: freshUser.registeredAt } : c));
                    }
                }
            }).catch(() => {});
        }
        // Waku topic & swarm sync (non-blocking — don't let failures prevent chat from opening)
        try {
            const topic = await getConversationTopic(address, myAddress, contact?.isGroup || false);
            subscribeToTopic(topic);
        } catch (err) { console.warn('⚠️ Failed to subscribe to Waku topic:', err); }
        try {
            if (syncCleanupRef.current) syncCleanupRef.current();
            initSwarmSync(address, myAddress, address, contact?.isGroup || false).then(cleanup => { syncCleanupRef.current = cleanup; }).catch(() => {});
        } catch (err) { console.warn('⚠️ Failed to init swarm sync:', err); }
        if (!contact?.isGroup && myAddress.toLowerCase() > address.toLowerCase()) {
            connectToPeer(address).catch(() => {});
        }
        setMessages([]);
        setIsLoading(true);
        setHasMoreMessages(true);
        try {
            currentEpochRef.current = await getLatestEpochIndex(address);
            const localHistory = await getLocalHistory(address);
            let merged = [...(localHistory || [])];
            try {
                const serverHistory = await getHistory(address);
                const existingIds = new Set(merged.map(m => m.id));
                const newServerMsgsRaw = serverHistory.filter(m => !existingIds.has(m.id));
                const newServerMsgs = [];
                for (const msg of newServerMsgsRaw) {
                    const decrypted = await decryptReceivedMessage(msg, keysRef.current, myAddress);
                    newServerMsgs.push(decrypted);
                }
                merged = [...merged, ...newServerMsgs].sort((a, b) => (a.savedAt || a.timestamp) - (b.savedAt || b.timestamp) || (a.id || '').localeCompare(b.id || ''));
                if (newServerMsgs.length > 0) saveMessagesBulk(address, newServerMsgs);
            } catch (histErr) { console.warn('⚠️ Server history fetch failed, using local only:', histErr); }
            if (!(contact?.isGroup)) merged = merged.filter(m => !m.groupId);
            const unreadIds = [];
            const mappedMessages = merged.map(m => {
                if (m.from?.toLowerCase() !== myAddress?.toLowerCase() && m.status !== 'read') {
                    sendReadReceipt(m.from, m.id, address);
                    unreadIds.push(m.id);
                    return { ...m, status: 'read' };
                }
                return m;
            });
            setMessages(mappedMessages);
            if (unreadIds.length > 0) {
                const { updateMessageReceipt } = await import('../services/storageService');
                updateMessageReceipt(address, unreadIds, myAddress, 'read').catch(() => {});
            }
        } catch (err) { console.error('Error loading chat:', err); } finally { setIsLoading(false); }
        setConnectionType('p2p');
    }, [contacts, myAddress]);

    const loadMoreMessages = useCallback(async () => {
        if (!activeChat || isLoadingMore || !hasMoreMessages) return;
        const chatId = activeChat.address;
        if (currentEpochRef.current <= 0) { setHasMoreMessages(false); return; }
        setIsLoadingMore(true);
        try {
            const prevEpoch = await loadPreviousEpoch(chatId, currentEpochRef.current);
            if (!prevEpoch || prevEpoch.ymap.size === 0) { setHasMoreMessages(false); currentEpochRef.current = 0; }
            else { currentEpochRef.current -= 1; setMessages(getLoadedMessages(chatId)); }
        } catch (err) { console.error('Error loading previous epoch:', err); } finally { setIsLoadingMore(false); }
    }, [activeChat, messages, isLoadingMore, hasMoreMessages]);

    const searchAndAddContact = useCallback(async (query) => {
        try {
            const user = await searchUser(query);
            if (user) {
                const exists = contacts.find(c => c.address.toLowerCase() === user.address.toLowerCase());
                if (!exists) {
                    const newContact = { 
                        address: user.address, username: user.username || null, 
                        lastMessageTime: Date.now(), unreadCount: 0, online: user.online || false,
                        trustScore: user.trustScore, trustStage: user.trustStage, registeredAt: user.registeredAt
                    };
                    setContacts(prev => [newContact, ...prev]);
                    return newContact;
                }
                return exists;
            }
            return null;
        } catch (err) { console.error('Search failed:', err); return null; }
    }, [contacts]);

    const updateGroupAvatar = useCallback((groupId, avatarBase64) => {
        if (!groupId) return;
        const group = contacts.find(c => c.address === groupId && c.isGroup);
        if (!group) return;
        setContacts(prev => prev.map(c => c.address === groupId && c.isGroup ? { ...c, avatar: avatarBase64 } : c));
        if (activeChatRef.current?.address === groupId) {
            setActiveChat(prev => ({ ...prev, info: { ...prev.info, avatar: avatarBase64 } }));
        }
        emitUpdateGroupAvatar(groupId, avatarBase64, group.members || []);
    }, [contacts]);

    const saveProfile = useCallback((newAvatar, newStatus) => {
        if (newAvatar !== undefined) {
            if (newAvatar === null) localStorage.removeItem('decentrachat_avatar');
            else localStorage.setItem('decentrachat_avatar', newAvatar);
            setMyAvatar(newAvatar);
        }
        if (newStatus !== undefined) {
            if (newStatus === null) localStorage.removeItem('decentrachat_status');
            else localStorage.setItem('decentrachat_status', newStatus);
            setMyStatus(newStatus);
        }
        updateSocketProfile(newAvatar !== undefined ? newAvatar : myAvatar, newStatus !== undefined ? newStatus : myStatus);
    }, [myAvatar, myStatus]);

    const closeChat = useCallback(() => {
        setActiveChat(null);
        setMessages([]);
        setConnectionType('offline');
        setTypingStatus({});
    }, []);

    const verifyContact = useCallback(async (address, isVerified) => {
        if (!address) return;
        setContacts(prev => prev.map(c => c.address.toLowerCase() === address.toLowerCase() ? { ...c, isVerified } : c));
        if (activeChatRef.current?.address?.toLowerCase() === address.toLowerCase()) {
            setActiveChat(prev => ({ ...prev, info: { ...prev.info, isVerified } }));
        }
        if (isVerified) {
            const { emitVerifyContact } = await import('../services/socketService');
            emitVerifyContact(address).then(response => {
                if (response && response.success) alert(`Successfully verified! They received +${response.pointsAwarded} POC points.`);
            });
        }
    }, []);

    const reportSpam = useCallback(async (address, reason) => {
        if (!address) return;
        const { emitReportSpam } = await import('../services/socketService');
        return emitReportSpam(address, reason).then(response => {
            if (response && response.success) {
                alert(`Reported for spam. Reputation penalty applied: ${response.penaltyApplied} POC.`);
                return true;
            } else {
                alert(`Report failed: ${response?.error || 'Unknown error'}`);
                return false;
            }
        });
    }, []);

    return {
        activeChat, messages, contacts, isLoading, isLoadingMore, hasMoreMessages, error, connectionType, serverConnected, typingStatus, flushingOutbox, openChat, closeChat, sendMessage, sendTyping, createGroup, deleteGroup, removeMember, searchAndAddContact, toggleReaction, loadMoreMessages, myAvatar, myStatus, myTrustScore, myTrustStage, myRegisteredAt, saveProfile, updateGroupAvatar, verifyContact, reportSpam, clearError: () => setError(null),
    };
}
