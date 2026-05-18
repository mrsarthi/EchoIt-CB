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
    getUsersStatus
} from '../services/messageService';
import { getStoredKeys } from '../crypto/keyManager';
import {
    onConnectionChange,
    onUserStatus,
    onReconnect,
    getUser,
    onGroupMessage,
    emitCreateGroup,
    emitDeleteGroup,
    onGroupCreated,
    onGroupDeleted,
    emitReaction,
    onReaction,
    emitUpdateGroupAvatar,
    onGroupAvatarUpdated,
    updateProfile as updateSocketProfile,
    fetchOfflineMessages,
    ackOfflineMessages
} from '../services/socketService';
import {
    saveMessage,
    getLocalHistory,
    getMessagesPaginated,
    saveMessagesBulk,
    saveContacts,
    getSavedContacts,
    clearHistory,
    migrateOldHistory,
    saveMedia,
    getMedia,
    setJoinedAt,
    getJoinedAt
} from '../services/storageService';

export function useChat(myAddress) {
    const [messages, setMessages] = useState([]);
    const [contacts, setContacts] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [error, setError] = useState(null);
    const [connectionType, setConnectionType] = useState('offline');
    const [serverConnected, setServerConnected] = useState(false);
    
    // Profile State
    const [myAvatar, setMyAvatar] = useState(() => localStorage.getItem('decentrachat_avatar') || null);
    const [myStatus, setMyStatus] = useState(() => localStorage.getItem('decentrachat_status') || null);

    const activeChatRef = useRef(null);
    const keysRef = useRef(null);
    const initializedRef = useRef(false);
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

    const createGroup = useCallback(async (groupName, memberAddresses) => {
        const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const allMembers = [...new Set([myAddress, ...memberAddresses])];
        const groupContact = {
            address: groupId, // Use groupId as the address key
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

        // Notify all members via the server so it shows up on their devices
        emitCreateGroup(groupId, groupName, allMembers, [myAddress], null);

        return groupContact;
    }, [myAddress]);

    const deleteGroup = useCallback(async (groupId) => {
        if (!groupId) return;

        // Capture members BEFORE removing the group so we can notify them
        let groupMembers = [];
        setContacts(prev => {
            const group = prev.find(c => c.address === groupId && c.isGroup);
            if (group) groupMembers = group.members || [];
            return prev;
        });

        // Remove from contacts
        setContacts(prev => prev.filter(c => c.address !== groupId));
        // Clear local message history
        await clearHistory(groupId);
        // Close chat if this group is currently open
        if (activeChatRef.current?.address === groupId) {
            setActiveChat(null);
            setMessages([]);
        }

        // Notify all members via the server so they also remove it
        if (groupMembers.length > 0) {
            emitDeleteGroup(groupId, groupMembers);
        }

        console.log(`🗑️ Group ${groupId} deleted and members notified`);
    }, []);

    const removeMember = useCallback(async (groupId, memberAddress) => {
        if (!groupId || !memberAddress) return;
        // If removing self, treat as leaving the group
        if (memberAddress.toLowerCase() === myAddress?.toLowerCase()) {
            await deleteGroup(groupId);
            return;
        }

        let currentMembers = [];

        // Update the members list in contacts
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

        // Notify server to update registry and broadcast
        import('../services/socketService').then(({ emitRemoveGroupMember }) => {
            emitRemoveGroupMember(groupId, memberAddress, currentMembers);
        });

        // Also update active chat if this group is open
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

    // Helper: apply a reaction mutation to a messages array
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

        // Check if we already reacted with this emoji
        const msg = messages.find(m => m.id === messageId);
        if (!msg) return;
        const existing = (msg.reactions?.[emoji] || []);
        const alreadyReacted = existing.some(a => a.toLowerCase() === myAddress.toLowerCase());
        const action = alreadyReacted ? 'remove' : 'add';

        // Update local state immediately
        setMessages(prev => applyReaction(prev, messageId, emoji, myAddress, action));

        // Persist the updated message to storage
        const chatId = activeChatRef.current?.address;
        if (chatId) {
            const updated = applyReaction([msg], messageId, emoji, myAddress, action)[0];
            await saveMessage(chatId, updated);
        }

        // Emit to server
        const ac = activeChatRef.current;
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
            // Send to all members except me
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
            // ... (Init logic remains same, but we hook into onTypingStatus too)
            await initMessaging();

            // Run V2 Storage Migration (one-time, no-op if already done)
            await migrateOldHistory();

            // Set "Member Since" date (first-time only)
            await setJoinedAt(Date.now());

            // --- TASK 6: Group Syncing from Server Registry ---
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
                                    // Update member list if changed
                                    const idx = newContacts.findIndex(c => c.address.toLowerCase() === sg.address.toLowerCase());
                                    newContacts[idx] = { ...existing, members: sg.members };
                                    changed = true;
                                }
                            });

                            return changed ? newContacts : prev;
                        });
                        console.log(`👥 Synced ${serverGroups.length} groups from server registry.`);
                    }
                } catch (err) {
                    console.error('Failed to sync groups:', err);
                }
            };

            // Sync immediately and on every reconnection
            syncGroups();
            const unsubReconnectGroups = onReconnect(syncGroups);

            // --- TASK 11: Group History Catch-up ---
            const catchUpGroups = async () => {
                const currentContacts = await getSavedContacts();
                const groupChats = currentContacts.filter(c => c.isGroup);
                
                for (const group of groupChats) {
                    try {
                        const { getMessagesPaginated } = await import('../services/storageService');
                        const localMsgs = await getMessagesPaginated(group.address, 1);
                        const lastSeq = localMsgs.length > 0 ? (localMsgs[0].sequence_no || 0) : 0;
                        
                        console.log(`🔄 Catching up group ${group.address.slice(0, 8)} from seq ${lastSeq}...`);
                        const missed = await socketService.syncGroup(group.address, lastSeq);
                        
                        if (missed && missed.length > 0) {
                            console.log(`📥 Integrating ${missed.length} missed messages for group ${group.address.slice(0, 8)}`);
                            for (const msg of missed) {
                                await saveMessage(group.address, msg);
                            }
                            
                            // If this is the active chat, update the UI
                            if (activeChatRef.current?.address?.toLowerCase() === group.address.toLowerCase()) {
                                setMessages(prev => {
                                    const newMsgs = [...prev];
                                    missed.forEach(m => {
                                        if (!newMsgs.some(em => em.id === m.id)) {
                                            newMsgs.push(m);
                                        }
                                    });
                                    return newMsgs.sort((a, b) => a.timestamp - b.timestamp);
                                });
                            }
                        }
                    } catch (err) {
                        console.error(`Catch-up failed for group ${group.address}:`, err);
                    }
                }
            };

            catchUpGroups();
            const unsubReconnectCatchup = onReconnect(catchUpGroups);

            // Load persist contacts immediately
            const cachedContacts = await getSavedContacts();
            if (mounted && cachedContacts.length > 0) {
                setContacts(cachedContacts);
                
                // Fetch latest online/avatar data for all loaded contacts
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
                                ...(statusObj.status !== undefined && statusObj.status !== null && { status: statusObj.status })
                            };
                        }
                        return c;
                    }));
                }).catch(err => console.debug('Failed to sync initial contact statuses', err));
            }

            const keys = await getStoredKeys();
            if (!keys || !mounted) return;
            keysRef.current = keys;

            // IMPORTANT: Set up all message subscriptions BEFORE registering.
            // The server delivers offline messages immediately on register,
            // so handlers must be ready before we call registerUser.

            // Subscribe to typing status
            onTypingStatus(({ from, isTyping, groupId }) => {
                const chatId = groupId || from;

                setTypingStatus(prev => {
                    const chatStatus = prev[chatId] || {};

                    if (!isTyping) {
                        const newStatus = { ...chatStatus };
                        delete newStatus[from];
                        return { ...prev, [chatId]: newStatus };
                    }

                    return {
                        ...prev,
                        [chatId]: {
                            ...chatStatus,
                            [from]: Date.now()
                        }
                    };
                });

                // Auto-clear after 3 seconds (safety net)
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
                const contactId = msg.groupId || msg.from;
                
                // Task 3: Emergency Key Refresh for decryption failures
                let processedMsg = msg;
                if (processedMsg.decryptionFailed && !processedMsg.isRetry && !processedMsg.groupId) {
                    console.log(`🔍 Decryption failed for message from ${processedMsg.from?.slice(0, 10)}. Triggering emergency key refresh...`);
                    try {
                        const { verifyRecipientKey, decryptReceivedMessage } = await import('../services/messageService');
                        const contact = contacts.find(c => c.address.toLowerCase() === processedMsg.from?.toLowerCase());
                        const changed = await verifyRecipientKey(processedMsg.from, contact);
                        
                        if (changed) {
                            // If key changed, try one more time (though if they used our old key, this still fails)
                            // But if WE are the sender loading history, this is crucial.
                            const retried = await decryptReceivedMessage({ ...processedMsg, isRetry: true }, keysRef.current, myAddress);
                            if (!retried.decryptionFailed) {
                                processedMsg = retried;
                                console.log('✅ Emergency key refresh recovered the message!');
                            }
                        }
                    } catch (err) {
                        console.error('Emergency key refresh failed:', err);
                    }
                }

                console.log('📨 Received message:', {
                    id: processedMsg.id,
                    from: processedMsg.from,
                    to: processedMsg.to,
                    groupId: processedMsg.groupId,
                    contactId,
                    content: processedMsg.content?.slice(0, 20)
                });

                // Determine if the chat is actively open to mark it read instantly in storage
                const isActive = activeChatRef.current?.address?.toLowerCase() === contactId?.toLowerCase();
                if (processedMsg.from && processedMsg.from.toLowerCase() !== myAddress.toLowerCase()) {
                    if (isActive) {
                        processedMsg.status = 'read'; 
                    }
                }

                // Save to local storage immediately
                try {
                    await saveMessage(contactId, processedMsg);
                    if (processedMsg.id) ackOfflineMessages([processedMsg.id]);
                    console.log(`💾 Persisted incoming message from ${contactId}`);
                } catch (err) {
                    console.error('❌ Failed to persist incoming message:', err);
                }

                // Send delivery receipts (for DMs and Groups)
                if (processedMsg.from && processedMsg.from.toLowerCase() !== myAddress.toLowerCase()) {
                    sendDeliveryReceipt(processedMsg.from, processedMsg.id, contactId);
                    if (isActive) {
                        sendReadReceipt(processedMsg.from, processedMsg.id, contactId);
                    }
                }

                // Handle incoming message
                setMessages(prev => {
                    const exists = prev.some(m => m.id === processedMsg.id);
                    if (exists) return prev.map(m => m.id === processedMsg.id ? processedMsg : m);

                    // Filter: Only add if it belongs to current active chat
                    const activeAddress = activeChatRef.current?.address?.toLowerCase();
                    if (!activeAddress) return prev;

                    const isActiveGroup = activeChatRef.current?.isGroup;
                    let isRelevant = false;

                    if (isActiveGroup) {
                        // Active chat is Group. Msg must match group ID.
                        isRelevant = processedMsg.groupId === activeAddress;
                    } else {
                        // Active chat is DM. Msg must be DM (no groupId) and match contact address.
                        // Either from contact OR sent by me to contact
                        if (!processedMsg.groupId) {
                            isRelevant = (processedMsg.from?.toLowerCase() === activeAddress) ||
                                (processedMsg.to?.toLowerCase() === activeAddress);
                        }
                    }

                    if (isRelevant) {
                        return [...prev, processedMsg];
                    }
                    return prev;
                });

                // Update contacts / Create Group if needed
                if (msg.from && msg.from.toLowerCase() !== myAddress.toLowerCase()) {
                    setContacts(prev => {
                        // Determine the "Contact ID" (User ID or Group ID)
                        const contactId = msg.groupId || msg.from;
                        const isGroup = !!msg.groupId;

                        const existingIndex = prev.findIndex(c => c.address.toLowerCase() === contactId.toLowerCase());
                        const isCurrentChat = activeChatRef.current?.address?.toLowerCase() === contactId.toLowerCase();

                        if (existingIndex === -1) {
                            if (isGroup) {
                                // NEW GROUP DISCOVERED
                                return [{
                                    address: msg.groupId,
                                    username: msg.groupName || 'Unknown Group',
                                    isGroup: true,
                                    members: msg.members || [myAddress, msg.from], // Fallback
                                    lastMessageTime: msg.timestamp,
                                    unreadCount: isCurrentChat ? 0 : 1,
                                    online: true
                                }, ...prev];
                            } else {
                                // NEW DM
                                return [{
                                    address: msg.from,
                                    username: msg.senderUsername,
                                    lastMessageTime: msg.timestamp,
                                    unreadCount: isCurrentChat ? 0 : 1,
                                    online: true,
                                    lastSeen: Date.now()
                                }, ...prev];
                            }
                        } else {
                            // Update existing
                            const updated = [...prev];
                            const existing = updated[existingIndex];

                            updated[existingIndex] = {
                                ...existing,
                                lastMessageTime: msg.timestamp,
                                unreadCount: isCurrentChat ? 0 : (existing.unreadCount || 0) + 1,
                                online: true,
                                lastSeen: Date.now()
                            };

                            // Update group metadata if provided
                            if (isGroup && msg.members) {
                                updated[existingIndex].members = msg.members;
                            }
                            // Update dm username if provided
                            if (!isGroup && msg.senderUsername) {
                                updated[existingIndex].username = msg.senderUsername;
                            }

                            // Move to top
                            updated.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
                            return updated;
                        }
                    });
                }
            }, keys);

            // Subscribe to server-delivered group messages (handles offline queued delivery)
            onGroupMessage(async (msg) => {
                if (!msg.groupId) return;

                // Find the matching group contact
                const groupContact = contacts.find(c => c.isGroup && c.address === msg.groupId);
                if (!groupContact) return; // Not a group we know about, ignore

                // Persist to local storage
                try {
                    await saveMessage(msg.groupId, msg);
                    if (msg.id) ackOfflineMessages([msg.id]);
                } catch (err) {
                    console.error('Failed to persists group message:', err);
                }

                // Add to messages state if the group chat is currently open
                if (activeChatRef.current?.address === msg.groupId) {
                    setMessages(prev => {
                        if (prev.some(m => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });
                } else {
                    // Increment unread badge on the group contact
                    setContacts(prev => prev.map(c =>
                        c.address === msg.groupId
                            ? { ...c, unreadCount: (c.unreadCount || 0) + 1, lastMessageTime: msg.timestamp }
                            : c
                    ));
                }
            });

            // Listen for group created events (other members notifying us)
            onGroupCreated((data) => {
                const { id, groupId, groupName, members, admins, createdBy } = data;
                if (!groupId) return;

                // ACK delivery immediately upon processing
                if (id) ackOfflineMessages([id]);

                // Add group to contacts if we don't already have it
                setContacts(prev => {
                    const exists = prev.some(c => c.address.toLowerCase() === groupId.toLowerCase());
                    if (exists) return prev;

                    console.log(`👥 New group received: ${groupName} (${groupId.slice(0, 10)})`);
                    return [{
                        address: groupId,
                        username: groupName || 'Unknown Group',
                        isGroup: true,
                        members: members || [myAddress, createdBy],
                        admins: admins || [createdBy],
                        lastMessageTime: data.timestamp || Date.now(),
                        unreadCount: 0,
                        online: true
                    }, ...prev];
                });
            });

            // Listen for group deleted events (admin deleted the group)
            onGroupDeleted(async (data) => {
                const { id, groupId } = data;
                if (!groupId) return;

                console.log(`👥 Group deleted notification: ${groupId.slice(0, 10)}`);

                // ACK delivery immediately
                if (id) ackOfflineMessages([id]);

                // Remove from contacts
                setContacts(prev => prev.filter(c => c.address !== groupId));

                // Clear local message history
                await clearHistory(groupId);

                // Close chat if this group is currently open
                if (activeChatRef.current?.address === groupId) {
                    setActiveChat(null);
                    setMessages([]);
                }
            });

            // Listen for group avatar updates from admins
            onGroupAvatarUpdated((data) => {
                const { id, groupId, avatar } = data;
                if (!groupId) return;

                // ACK delivery immediately
                if (id) ackOfflineMessages([id]);

                // Update avatar on the group contact
                setContacts(prev => prev.map(c =>
                    c.address === groupId && c.isGroup
                        ? { ...c, avatar: avatar }
                        : c
                ));

                // Update active chat if this group is currently open
                if (activeChatRef.current?.address === groupId) {
                    setActiveChat(prev => ({
                        ...prev,
                        info: { ...prev.info, avatar: avatar }
                    }));
                }

                console.log(`👥🖼 Group avatar updated for ${groupId.slice(0, 10)}`);
            });

            // Listen for incoming reactions from other participants
            onReaction((data) => {
                const { id, messageId, emoji, from, action } = data;
                if (!messageId || !emoji || !from) return;

                // ACK delivery immediately
                if (id) ackOfflineMessages([id]);

                // Update messages state if we have this message loaded
                setMessages(prev => {
                    const hasMsg = prev.some(m => m.id === messageId);
                    if (!hasMsg) return prev;
                    return applyReaction(prev, messageId, emoji, from, action || 'add');
                });

                // Persist to storage
                const chatId = activeChatRef.current?.address;
                if (chatId) {
                    getLocalHistory(chatId).then(history => {
                        const msg = history.find(m => m.id === messageId);
                        if (msg) {
                            const updated = applyReaction([msg], messageId, emoji, from, action || 'add')[0];
                            saveMessage(chatId, updated);
                        }
                    });
                }
            });

            // ... (rest of init - receipts, connection, status) ...
            // Copying existing receipt/connection logic...
            onMessageReceipt(({ messageId, type, from, chatId }) => {
                // Task 13: Background profile fetch for unknown senders
                if (from) {
                    setContacts(prev => {
                        const isKnown = prev.some(c => c.address.toLowerCase() === from.toLowerCase());
                        if (!isKnown) {
                            getUser(from).then(freshUser => {
                                if (freshUser) {
                                    setContacts(latest => {
                                        if (latest.some(c => c.address.toLowerCase() === from.toLowerCase())) return latest;
                                        return [...latest, {
                                            address: freshUser.address,
                                            username: freshUser.username,
                                            avatar: freshUser.avatar,
                                            online: freshUser.online,
                                            lastMessageTime: Date.now(),
                                            unreadCount: 0
                                        }];
                                    });
                                }
                            }).catch(err => console.debug('Background profile fetch failed:', err));
                        }
                        return prev;
                    });
                }

                // Update local state if the chat is currently active
                setMessages(prev => prev.map(m => {
                    if (m.id === messageId) {
                        const newReceipts = { ...(m.receipts || {}) };
                        newReceipts[from.toLowerCase()] = type;
                        return { ...m, receipts: newReceipts };
                    }
                    return m;
                }));
                
                // Persist the receipt into storage so it survives app restarts
                if (from && messageId) {
                    import('../services/storageService').then(s => {
                         // Pass chatId to enable localized high-performance writes to both DB versions
                         s.updateMessageReceipt(chatId, [messageId], from, type).catch(err => console.debug('Failed updating receipt:', err));
                    });
                }
            });

            onConnectionChange(async (isConnected) => {
                setServerConnected(isConnected);
                if (!isConnected) setConnectionType('offline');
                // ... sync status logic ...
            });

            // Listen for user status updates (online/offline)
            statusUnsubscribeRef.current = onUserStatus((data) => {
                const { address: userAddr, online, lastSeen, avatar, status } = data;
                
                // Update contacts
                setContacts(prev => prev.map(c => {
                    if (!c.isGroup && c.address.toLowerCase() === userAddr.toLowerCase()) {
                        return { 
                            ...c, 
                            online, 
                            lastSeen,
                            // Only overwrite avatar/status if server actually has data.
                            // When server restarts, these come back as null/undefined — don't erase local cache.
                            ...(avatar && { avatar }),
                            ...(status && { status })
                        };
                    }
                    return c;
                }));
                
                // Update active chat info if viewing that user
                if (activeChatRef.current?.address?.toLowerCase() === userAddr.toLowerCase() && !activeChatRef.current.isGroup) {
                    setActiveChat(prev => ({ 
                        ...prev, 
                        online, 
                        lastSeen,
                        ...(avatar && { avatar }),
                        ...(status && { status })
                    }));
                }

                // When a contact comes online, flush any queued messages for them
                if (online && myAddress) {
                    flushPendingMessages(myAddress, ({ id, msgStatus }) => {
                        setMessages(prev => prev.map(m =>
                            m.id === id ? { ...m, status: msgStatus, transport: 'relay' } : m
                        ));
                    }).catch(err => console.debug('Flush on status change failed:', err));
                }
            });

            // NOW register — all handlers are ready to receive offline messages
            await registerUser(myAddress, keys.publicKey);
            if (!mounted) return;

            // Handlers are up, Explicitly ask server to dump offline messages
            fetchOfflineMessages();

            initializedRef.current = true;

            // === RECONNECT HANDLER ===
            // On reconnect: flush outbox + sync missed messages for all contacts
            reconnectUnsubscribeRef.current = onReconnect(async () => {
                console.log('🔄 Reconnect detected. Syncing offline messages...');

                // 0. Fetch anything queued in the server's volatile offlineMessages map
                fetchOfflineMessages();

                // 1. Flush outbox (send queued messages)
                setFlushingOutbox(true);
                try {
                    const result = await flushPendingMessages(myAddress, ({ id, status }) => {
                        // Update message status in active chat if visible
                        setMessages(prev => prev.map(m =>
                            m.id === id ? { ...m, status, transport: 'relay' } : m
                        ));
                    });
                    if (result.sent > 0) {
                        console.log(`📤 Flushed ${result.sent} queued messages`);
                    }
                } catch (err) {
                    console.error('Outbox flush failed:', err);
                } finally {
                    setFlushingOutbox(false);
                }

                // 2. Sync missed messages for all contacts
                setContacts(currentContacts => {
                    // Use the latest contacts state
                    const contactsToSync = [...currentContacts];

                    // Fire async sync but don't await in the setState
                    (async () => {
                        for (const contact of contactsToSync) {
                            if (contact.isGroup) continue; // Groups use fan-out, skip
                            try {
                                const serverHistory = await getHistory(contact.address);
                                if (serverHistory && serverHistory.length > 0) {
                                    const localHistory = await getLocalHistory(contact.address);
                                    const existingIds = new Set(localHistory.map(m => m.id));
                                    const newMsgs = serverHistory.filter(m => !existingIds.has(m.id));

                                    if (newMsgs.length > 0) {
                                        await saveMessagesBulk(contact.address, newMsgs);
                                        console.log(`📥 Synced ${newMsgs.length} missed messages for ${contact.address.slice(0, 10)}`);

                                        // Update unread count for this contact
                                        const incomingCount = newMsgs.filter(
                                            m => m.from?.toLowerCase() !== myAddress.toLowerCase()
                                        ).length;

                                        if (incomingCount > 0) {
                                            const isActiveChat = activeChatRef.current?.address?.toLowerCase() === contact.address.toLowerCase();
                                            setContacts(prev => prev.map(c => {
                                                if (c.address.toLowerCase() === contact.address.toLowerCase()) {
                                                    return {
                                                        ...c,
                                                        lastMessageTime: Math.max(c.lastMessageTime || 0, ...newMsgs.map(m => m.timestamp))
                                                    };
                                                }
                                                return c;
                                            }));

                                            // If the active chat is open for this contact, add to visible messages
                                            if (isActiveChat && keysRef.current) {
                                                const { decryptReceivedMessage } = await import('../services/messageService');
                                                for (const msg of newMsgs) {
                                                    const decrypted = await decryptReceivedMessage(msg, keysRef.current, myAddress);
                                                    setMessages(prev => {
                                                        if (prev.some(m => m.id === decrypted.id)) return prev;
                                                        return [...prev, decrypted].sort((a, b) => {
                                                            const aTime = a.savedAt || a.timestamp;
                                                            const bTime = b.savedAt || b.timestamp;
                                                            const timeDiff = aTime - bTime;
                                                            if (timeDiff !== 0) return timeDiff;
                                                            return (a.id || '').localeCompare(b.id || '');
                                                        });
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                console.debug(`Could not sync history for ${contact.address.slice(0, 10)}:`, err.message);
                            }
                        }
                    })();

                    return currentContacts; // Return unchanged for this setState call
                });
            });
        })();

        // Send read receipts when window gains focus OR Android app is resumed from background
        const handleFocus = () => {
            const chat = activeChatRef.current;
            if (!chat) return;

            // Get current messages and send read receipts for all unread incoming messages
            setMessages(prev => {
                const unread = prev.filter(m =>
                    m.from?.toLowerCase() !== myAddress?.toLowerCase() &&
                    m.status !== 'read'
                );
                // Pass active conversation address as the chatId scope
                unread.forEach(m => sendReadReceipt(m.from, m.id, chat.address));
                return prev;
            });
        };

        window.addEventListener('focus', handleFocus);

        // Bridge native Android Capacitor app state wake cycles to handleFocus
        let nativeListener = null;
        if (Capacitor.isNativePlatform()) {
            nativeListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
                if (isActive) {
                    console.log('📱 Android App Wake detected. Refreshing read receipts.');
                    handleFocus();
                }
            });
        }

        return () => {
            mounted = false;
            window.removeEventListener('focus', handleFocus);
            if (nativeListener) {
                nativeListener.then(l => l.remove()).catch(() => {});
            }
            if (statusUnsubscribeRef.current) statusUnsubscribeRef.current();
            if (reconnectUnsubscribeRef.current) reconnectUnsubscribeRef.current();
            // Clear typing timeouts
            Object.values(typingTimeoutRef.current).forEach(t => clearTimeout(t));
        };
    }, [myAddress]);
    useEffect(() => {
        if (!activeChatRef.current || activeChatRef.current.isGroup) return;

        setContacts(prev => {
            const hasUnread = prev.some(c => 
                c.address.toLowerCase() === activeChatRef.current.address.toLowerCase() && c.unreadCount > 0
            );

            if (hasUnread) {
                return prev.map(c => 
                    c.address.toLowerCase() === activeChatRef.current.address.toLowerCase()
                        ? { ...c, unreadCount: 0 }
                        : c
                );
            }
            return prev;
        });
    }, [messages, activeChat]);

    // ... (UseEffect for updates remains similar) ...

    const sendMessage = useCallback(async (content, replyTo = null, type = 'text', metadata = {}) => {
        if (!activeChat || !myAddress) {
            setError('No active chat');
            return;
        }

        try {
            if (activeChat.isGroup) {
                // Fan-out to all members
                const start = Date.now();
                const promises = activeChat.members
                    .filter(m => m.toLowerCase() !== myAddress.toLowerCase())
                    .map(memberAddr => sendEncryptedMessage(
                        myAddress,
                        memberAddr,
                        content,
                        replyTo,
                        {
                            groupId: activeChat.address,
                            groupName: activeChat.info?.username || 'Group',
                            members: activeChat.members, // Propagate members list
                            type: type,
                            ...metadata // Forward mediaId, manifest, etc.
                        }
                    ));

                const results = await Promise.allSettled(promises);
                const failedCount = results.filter(r => r.status === 'rejected').length;
                if (failedCount > 0) {
                    console.warn(`[Group] Message delivery failed for ${failedCount} members (they may be offline), but proceeded for the rest.`);
                }

                // Add to local state
                const sentMessage = {
                    id: `msg_${start}_${myAddress}`, // Pseudo ID
                    from: myAddress,
                    content,
                    replyTo, // Link parent message context for proper threaded rendering locally
                    timestamp: start,
                    status: 'sent',
                    groupId: activeChat.address,
                    isGroup: true,
                    type: type,
                    ...metadata // Spread mediaId etc.
                };

                await saveMessage(activeChat.address, sentMessage); // Persist

                setMessages(prev => [...prev, sentMessage]);
                return sentMessage;
            } else {
                // DM
                const sentMessage = await sendEncryptedMessage(
                    myAddress,
                    activeChat.address,
                    content,
                    replyTo,
                    { type: type, ...metadata }, // Forward mediaId, manifest, etc.
                    activeChat.publicKey // Inject caller-level fallback key
                );
                // Attach metadata (mediaId) to the persisted message
                const enrichedMessage = { ...sentMessage, ...metadata };
                await saveMessage(activeChat.address, enrichedMessage); // Persist
                setMessages(prev => [...prev, enrichedMessage]);
                return enrichedMessage;
            }
        } catch (err) {
            setError({ message: err.message, level: err.level || 'error' });
            throw err;
        }
    }, [activeChat, myAddress]);

    const openChat = useCallback(async (address, userInfo = null) => {
        // If clicking same chat, do nothing
        if (activeChatRef.current?.address?.toLowerCase() === address.toLowerCase()) return;

        // Find contact info
        let contact = contacts.find(c => c.address.toLowerCase() === address.toLowerCase());

        // If not in contacts but we have userInfo (from search), use it
        if (!contact && userInfo) {
            contact = {
                address: userInfo.address,
                username: userInfo.username,
                lastMessageTime: Date.now(),
                unreadCount: 0,
                online: false
            };
            setContacts(prev => [contact, ...prev]);
        }

        if (contact) {
            // Mark as read immediately utilizing a functional update to prevent stale closure resurrections
            setContacts(prev => prev.map(c =>
                c.address.toLowerCase() === address.toLowerCase()
                    ? { ...c, unreadCount: 0 }
                    : c
            ));
        }

        // Set active
        setActiveChat({
            address,
            info: contact || userInfo || { address },
            isGroup: contact?.isGroup || false,
            members: contact?.members || []
        });

        // Task 3: Proactive Key Verification (Ghost Key Shield)
        if (contact && !contact.isGroup) {
            import('../services/messageService').then(async ({ verifyRecipientKey }) => {
                const changed = await verifyRecipientKey(address, contact);
                if (changed) {
                    // Update local contact record with the fresh key if we can
                    const { getUser } = await import('../services/socketService');
                    const freshUser = await getUser(address);
                    if (freshUser) {
                        setContacts(prev => prev.map(c => 
                            c.address.toLowerCase() === address.toLowerCase() 
                                ? { ...c, publicKey: freshUser.publicKey, isVerified: false } 
                                : c
                        ));
                        console.log(`🔐 Contact ${address?.slice(0, 10)} public key updated proactively. RESETTING verification.`);
                    }
                }
            }).catch(err => console.debug('Key verification failed:', err));
        }

        // Load messages for this chat
        setMessages([]);
        setIsLoading(true);
        setHasMoreMessages(true); // Reset pagination for new chat

        try {
            // 1. Load Local History
            const localHistory = await getLocalHistory(address);
            console.debug(`📖 openChat: Loaded ${localHistory?.length} local messages for ${address}`);
            let merged = [...(localHistory || [])];

            // 2. Fetch Server History (if available)
            try {
                const serverHistory = await getHistory(address);
                // Merge and deduplicate
                const existingIds = new Set(merged.map(m => m.id));
                const newServerMsgsRaw = serverHistory.filter(m => !existingIds.has(m.id));
                
                // CRITICAL: Decrypt the server messages before merging them into active state!
                // Otherwise oversized un-cached payloads (like images) render as blank encrypted lock emojis.
                const { decryptReceivedMessage } = await import('../services/messageService');
                const newServerMsgs = [];
                for (const msg of newServerMsgsRaw) {
                    const decrypted = await decryptReceivedMessage(msg, keysRef.current, myAddress);
                    newServerMsgs.push(decrypted);
                }

                merged = [...merged, ...newServerMsgs].sort((a, b) => {
                    // Sort by savedAt (local device time) to avoid cross-device clock skew
                    const aTime = a.savedAt || a.timestamp;
                    const bTime = b.savedAt || b.timestamp;
                    const timeDiff = aTime - bTime;
                    if (timeDiff !== 0) return timeDiff;
                    return (a.id || '').localeCompare(b.id || '');
                });

                // Save new messages to local for next time
                if (newServerMsgs.length > 0) {
                    saveMessagesBulk(address, newServerMsgs);
                }
            } catch (e) {
                // Ignore if no server history
            }

            // Filter out group messages from DM history (they may have been
            // stored before the server-side fix was deployed)
            const isGroupChat = contact?.isGroup || false;
            if (!isGroupChat) {
                merged = merged.filter(m => !m.groupId);
            }

            const unreadIds = [];
            const mappedMessages = merged.map(m => {
                // Send explicit read receipts for missed incoming messages (Groups or DMs) that we are now opening
                const isIncoming = m.from?.toLowerCase() !== myAddress?.toLowerCase();
                if (isIncoming && m.status !== 'read') {
                    // Pass active conversation address as the chatId scope for direct writes
                    sendReadReceipt(m.from, m.id, address);
                    unreadIds.push(m.id);
                    return {
                        ...m,
                        status: 'read'
                    };
                }
                return m;
            });

            setMessages(mappedMessages);

            // Persist the read status locally so we don't re-emit receipts next session
            if (unreadIds.length > 0) {
                const { updateMessageReceipt } = await import('../services/storageService');
                updateMessageReceipt(address, unreadIds, myAddress, 'read').catch(e => console.debug('Local status persistence failed', e));
            }
        } catch (err) {
            console.error('Error loading chat:', err);
        } finally {
            setIsLoading(false);
        }

        setConnectionType('p2p'); // Default assumption, will update on connect

        // If it's a DM, try to connect/status
        if (!contact?.isGroup) {
            // connection logic handled by effect
        }
    }, [contacts, myAddress]);

    // Load older messages (scroll-to-load pagination)
    const loadMoreMessages = useCallback(async () => {
        if (!activeChat || isLoadingMore || !hasMoreMessages) return;

        const chatId = activeChat.address;
        const oldestMsg = messages[0]; // First message = oldest visible
        if (!oldestMsg) return;

        setIsLoadingMore(true);

        try {
            const PAGE_SIZE = 50;
            const olderMessages = await getMessagesPaginated(
                chatId,
                PAGE_SIZE,
                oldestMsg.savedAt || oldestMsg.timestamp
            );

            if (olderMessages.length === 0) {
                setHasMoreMessages(false);
            } else {
                // Deduplicate and prepend
                const existingIds = new Set(messages.map(m => m.id));
                const uniqueOlder = olderMessages.filter(m => !existingIds.has(m.id));
                if (uniqueOlder.length < PAGE_SIZE) {
                    setHasMoreMessages(false); // Got less than a full page
                }
                setMessages(prev => [...uniqueOlder, ...prev]);
            }
        } catch (err) {
            console.error('Error loading more messages:', err);
        } finally {
            setIsLoadingMore(false);
        }
    }, [activeChat, messages, isLoadingMore, hasMoreMessages]);

    const searchAndAddContact = useCallback(async (query) => {
        try {
            const user = await searchUser(query);
            if (user) {
                const exists = contacts.find(c => c.address.toLowerCase() === user.address.toLowerCase());
                if (!exists) {
                    const newContact = {
                        address: user.address,
                        username: user.username || null,
                        lastMessageTime: Date.now(),
                        unreadCount: 0,
                        online: user.online || false
                    };
                    setContacts(prev => [newContact, ...prev]);
                    return newContact;
                }
                return exists;
            }
            return null;
        } catch (err) {
            console.error('Search failed:', err);
            return null;
        }
    }, [contacts]);

    const updateGroupAvatar = useCallback((groupId, avatarBase64) => {
        if (!groupId) return;

        // Find the group to get its members
        const group = contacts.find(c => c.address === groupId && c.isGroup);
        if (!group) return;

        // Update local state
        setContacts(prev => prev.map(c =>
            c.address === groupId && c.isGroup
                ? { ...c, avatar: avatarBase64 }
                : c
        ));

        // Update active chat if viewing this group
        if (activeChatRef.current?.address === groupId) {
            setActiveChat(prev => ({
                ...prev,
                info: { ...prev.info, avatar: avatarBase64 }
            }));
        }

        // Broadcast to all members via server
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
        updateSocketProfile(
            newAvatar !== undefined ? newAvatar : myAvatar,
            newStatus !== undefined ? newStatus : myStatus
        );
    }, [myAvatar, myStatus]);

    const closeChat = useCallback(() => {
        setActiveChat(null);
        setMessages([]);
        setConnectionType('offline');
        setTypingStatus({});
    }, []);

    // --- Task 10: Verify Peer Identity ---
    const verifyContact = useCallback(async (address, isVerified) => {
        if (!address) return;
        
        setContacts(prev => {
            const next = prev.map(c => 
                c.address.toLowerCase() === address.toLowerCase() 
                    ? { ...c, isVerified } 
                    : c
            );
            return next;
        });

        // Update active chat if it matches
        if (activeChatRef.current?.address?.toLowerCase() === address.toLowerCase()) {
            setActiveChat(prev => ({
                ...prev,
                info: { ...prev.info, isVerified }
            }));
        }

        console.log(`🛡️ Verification status for ${address.slice(0, 10)} set to: ${isVerified}`);
    }, []);


    return {
        activeChat,
        messages,
        contacts,
        isLoading,
        isLoadingMore,
        hasMoreMessages,
        error,
        connectionType,
        serverConnected,
        typingStatus,
        flushingOutbox, // Export new state
        openChat,
        closeChat,
        sendMessage,
        sendTyping,
        createGroup,
        deleteGroup,
        removeMember,
        searchAndAddContact,
        toggleReaction,
        loadMoreMessages,
        myAvatar,
        myStatus,
        saveProfile,
        updateGroupAvatar,
        verifyContact, // Task 10
        clearError: () => setError(null),
    };
}

