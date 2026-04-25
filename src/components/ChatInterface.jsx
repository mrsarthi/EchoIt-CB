// ChatInterface - Main chat UI component
import { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat';
import { formatAddress } from '../blockchain/web3Provider';
import { CreateGroupModal } from './CreateGroupModal';
import { GroupDetailsModal } from './GroupDetailsModal';
import { ProfileModal } from './ProfileModal';
import { ProfilePreviewModal } from './ProfilePreviewModal';
import { SettingsModal } from './SettingsModal';
import { generateDiscussionId } from '../services/identityService';
import { App as CapacitorApp } from '@capacitor/app';
import { platform } from '../services/platformService';
import QuickPinchZoom, { make3dTransformValue } from 'react-quick-pinch-zoom';
import './ChatInterface.css';

export function ChatInterface({ walletAddress, username, onDeleteAccount }) {
    const {
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
        flushingOutbox,
        openChat,
        closeChat,
        sendMessage,
        sendTyping,
        createGroup,
        deleteGroup,
        removeMember,
        searchAndAddContact,
        toggleReaction,
        clearError,
        loadMoreMessages,
        myAvatar,
        myStatus,
        saveProfile,
        updateGroupAvatar
    } = useChat(walletAddress);

    const [newMessage, setNewMessage] = useState('');
    const [replyingTo, setReplyingTo] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showGroupDetails, setShowGroupDetails] = useState(false);
    const [imagePreview, setImagePreview] = useState(null); // base64 data URL
    const [lightboxImage, setLightboxImage] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [reactionPickerMsgId, setReactionPickerMsgId] = useState(null);
    const [reactionDetailModal, setReactionDetailModal] = useState(null); // { emoji, users, msgId }
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const longPressTimerRef = useRef(null);
    const imageMediaIdRef = useRef(null); // Stash mediaId for image send
    const [profilePreview, setProfilePreview] = useState(null); // User object for preview modal

    const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

    // Auto-scroll to bottom when new messages arrive (only if already near bottom)
    const prevMessagesLenRef = useRef(0);
    useEffect(() => {
        const container = messagesContainerRef.current;
        // Always scroll on first load or when a new message is added at end
        if (!container || messages.length === 0) return;
        
        // If messages were prepended (load-more), don't scroll
        if (messages.length > prevMessagesLenRef.current + 1) {
            // Likely a bulk prepend from loadMore — keep position
            prevMessagesLenRef.current = messages.length;
            return;
        }
        prevMessagesLenRef.current = messages.length;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Scroll-to-top: load more messages
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            // Trigger when scrolled within 80px of the top
            if (container.scrollTop < 80 && hasMoreMessages && !isLoadingMore) {
                const prevHeight = container.scrollHeight;
                loadMoreMessages().then(() => {
                    // Restore scroll position after prepending
                    requestAnimationFrame(() => {
                        const newHeight = container.scrollHeight;
                        container.scrollTop = newHeight - prevHeight;
                    });
                });
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [hasMoreMessages, isLoadingMore, loadMoreMessages]);

    // Hardware Back Button logic for Android
    useEffect(() => {
        if (!platform.isCapacitor) return;

        const backListener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
            // Priority 1: Lightbox open
            if (lightboxImage) {
                setLightboxImage(null);
                return;
            }
            // Priority 2: Reaction picker open
            if (reactionPickerMsgId) {
                setReactionPickerMsgId(null);
                return;
            }
            // Priority 3: Modals open
            if (showProfileModal) {
                setShowProfileModal(false);
                return;
            }
            if (showSettings) {
                setShowSettings(false);
                return;
            }
            if (showGroupDetails) {
                setShowGroupDetails(false);
                return;
            }
            if (showGroupModal) {
                setShowGroupModal(false);
                return;
            }
            // Priority 3: Active Chat open
            if (activeChat) {
                closeChat();
                return;
            }
            // Otherwise, let it go back or exit
            if (canGoBack) {
                window.history.back();
            } else {
                CapacitorApp.exitApp();
            }
        });

        return () => {
            backListener.then(listener => listener.remove());
        };
    }, [lightboxImage, reactionPickerMsgId, showProfileModal, showSettings, showGroupDetails, showGroupModal, activeChat, closeChat]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || isLoading) return;

        const messageText = newMessage;
        const replyContext = replyingTo ? {
            id: replyingTo.id,
            content: replyingTo.content,
            senderUsername: replyingTo.senderUsername || replyingTo.from
        } : null;

        setNewMessage('');
        setReplyingTo(null);
        sendTyping(false); // Stop typing indicator

        try {
            await sendMessage(messageText, replyContext);
        } catch (err) {
            setNewMessage(messageText); // Restore message on error
            if (replyContext) setReplyingTo(replyingTo); // Restore reply context
        }
    };

    const handleInput = (e) => {
        setNewMessage(e.target.value);

        // Typing indicator logic
        sendTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            sendTyping(false);
        }, 2000);
    };

    const handleReply = (msg) => {
        setReplyingTo(msg);
        inputRef.current?.focus();
    };

    const cancelReply = () => {
        setReplyingTo(null);
    };

    // Image handling — produces a small thumbnail for inline display
    // and optionally saves full-res to media store
    const resizeImage = (file, maxWidth = 1280) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Full-res version (capped at maxWidth)
                    const canvas = document.createElement('canvas');
                    let { width, height } = img;
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const fullRes = canvas.toDataURL('image/jpeg', 0.85);

                    // Thumbnail version (320px wide for inline chat bubbles)
                    const thumbCanvas = document.createElement('canvas');
                    const thumbMaxWidth = 320;
                    let thumbW = width, thumbH = height;
                    if (thumbW > thumbMaxWidth) {
                        thumbH = (thumbH * thumbMaxWidth) / thumbW;
                        thumbW = thumbMaxWidth;
                    }
                    thumbCanvas.width = thumbW;
                    thumbCanvas.height = thumbH;
                    const thumbCtx = thumbCanvas.getContext('2d');
                    thumbCtx.drawImage(img, 0, 0, thumbW, thumbH);
                    const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6);

                    resolve({ fullRes, thumbnail });
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    };

    const handleImageSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return;

        const { fullRes, thumbnail } = await resizeImage(file);
        // Store full-res in media cache, display thumbnail as preview
        const mediaId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const { saveMedia } = await import('../services/storageService');
        await saveMedia(mediaId, fullRes);
        // Store mediaId on the preview so we can retrieve full-res later
        setImagePreview(thumbnail);
        // Stash the mediaId for sendImage to use
        imageMediaIdRef.current = mediaId;
        // Reset file input so same file can be re-selected
        e.target.value = '';
    };

    const handleSendImage = async () => {
        if (!imagePreview || isLoading) return;
        const imgData = imagePreview;
        const mediaId = imageMediaIdRef.current;
        setImagePreview(null);
        imageMediaIdRef.current = null;
        try {
            // Send thumbnail as the message content, attach mediaId for full-res retrieval
            await sendMessage(imgData, null, 'image', { mediaId });
        } catch (err) {
            setImagePreview(imgData); // Restore on error
            imageMediaIdRef.current = mediaId;
        }
    };

    const cancelImagePreview = () => {
        setImagePreview(null);
        imageMediaIdRef.current = null;
    };

    const scrollToMessage = (msgId) => {
        const el = document.getElementById(`msg-${msgId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-reply');
            setTimeout(() => el.classList.remove('highlight-reply'), 1500);
        }
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        const user = await searchAndAddContact(searchQuery);
        setIsSearching(false);

        if (user) {
            // Show Profile Preview instead of directly opening chat
            setProfilePreview(user);
            setSearchQuery('');
        }
    };

    const handleStartChatFromPreview = (user) => {
        setProfilePreview(null);
        openChat(user.address, user);
    };

    const handleMessageGroupMember = async (memberAddr) => {
        setIsSearching(true);
        const user = await searchAndAddContact(memberAddr);
        setIsSearching(false);
        if (user) {
            openChat(user.address, user);
        }
    };

    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Get typing users for active chat
    const getTypingText = () => {
        if (!activeChat) return null;
        const chatStatus = typingStatus[activeChat.address] || {};
        const typingUsers = Object.keys(chatStatus);

        if (typingUsers.length === 0) return null;

        if (activeChat.isGroup) {
            // Map addresses to names if possible
            const names = typingUsers.slice(0, 3).map(addr => {
                // Try to find in contacts to get name
                // Note: contacts list might not have full details for everyone if they are just group members
                // But for now we just fallback to address
                const contact = contacts.find(c => c.address.toLowerCase() === addr.toLowerCase());
                return contact?.username || formatAddress(addr);
            });

            if (names.length === 1) return `${names[0]} is typing...`;
            if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
            return `${names.join(', ')}... are typing`;
        } else {
            return `Typing...`;
        }
    };

    const typingText = getTypingText();

    return (
        <div className={`chat-container ${activeChat ? 'has-active-chat' : ''}`}>
            {showGroupModal && (
                <CreateGroupModal
                    contacts={contacts}
                    onClose={() => setShowGroupModal(false)}
                    onCreate={createGroup}
                />
            )}
            
            {showProfileModal && (
                <ProfileModal
                    walletAddress={walletAddress}
                    username={username}
                    currentAvatar={myAvatar}
                    currentStatus={myStatus}
                    onSave={saveProfile}
                    onClose={() => setShowProfileModal(false)}
                />
            )}

            {/* Sidebar */}
            <aside className="sidebar glass-card">
                <div className="sidebar-header">
                    <div className="sidebar-header-top">
                        <h2>Chats</h2>
                        {walletAddress && (
                            <div className="user-profile-badge" onClick={() => setShowProfileModal(true)} title="Profile Settings" style={{ cursor: 'pointer' }}>
                                <div className="avatar avatar-sm" style={{ overflow: 'hidden' }}>
                                    {myAvatar ? (
                                        <img src={myAvatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        (username && username.length > 1) ? username.replace('@', '')[0]?.toUpperCase() : (walletAddress ? walletAddress.slice(2, 4).toUpperCase() : 'U')
                                    )}
                                </div>
                                <div className="user-profile-info">
                                    <span className="user-profile-name">{username || 'Anonymous'}</span>
                                    {myStatus ? (
                                        <span className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {myStatus}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : ''} ⚙️
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    {!serverConnected && (
                        <div className="connection-status-banner offline animate-fadeIn" style={{ marginTop: '12px' }}>
                            ⚠️ Disconnected from signaling server
                        </div>
                    )}
                </div>

                {/* Search / New Chat */}
                <form className="search-form" onSubmit={handleSearch}>
                    <input
                        type="text"
                        className="input"
                        placeholder="Addr, @user..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setShowGroupModal(true)}
                        title="Create Group"
                    >
                        👥
                    </button>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={isSearching || !searchQuery.trim()}
                    >
                        {isSearching ? '...' : '+'}
                    </button>
                </form>

                {/* Contacts List */}
                <div className="contacts-list">
                    {contacts.length === 0 ? (
                        <div className="empty-contacts">
                            <p className="text-muted">No conversations yet</p>
                            <p className="text-xs text-muted">
                                Search above or create a group
                            </p>
                        </div>
                    ) : (
                        [...contacts]
                            .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0))
                            .map((contact) => (
                                <div
                                    key={contact.address}
                                    className={`contact-item ${activeChat?.address === contact.address ? 'active' : ''}`}
                                    onClick={() => openChat(contact.address)}
                                >
                                    <div className="avatar" style={{ overflow: 'hidden' }}>
                                        {contact.isGroup ? (
                                            contact.avatar ? (
                                                <img src={contact.avatar} alt="Group Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : '👥'
                                        ) : (
                                            contact.avatar ? (
                                                <img src={contact.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : contact.address.slice(2, 4).toUpperCase()
                                        )}
                                    </div>
                                    <div className="contact-info">
                                        <span className="contact-name">
                                            {contact.username ? (contact.username.startsWith('@') || contact.isGroup ? contact.username : `@${contact.username}`) : formatAddress(contact.address)}
                                        </span>
                                        <div className="contact-status-row">
                                            {contact.username && !contact.isGroup && (
                                                <span className="text-xs text-muted" style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {contact.status || formatAddress(contact.address)}
                                                </span>
                                            )}
                                            {contact.isGroup && (
                                                <span className="text-xs text-muted">
                                                    {contact.members?.length || 0} members
                                                </span>
                                            )}
                                            {contact.online && <span className="status-indicator online small" title="Online"></span>}
                                        </div>
                                    </div>
                                    {contact.unreadCount > 0 && (
                                        <span className="unread-badge">{contact.unreadCount}</span>
                                    )}
                                </div>
                            ))
                    )}
                </div>
                <button className="sidebar-settings-btn" onClick={() => setShowSettings(true)}>
                    <span className="settings-icon">⚙️</span>
                    Settings
                </button>
            </aside>

            {/* Main Chat Area */}
            <main className="chat-main">
                {!activeChat ? (
                    <div className="no-chat-selected">
                        <div className="no-chat-content animate-fadeIn">
                            <div className="no-chat-icon">💬</div>
                            <h2>Welcome to DecentraChat</h2>
                            <p className="text-secondary">
                                Select a conversation or start a new one
                            </p>
                            <div className="features-grid">
                                <div className="feature-card glass-card">
                                    <span className="feature-emoji">👥</span>
                                    <span>Group Chats</span>
                                </div>
                                <div className="feature-card glass-card">
                                    <span className="feature-emoji">🔒</span>
                                    <span>End-to-End Encrypted</span>
                                </div>
                                <div className="feature-card glass-card">
                                    <span className="feature-emoji">⌨️</span>
                                    <span>Typing Indicators</span>
                                </div>
                                <div className="feature-card glass-card">
                                    <span className="feature-emoji">🚫</span>
                                    <span>No Central Server</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {showGroupDetails && (
                            <GroupDetailsModal
                                group={activeChat.isGroup ? activeChat.info : null}
                                onClose={() => setShowGroupDetails(false)}
                                myAddress={walletAddress}
                                onDeleteGroup={deleteGroup}
                                onRemoveMember={removeMember}
                                onUpdateGroupAvatar={updateGroupAvatar}
                                contacts={contacts}
                                onMessageMember={handleMessageGroupMember}
                            />
                        )}

                        {/* Chat Header */}
                        <header className="chat-header">
                            <button className="btn btn-ghost back-btn" onClick={closeChat}>
                                ←
                            </button>
                            <div
                                className={`chat-header-info ${activeChat.isGroup ? 'clickable' : ''}`}
                                onClick={() => activeChat.isGroup && setShowGroupDetails(true)}
                                title={activeChat.isGroup ? "View Group Details" : ""}
                            >
                                <div className="avatar" style={{ overflow: 'hidden' }}>
                                    {activeChat.isGroup ? (
                                        activeChat.info?.avatar ? (
                                            <img src={activeChat.info.avatar} alt="Group Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : '👥'
                                    ) : (
                                        activeChat.info?.avatar ? (
                                            <img src={activeChat.info.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : activeChat.address.slice(2, 4).toUpperCase()
                                    )}
                                </div>
                                <div className="chat-header-details">
                                    <span className="chat-header-name">
                                        {activeChat.info?.username || (activeChat.isGroup ? 'Unnamed Group' : formatAddress(activeChat.address))}
                                    </span>

                                    {typingText ? (
                                        <span className="text-xs text-primary animate-pulse font-medium">
                                            {typingText}
                                        </span>
                                    ) : (
                                        <div className="chat-status-line">
                                            <span className={`status-indicator ${activeChat.info?.online ? 'online' : 'offline'}`}></span>
                                            <span className="status-text" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {activeChat.isGroup
                                                    ? `${activeChat.info?.members?.length || 0} members`
                                                    : (activeChat.info?.online ? (activeChat.info?.status || 'Online') : 'Away')
                                                }
                                            </span>
                                            <span className="encrypted-badge">
                                                🔒 Encrypted
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <span className={`connection-badge ${connectionType}`}>
                                {connectionType === 'p2p' ? '⚡ Direct P2P' : connectionType === 'relay' ? '🌐 Server Relay' : '📴 Offline'}
                            </span>
                            <button
                                className={`btn btn-ghost debug-btn ${showDebug ? 'active' : ''}`}
                                onClick={() => setShowDebug(!showDebug)}
                                title="Toggle debug mode"
                            >
                                {showDebug ? '🔓 Hide Raw' : '🔍 Show Raw'}
                            </button>
                        </header>

                        {/* Messages Area */}
                        <div className="messages-container" ref={messagesContainerRef} onClick={() => { if (reactionPickerMsgId) setReactionPickerMsgId(null); }}>
                            {/* Load More Indicator */}
                            {isLoadingMore && (
                                <div className="load-more-indicator">
                                    <div className="spinner-small"></div>
                                    <span>Loading older messages...</span>
                                </div>
                            )}
                            {!hasMoreMessages && messages.length > 0 && (
                                <div className="load-more-indicator" style={{ opacity: 0.5 }}>
                                    <span>Beginning of conversation</span>
                                </div>
                            )}
                            {flushingOutbox && (
                                <div className="flushing-banner animate-fadeIn">
                                    <span className="spinner-small"></span>
                                    Sending queued messages...
                                </div>
                            )}
                            {isLoading && messages.length === 0 ? (
                                <div className="loading-messages">
                                    <div className="spinner"></div>
                                    <span>Loading messages...</span>
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="no-messages">
                                    <p className="text-muted">
                                        No messages yet. Say hello! 👋
                                    </p>
                                </div>
                            ) : (
                                messages.map((msg, index) => (
                                    <div
                                        key={msg.id || index}
                                        id={msg.id ? `msg-${msg.id}` : undefined}
                                        className={`message animate-fadeIn ${msg.from?.toLowerCase() === walletAddress?.toLowerCase()
                                            ? 'sent'
                                            : 'received'
                                            } ${msg.decryptionFailed ? 'failed' : ''}`}
                                    >
                                        <div
                                        className="message-bubble"
                                            onDoubleClick={() => handleReply(msg)}
                                            onTouchStart={(e) => {
                                                longPressTimerRef.current = setTimeout(() => {
                                                    setReactionPickerMsgId(msg.id);
                                                }, 500);
                                            }}
                                            onTouchEnd={() => clearTimeout(longPressTimerRef.current)}
                                            onTouchMove={() => clearTimeout(longPressTimerRef.current)}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setReactionPickerMsgId(msg.id);
                                            }}
                                        >
                                            {/* Emoji reaction picker */}
                                            {reactionPickerMsgId === msg.id && (
                                                <div className={`reaction-picker ${msg.from?.toLowerCase() === walletAddress?.toLowerCase() ? 'sent' : 'received'}`} onClick={(e) => e.stopPropagation()}>
                                                    {QUICK_EMOJIS.map(emoji => (
                                                        <button
                                                            key={emoji}
                                                            className="reaction-picker-emoji"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleReaction(msg.id, emoji);
                                                                setReactionPickerMsgId(null);
                                                            }}
                                                        >
                                                            {emoji}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {/* Show sender name in group chats if received */}
                                            {activeChat.isGroup && msg.from?.toLowerCase() !== walletAddress?.toLowerCase() && (
                                                <div className="text-xs opacity-75 font-bold mb-1" style={{ color: 'var(--accent-secondary)' }}>
                                                    {msg.senderUsername || formatAddress(msg.from)}
                                                </div>
                                            )}

                                            {msg.replyTo && (
                                                <div
                                                    className="message-reply-context clickable"
                                                    onClick={() => msg.replyTo.id && scrollToMessage(msg.replyTo.id)}
                                                    role="button"
                                                >
                                                    <div className="reply-bar-line"></div>
                                                    <div className="reply-content">
                                                        <span className="reply-sender">
                                                            {msg.replyTo.senderUsername || 'User'}
                                                        </span>
                                                        <span className="reply-text">
                                                            {msg.replyTo.content?.length > 100 ? msg.replyTo.content.substring(0, 100) + '...' : msg.replyTo.content}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {msg.type === 'image' ? (
                                                <div className="message-image-wrapper" onClick={async () => {
                                                    // Try to load full-res from media store
                                                    if (msg.mediaId) {
                                                        const { getMedia } = await import('../services/storageService');
                                                        const fullRes = await getMedia(msg.mediaId);
                                                        if (fullRes) {
                                                            setLightboxImage(fullRes);
                                                            return;
                                                        }
                                                    }
                                                    // Fallback to inline content
                                                    setLightboxImage(msg.content);
                                                }}>
                                                    <img src={msg.content} alt="Sent image" className="message-image" loading="lazy" />
                                                </div>
                                            ) : (
                                                <p className="message-content">{msg.content}</p>
                                            )}
                                            {showDebug && msg.encrypted && (
                                                <div className="debug-panel">
                                                    <div className="debug-label">🔐 Raw Encrypted Data:</div>
                                                    <code className="debug-data">{msg.encrypted.slice(0, 50)}...</code>
                                                    <div className="debug-label">🔑 Nonce:</div>
                                                    <code className="debug-data">{msg.nonce}</code>
                                                </div>
                                            )}
                                            <div className="message-meta">
                                                <span className="message-time">
                                                    {formatTime(msg.timestamp)}
                                                </span>
                                                {!msg.decryptionFailed && (
                                                    <span className="message-encrypted" title="Encrypted">
                                                        🔒
                                                    </span>
                                                )}
                                                {msg.from?.toLowerCase() === walletAddress?.toLowerCase() && (
                                                    <span className={`message-status ${msg.status || 'sent'}`} title={msg.status || 'sent'}>
                                                        {msg.status === 'pending' ? '🕐' : msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Reaction pills below the bubble */}
                                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                            <div className={`reaction-pills ${msg.from?.toLowerCase() === walletAddress?.toLowerCase() ? 'sent' : 'received'}`}>
                                                {Object.entries(msg.reactions).map(([emoji, users]) => (
                                                    <button
                                                        key={emoji}
                                                        className={`reaction-pill ${users.some(u => u.toLowerCase() === walletAddress?.toLowerCase()) ? 'mine' : ''}`}
                                                        onClick={() => setReactionDetailModal({ emoji, users, msgId: msg.id })}
                                                    >
                                                        <span className="reaction-pill-emoji">{emoji}</span>
                                                        {users.length > 1 && <span className="reaction-pill-count">{users.length}</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Message Input */}
                        <form className="message-input-form" onSubmit={handleSend}>
                            {replyingTo && (
                                <div className="reply-preview-bar animate-fadeIn">
                                    <div className="reply-preview-content">
                                        <span className="reply-to-label">Replying to <span className="font-bold">{replyingTo.senderUsername || 'User'}</span></span>
                                        <span className="reply-preview-text">
                                            {replyingTo.content?.length > 60
                                                ? replyingTo.content.substring(0, 60) + '...'
                                                : replyingTo.content}
                                        </span>
                                    </div>
                                    <button type="button" className="close-reply-btn" onClick={cancelReply}>×</button>
                                </div>
                            )}
                            {imagePreview && (
                                <div className="image-preview-bar animate-fadeIn">
                                    <img src={imagePreview} alt="Preview" className="image-preview-thumb" />
                                    <span className="image-preview-label">Image ready to send</span>
                                    <button type="button" className="close-reply-btn" onClick={cancelImagePreview}>×</button>
                                </div>
                            )}
                            <div className="message-input-row">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={handleImageSelect}
                                />
                                <button
                                    type="button"
                                    className="btn btn-ghost attach-btn"
                                    onClick={() => fileInputRef.current?.click()}
                                    title="Send image"
                                >
                                    📎
                                </button>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="input message-input"
                                    placeholder={activeChat.isGroup ? `Message ${activeChat.info?.username || 'group'}...` : "Type a message..."}
                                    value={newMessage}
                                    onChange={handleInput}
                                    autoFocus={!platform.isCapacitor}
                                />
                                {imagePreview ? (
                                    <button
                                        type="button"
                                        className="btn btn-primary send-btn"
                                        onClick={handleSendImage}
                                        disabled={isLoading}
                                    >
                                        <span className="send-icon">➤</span>
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        className="btn btn-primary send-btn"
                                        disabled={!newMessage.trim() || isLoading}
                                    >
                                        <span className="send-icon">➤</span>
                                    </button>
                                )}
                            </div>
                        </form>
                    </>
                )}

                {/* Error / Info Toast */}
                {error && (
                    <div className={`error-toast animate-fadeIn ${error.level === 'info' ? 'info-toast' : ''}`} onClick={clearError}>
                        <span className="error-icon">{error.level === 'info' ? '💬' : '⚠️'}</span>
                        <span>{typeof error === 'string' ? error : error.message}</span>
                        <button className="close-btn">×</button>
                    </div>
                )}
            </main>

            {/* Lightbox */}
            {/* Who Reacted Modal */}
            {reactionDetailModal && (
                <div className="reaction-detail-overlay" onClick={() => setReactionDetailModal(null)}>
                    <div className="reaction-detail-modal glass-card animate-scaleIn" onClick={(e) => e.stopPropagation()}>
                        <div className="reaction-detail-header">
                            <span className="reaction-detail-emoji">{reactionDetailModal.emoji}</span>
                            <span className="reaction-detail-title">Reactions</span>
                            <button className="reaction-detail-close" onClick={() => setReactionDetailModal(null)}>×</button>
                        </div>
                        <div className="reaction-detail-list">
                            {reactionDetailModal.users.map(user => {
                                const isMe = user.toLowerCase() === walletAddress?.toLowerCase();
                                const contact = contacts.find(c => c.address.toLowerCase() === user.toLowerCase());
                                const displayName = isMe ? 'You' : (contact?.username || formatAddress(user));
                                return (
                                    <div key={user} className="reaction-detail-user">
                                        <div className="avatar avatar-sm" style={{ overflow: 'hidden' }}>
                                            {contact?.avatar ? (
                                                <img src={contact.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : user.slice(2, 4).toUpperCase()}
                                        </div>
                                        <span className="reaction-detail-name">{displayName}</span>
                                        {isMe && (
                                            <button
                                                className="btn btn-ghost reaction-detail-remove"
                                                onClick={() => {
                                                    toggleReaction(reactionDetailModal.msgId, reactionDetailModal.emoji);
                                                    // Close or update the modal
                                                    if (reactionDetailModal.users.length <= 1) {
                                                        setReactionDetailModal(null);
                                                    } else {
                                                        setReactionDetailModal(prev => ({
                                                            ...prev,
                                                            users: prev.users.filter(u => u.toLowerCase() !== walletAddress?.toLowerCase())
                                                        }));
                                                    }
                                                }}
                                                title="Remove your reaction"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {lightboxImage && (
                <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
                    <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxImage(null); }}>×</button>
                    <div className="lightbox-zoom-container" onClick={(e) => e.stopPropagation()}>
                        <QuickPinchZoom
                            onUpdate={({ x, y, scale }) => {
                                const imgEntry = document.getElementById('lightbox-zoomed-img');
                                if (imgEntry) {
                                    imgEntry.style.setProperty(
                                        'transform',
                                        make3dTransformValue({ x, y, scale })
                                    );
                                }
                            }}
                            maxZoom={5}
                            wheelScaleFactor={500}
                        >
                            <img
                                id="lightbox-zoomed-img"
                                src={lightboxImage}
                                alt="Full size"
                                className="lightbox-image"
                            />
                        </QuickPinchZoom>
                    </div>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && (
                <SettingsModal
                    onClose={() => setShowSettings(false)}
                    onDeleteAccount={onDeleteAccount}
                />
            )}

            {/* Profile Preview Modal (shown after search) */}
            {profilePreview && (
                <ProfilePreviewModal
                    user={profilePreview}
                    onClose={() => setProfilePreview(null)}
                    onStartChat={handleStartChatFromPreview}
                    myAddress={walletAddress}
                />
            )}
        </div>
    );
}

