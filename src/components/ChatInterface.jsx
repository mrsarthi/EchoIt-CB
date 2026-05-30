// ChatInterface - Main chat UI component
import { useState, useRef, useEffect, useMemo } from 'react';
import { useChat } from '../hooks/useChat';
import { useWallet } from '../context/WalletContext';
import { formatAddress } from '../blockchain/web3Provider';
import { CreateGroupModal } from './CreateGroupModal';
import { GroupDetailsModal } from './GroupDetailsModal';
import { ProfileModal } from './ProfileModal';
import { ProfilePreviewModal } from './ProfilePreviewModal';
import ContactProfileModal from './ContactProfileModal';
import { BottomNavBar } from './BottomNavBar';
import { Sidebar } from './Sidebar';
import { SettingsTab } from './SettingsTab';
import SafetyNumbers from './SafetyNumbers';
import { TrustBadge } from './TrustBadge';
import { SelfTrustDetailsModal } from './SelfTrustDetailsModal';

import { 
    ArrowLeft, 
    Lock, 
    Send, 
    Paperclip, 
    Code, 
    ShieldCheck, 
    MessageSquare, 
    Users, 
    Zap, 
    X,
    Clock
} from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';
import { platform } from '../services/platformService';
import QuickPinchZoom, { make3dTransformValue } from 'react-quick-pinch-zoom';
import './ChatInterface.css';

export function ChatInterface({ walletAddress, username, onDeleteAccount }) {
    const { keys } = useWallet(); 

    const {
        activeChat,
        messages,
        contacts,
        isLoading,
        isLoadingMore,
        hasMoreMessages,
        error,
        typingStatus,
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
        myTrustScore,
        myTrustStage,
        saveProfile,
        updateGroupAvatar,
        verifyContact,
        reportSpam
    } = useChat(walletAddress);

    const [newMessage, setNewMessage] = useState('');
    const [replyingTo, setReplyingTo] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showDebug, setShowDebug] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showGroupDetails, setShowGroupDetails] = useState(false);
    const [showSafetyNumbers, setShowSafetyNumbers] = useState(false);
    const [imagePreview, setImagePreview] = useState(null); // base64 data URL
    const [lightboxMedia, setLightboxMedia] = useState(null); // { src, type }
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [reactionPickerMsgId, setReactionPickerMsgId] = useState(null);
    const [reactionDetailModal, setReactionDetailModal] = useState(null); // { emoji, users, msgId }
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const mediaIdRef = useRef(null); // Stash mediaId for media send
    const mediaTypeRef = useRef('image'); // 'image' or 'video'
    const mediaMimeTypeRef = useRef('image/jpeg');
    const [profilePreview, setProfilePreview] = useState(null); // User object for preview modal
    const [lightboxProgress, setLightboxProgress] = useState(null);
    const [activeTab, setActiveTab] = useState('chats'); // 'chats', 'contacts', 'settings'
    const [showSelfTrustDetails, setShowSelfTrustDetails] = useState(false);
    const [showContactProfile, setShowContactProfile] = useState(false);

    const [locallyAvailableMedia, setLocallyAvailableMedia] = useState(new Set());
    const [downloadingMedia, setDownloadingMedia] = useState(new Map()); // mediaId -> progress
    const [waitingForPeers, setWaitingForPeers] = useState(new Set()); // mediaIds in watch list
    const [backgroundUploads, setBackgroundUploads] = useState(new Map()); // mediaId -> progress (0-100)

    // Layer 5: Extract shared media for a specific contact
    const sharedMedia = useMemo(() => {
        if (!messages) return [];
        return messages
            .filter(m => (m.type === 'image' || m.type === 'video') && !m.decryptionFailed)
            .map(m => m.content);
    }, [messages]);

    // Check which media items are locally available in high-res and which are waiting
    useEffect(() => {
        const checkMedia = async () => {
            const { hasMedia, getMediaWatchList } = await import('../services/storageService');
            const newAvailable = new Set(locallyAvailableMedia);
            let changed = false;

            for (const msg of messages) {
                if (msg.mediaId && !newAvailable.has(msg.mediaId)) {
                    const exists = await hasMedia(msg.mediaId);
                    if (exists) {
                        newAvailable.add(msg.mediaId);
                        changed = true;
                    }
                }
            }

            if (changed) setLocallyAvailableMedia(newAvailable);

            const watchList = await getMediaWatchList();
            const waitingSet = new Set(watchList.map(item => item.mediaId));
            setWaitingForPeers(waitingSet);
        };

        if (messages.length > 0) checkMedia();
    }, [messages, locallyAvailableMedia]);

    const handleOpenContactProfile = () => {
        if (activeChat && !activeChat.isGroup) {
            setShowContactProfile(true);
        }
    };

    const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

    const chatScrollPositionsRef = useRef({}); // { [chatAddress]: scrollTop }
    const prevMessagesLenRef = useRef(0);

    // Media Lightbox Lazy Loading
    useEffect(() => {
        if (lightboxMedia?.manifest && !lightboxMedia.loadedSrc) {
            let active = true;
            
            const loadMedia = async () => {
                const { getMedia, saveMedia } = await import('../services/storageService');
                
                // 1. Check local storage first
                if (lightboxMedia.mediaId) {
                    const local = await getMedia(lightboxMedia.mediaId);
                    if (local && active) {
                        setLightboxMedia(prev => ({ ...prev, loadedSrc: local }));
                        return;
                    }
                }

                // 2. Download from network
                setLightboxProgress(0);
                try {
                    const { fetchAndReconstructMedia } = await import('../services/mediaTransport');
                    const base64Data = await fetchAndReconstructMedia(lightboxMedia.manifest, (progress) => {
                        if (active) setLightboxProgress(progress);
                    });

                    if (active) {
                        setLightboxMedia(prev => ({ ...prev, loadedSrc: base64Data }));
                        setLightboxProgress(null);
                        
                        // Save to local storage for future use
                        if (lightboxMedia.mediaId) {
                            await saveMedia(lightboxMedia.mediaId, base64Data);
                            setLocallyAvailableMedia(prev => new Set(prev).add(lightboxMedia.mediaId));
                        }
                    }
                } catch (err) {
                    if (active) {
                        console.error("Failed to load high-res media", err);
                        setLightboxProgress(null);
                    }
                }
            };

            loadMedia();
            return () => { active = false; };
        }
    }, [lightboxMedia]);

    const downloadMedia = async (msg) => {
        if (!msg.manifest || downloadingMedia.has(msg.mediaId)) return;

        setDownloadingMedia(prev => new Map(prev).set(msg.mediaId, 0));

        try {
            const { fetchAndReconstructMedia } = await import('../services/mediaTransport');
            const { saveMedia } = await import('../services/storageService');

            const base64Data = await fetchAndReconstructMedia(msg.manifest, (progress) => {
                setDownloadingMedia(prev => new Map(prev).set(msg.mediaId, progress));
            });

            if (base64Data) {
                await saveMedia(msg.mediaId, base64Data);
                setLocallyAvailableMedia(prev => new Set(prev).add(msg.mediaId));
                const { removeMediaFromWatchList } = await import('../services/storageService');
                await removeMediaFromWatchList(msg.mediaId);
            }
        } catch (err) {
            console.error("Download failed:", err);
            // Initiate P2P Swarm Self-Healing
            const { requestMedia } = await import('../services/socketService');
            const { addMediaToWatchList } = await import('../services/storageService');
            if (activeChat?.address) {
                requestMedia(activeChat.address, msg.mediaId);
                await addMediaToWatchList(activeChat.address, msg.mediaId);
                
                const target = activeChat.isGroup ? "the group" : "the sender";
                alert(`Original file is currently unavailable on relays. A background request has been sent to ${target} to re-sync it.`);
            }
        } finally {
            setDownloadingMedia(prev => {
                const newMap = new Map(prev);
                newMap.delete(msg.mediaId);
                return newMap;
            });
        }
    };

    const forceScrollToBottom = (smooth = false) => {
        const container = messagesContainerRef.current;
        if (!container) return;
        container.scrollTo({
            top: container.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    };

    // Effect 1: Chat switches, restore scroll location, or force initial bottom snap
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || !activeChat?.address) return;

        const address = activeChat.address;
        prevMessagesLenRef.current = 0; // Reset count for incoming scroll math

        const saved = chatScrollPositionsRef.current[address];
        
        const timer = setTimeout(() => {
            if (saved !== undefined) {
                container.scrollTop = saved;
            } else {
                forceScrollToBottom(false);
            }
        }, 50);

        const saveScroll = () => {
            chatScrollPositionsRef.current[address] = container.scrollTop;
        };

        container.addEventListener('scroll', saveScroll, { passive: true });
        return () => {
            clearTimeout(timer);
            container.removeEventListener('scroll', saveScroll);
        };
    }, [activeChat?.address]);

    // Effect 2: Dynamic Height Monitoring (ResizeObserver)
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || !activeChat?.address || typeof ResizeObserver === 'undefined') return;

        let isUserAtBottom = true;

        const observer = new ResizeObserver(() => {
            if (isUserAtBottom) {
                forceScrollToBottom(false);
            }
        });
        
        observer.observe(container);

        const checkScroll = () => {
            const threshold = 150; 
            const fromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            isUserAtBottom = fromBottom <= threshold;
        };

        container.addEventListener('scroll', checkScroll, { passive: true });
        checkScroll();

        return () => {
            observer.disconnect();
            container.removeEventListener('scroll', checkScroll);
        };
    }, [activeChat?.address]);

    // Effect 3: Scroll behavior purely controlled by arriving message mutations
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || messages.length === 0) return;

        const prevLen = prevMessagesLenRef.current;
        prevMessagesLenRef.current = messages.length;

        if (prevLen === 0) {
            const address = activeChat?.address;
            const saved = address ? chatScrollPositionsRef.current[address] : undefined;
            if (saved === undefined) {
                forceScrollToBottom(false);
                setTimeout(() => forceScrollToBottom(false), 100);
            }
            return;
        }

        if (messages.length > prevLen + 1) return;

        const threshold = 200;
        const fromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (fromBottom <= threshold) {
            forceScrollToBottom(true);
        }
    }, [messages, activeChat?.address]);

    // Scroll-to-top: load more messages
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            if (container.scrollTop < 80 && hasMoreMessages && !isLoadingMore) {
                const prevHeight = container.scrollHeight;
                loadMoreMessages().then(() => {
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
            if (lightboxMedia) { setLightboxMedia(null); return; }
            if (reactionPickerMsgId) { setReactionPickerMsgId(null); return; }
            if (showProfileModal) { setShowProfileModal(false); return; }
            if (showGroupDetails) { setShowGroupDetails(false); return; }
            if (showGroupModal) { setShowGroupModal(false); return; }
            if (showContactProfile) { setShowContactProfile(false); return; }
            if (showSelfTrustDetails) { setShowSelfTrustDetails(false); return; }
            if (activeChat) { closeChat(); return; }
            
            if (canGoBack) {
                window.history.back();
            } else {
                CapacitorApp.exitApp();
            }
        });

        return () => {
            backListener.then(listener => listener.remove());
        };
    }, [lightboxMedia, reactionPickerMsgId, showProfileModal, showGroupDetails, showGroupModal, activeChat, closeChat, showContactProfile, showSelfTrustDetails]);

    const handleSend = async (e) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || isLoading) return;

        const messageText = newMessage;
        const replyContext = replyingTo ? {
            id: replyingTo.id,
            content: replyingTo.type === 'image' ? '📷 Photo' : replyingTo.type === 'video' ? '🎥 Video' : replyingTo.content,
            senderUsername: replyingTo.senderUsername || replyingTo.from
        } : null;

        setNewMessage('');
        setReplyingTo(null);
        sendTyping(false);

        try {
            await sendMessage(messageText, replyContext);
        } catch (err) {
            console.error('Failed to send message:', err);
            setNewMessage(messageText); 
            if (replyContext) setReplyingTo(replyingTo);
        }
    };

    const handleInput = (e) => {
        setNewMessage(e.target.value);
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

    const cancelReply = () => setReplyingTo(null);

    const resizeImage = (file, maxWidth = 2560) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    
                    // Optimization: If image is already within limits, don't re-encode to preserve quality
                    if (width <= maxWidth && file.type === 'image/jpeg' && file.size < 2 * 1024 * 1024) {
                        const thumbCanvas = document.createElement('canvas');
                        const thumbMaxWidth = 160; // Smaller thumbnail
                        let thumbW = width, thumbH = height;
                        if (thumbW > thumbMaxWidth) {
                            thumbH = (thumbH * thumbMaxWidth) / thumbW;
                            thumbW = thumbMaxWidth;
                        }
                        thumbCanvas.width = thumbW;
                        thumbCanvas.height = thumbH;
                        const thumbCtx = thumbCanvas.getContext('2d');
                        thumbCtx.drawImage(img, 0, 0, thumbW, thumbH);
                        const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.3); // Blurry thumbnail
                        resolve({ fullRes: e.target.result, thumbnail });
                        return;
                    }

                    const canvas = document.createElement('canvas');
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const fullRes = canvas.toDataURL('image/jpeg', 0.95);

                    const thumbCanvas = document.createElement('canvas');
                    const thumbMaxWidth = 160; 
                    let thumbW = width, thumbH = height;
                    if (thumbW > thumbMaxWidth) {
                        thumbH = (thumbH * thumbMaxWidth) / thumbW;
                        thumbW = thumbMaxWidth;
                    }
                    thumbCanvas.width = thumbW;
                    thumbCanvas.height = thumbH;
                    const thumbCtx = thumbCanvas.getContext('2d');
                    thumbCtx.drawImage(img, 0, 0, thumbW, thumbH);
                    const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.3); 

                    resolve({ fullRes, thumbnail });
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    };

    const processVideo = (file) => {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.onloadeddata = () => { video.currentTime = Math.min(1, video.duration / 2 || 0); };
            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                const maxWidth = 320;
                let { videoWidth: width, videoHeight: height } = video;
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, width, height);
                
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.beginPath();
                ctx.arc(width / 2, height / 2, 24, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'white';
                ctx.beginPath();
                ctx.moveTo(width / 2 - 8, height / 2 - 10);
                ctx.lineTo(width / 2 + 12, height / 2);
                ctx.lineTo(width / 2 - 8, height / 2 + 10);
                ctx.fill();

                const thumbnail = canvas.toDataURL('image/jpeg', 0.6);
                const reader = new FileReader();
                reader.onload = (e) => resolve({ fullRes: e.target.result, thumbnail });
                reader.onerror = reject;
                reader.readAsDataURL(file);
            };
            video.onerror = reject;
            video.src = URL.createObjectURL(file);
        });
    };

    const handleMediaSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const MAX_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            alert(`File too large. Max 25 MB.`);
            e.target.value = '';
            return;
        }

        let fullRes, thumbnail;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) return;

        if (isVideo) ({ fullRes, thumbnail } = await processVideo(file));
        else ({ fullRes, thumbnail } = await resizeImage(file));

        const mediaId = `${isVideo ? 'vid' : 'img'}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const { saveMedia } = await import('../services/storageService');
        await saveMedia(mediaId, fullRes);
        
        setImagePreview(thumbnail);
        mediaIdRef.current = mediaId;
        mediaTypeRef.current = isVideo ? 'video' : 'image';
        mediaMimeTypeRef.current = file.type;
        e.target.value = '';
    };

    const handleSendMedia = async () => {
        if (!imagePreview || isLoading) return;
        const imgData = imagePreview;
        const mediaId = mediaIdRef.current;
        const mediaType = mediaTypeRef.current;
        const mimeType = mediaMimeTypeRef.current;
        
        // Non-blocking: Clear preview immediately so user can keep chatting
        setImagePreview(null);
        mediaIdRef.current = null;
        
        // Add to background tracking
        setBackgroundUploads(prev => new Map(prev).set(mediaId, 0));

        try {
            const { getMedia } = await import('../services/storageService');
            const fullRes = await getMedia(mediaId);
            let manifest = null;
            if (fullRes) {
                const { sliceAndTransmitMedia } = await import('../services/mediaTransport');
                manifest = await sliceAndTransmitMedia(fullRes, mimeType, (progress) => {
                    // Update specific background progress
                    setBackgroundUploads(prev => new Map(prev).set(mediaId, progress));
                }, activeChat?.address, mediaId);
            }

            // Once finished, send the message and remove from background list
            await sendMessage(imgData, null, mediaType, { mediaId, manifest });
            setBackgroundUploads(prev => {
                const newMap = new Map(prev);
                newMap.delete(mediaId);
                return newMap;
            });
        } catch (err) {
            console.error("Failed to send media:", err);
            // Optionally notify user of background failure
            setBackgroundUploads(prev => {
                const newMap = new Map(prev);
                newMap.delete(mediaId);
                return newMap;
            });
            alert(`Background media upload failed: ${err.message}`);
        }
    };

    const cancelMediaPreview = () => {
        setImagePreview(null);
        mediaIdRef.current = null;
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
        if (e) e.preventDefault();
        if (!searchQuery.trim()) return;

        const user = await searchAndAddContact(searchQuery);
        if (user) {
            setProfilePreview(user);
            setSearchQuery('');
        }
    };

    const handleStartChatFromPreview = (user) => {
        setProfilePreview(null);
        openChat(user.address, user);
    };

    const handleMessageGroupMember = async (memberAddr) => {
        const user = await searchAndAddContact(memberAddr);
        if (user) openChat(user.address, user);
    };

    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getTypingText = () => {
        if (!activeChat) return null;
        const chatStatus = typingStatus[activeChat.address] || {};
        const typingUsers = Object.keys(chatStatus);
        if (typingUsers.length === 0) return null;

        if (activeChat.isGroup) {
            const names = typingUsers.slice(0, 3).map(addr => {
                const contact = contacts.find(c => c.address.toLowerCase() === addr.toLowerCase());
                return contact?.username || formatAddress(addr);
            });
            if (names.length === 1) return `${names[0]} is typing...`;
            if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
            return `${names.join(', ')}... are typing`;
        }
        return `Typing...`;
    };

    const typingText = getTypingText();

    // receiptMap - Precompute the latest read/delivered message for each peer
    const receiptMap = useMemo(() => {
        const reads = {};      // address -> msgId
        const delivered = {};  // address -> msgId
        
        // Robust peer identification: check both activeChat.members and activeChat.info.members
        const peers = activeChat?.isGroup ? (activeChat.members || activeChat.info?.members || []) : [activeChat?.address];
        
        peers.forEach(peer => {
            if (!peer) return;
            const lowerPeer = peer.toLowerCase();
            if (lowerPeer === walletAddress?.toLowerCase()) return;

            // Start from the latest message and work backwards
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                // Only look at messages sent by the current user
                if (msg.from?.toLowerCase() !== walletAddress?.toLowerCase()) continue;

                const status = msg.receipts?.[lowerPeer];
                if (status === 'read' && !reads[lowerPeer]) {
                    reads[lowerPeer] = msg.id;
                    break; // Found latest read, stop for this peer
                } else if (status === 'delivered' && !delivered[lowerPeer] && !reads[lowerPeer]) {
                    delivered[lowerPeer] = msg.id;
                }
            }
        });

        return { lastReadMessageIds: reads, lastDeliveredMessageIds: delivered };
    }, [messages, walletAddress, activeChat]);

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

            {showSelfTrustDetails && (
                <SelfTrustDetailsModal
                    trustStage={myTrustStage}
                    trustScore={myTrustScore}
                    onClose={() => setShowSelfTrustDetails(false)}
                />
            )}

            {(activeTab === 'chats' || activeTab === 'contacts') && (
                <Sidebar 
                    myAvatar={myAvatar}
                    contacts={contacts}
                    activeChat={activeChat}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    handleSearch={handleSearch}
                    openChat={openChat}
                    setShowGroupModal={setShowGroupModal}
                    setShowProfileModal={setShowProfileModal}
                    setShowSelfTrustDetails={setShowSelfTrustDetails}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                />
            )}

            <main className={`chat-main ${activeTab === 'settings' ? 'settings-active' : ''}`}>
                {activeTab === 'settings' ? (
                    <SettingsTab 
                        walletAddress={walletAddress}
                        username={username}
                        onDeleteAccount={onDeleteAccount}
                    />
                ) : !activeChat ? (
                    <div className="no-chat-selected">
                        <div className="no-chat-content animate-fadeIn">
                            <div className="no-chat-icon"><MessageSquare size={64} className="text-muted" /></div>
                            <h2>Secure Messaging</h2>
                            <p className="text-secondary">
                                {activeTab === 'contacts' ? 'Select a contact to start' : 'Your messages are end-to-end encrypted'}
                            </p>
                            <div className="features-grid">
                                <div className="feature-card"><Users size={24} className="text-primary" /><span>Private Groups</span></div>
                                <div className="feature-card"><Lock size={24} className="text-trust" /><span>E2E Encrypted</span></div>
                                <div className="feature-card"><Zap size={24} className="text-warning" /><span>Direct P2P</span></div>
                                <div className="feature-card"><ShieldCheck size={24} className="text-trust" /><span>Verified Identity</span></div>
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

                        <header className="w-full flex-shrink-0 z-10 bg-surface h-16 flex items-center justify-between px-gutter border-b border-outline-variant/30 chat-header-container">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <button className="active:scale-95 duration-200 hover:opacity-80 transition-opacity flex items-center justify-center text-on-surface-variant flex-shrink-0" onClick={closeChat} aria-label="Back to chat list">
                                    <span className="material-symbols-outlined">arrow_back</span>
                                </button>
                                <div className="flex items-center gap-3 cursor-pointer min-w-0" onClick={() => activeChat.isGroup ? setShowGroupDetails(true) : handleOpenContactProfile()}>
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden text-white bg-surface-container-highest flex-shrink-0">
                                        {activeChat.isGroup ? (
                                            activeChat.info?.avatar ? (
                                                <img src={activeChat.info.avatar} alt="G" className="w-full h-full object-cover" />
                                            ) : <span className="material-symbols-outlined text-white">group</span>
                                        ) : (
                                            activeChat.info?.avatar ? (
                                                <img src={activeChat.info.avatar} alt="A" className="w-full h-full object-cover" />
                                            ) : activeChat.address.slice(2, 4).toUpperCase()
                                        )}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-headline-md text-[16px] font-semibold text-primary flex items-center gap-1 min-w-0">
                                            <span className="truncate">{activeChat.info?.username || (activeChat.isGroup ? 'Unnamed Group' : formatAddress(activeChat.address))}</span>
                                            {!activeChat.isGroup && <TrustBadge stage={activeChat.info?.trustStage || 1} compact />}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            {typingText ? <span className="text-xs text-primary animate-pulse font-medium">{typingText}</span> : (
                                                <>
                                                    <span className={`w-2 h-2 rounded-full ${activeChat.info?.online ? 'bg-secondary' : 'bg-outline-variant'}`}></span>
                                                    <span className="text-[12px] text-on-surface-variant leading-none">{activeChat.isGroup ? `${activeChat.info?.members?.length || 0} members` : (activeChat.info?.online ? 'Online' : 'Away')}</span>
                                                    <div className="flex items-center ml-2 bg-surface-container px-1.5 py-0.5 rounded text-trust">
                                                        <span className="material-symbols-outlined text-[10px] mr-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
                                                        <span className="text-[9px] font-bold uppercase tracking-wider">Secure</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 flex-shrink-0">
                                <button className={`transition-colors active:scale-95 duration-200 flex items-center justify-center ${showDebug ? 'text-primary' : 'text-on-surface-variant'}`} onClick={() => setShowDebug(!showDebug)} aria-label="Toggle Debug Info">
                                    <span className="material-symbols-outlined text-[24px]">code</span>
                                </button>
                            </div>
                        </header>

                        {showDebug && (
                            <div className="debug-panel animate-fadeIn">
                                <div className="debug-label">Chat Address:</div>
                                <code className="debug-data">{activeChat.address}</code>
                                <div className="debug-label">Is Group:</div>
                                <code className="debug-data">{activeChat.isGroup ? 'true' : 'false'}</code>
                                <div className="debug-label">Keys Available:</div>
                                <code className="debug-data">{keys ? 'true' : 'false'}</code>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto chat-scroll px-container-padding-mobile md:px-container-padding-desktop pt-6 pb-32 max-w-3xl mx-auto w-full flex flex-col gap-6" ref={messagesContainerRef} onClick={() => { if (reactionPickerMsgId) setReactionPickerMsgId(null); }}>
                            {isLoadingMore && <div className="flex justify-center py-4"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>}
                            {messages.length === 0 ? <div className="text-center py-10"><p className="text-on-surface-variant font-body-md">No messages yet</p></div> : (
                                (() => {
                                    const latestMyMsgId = messages.slice().reverse().find(m => m.from?.toLowerCase() === walletAddress?.toLowerCase())?.id;
                                    return messages.map((msg, index) => (
                                    <div key={msg.id || index} id={msg.id ? `msg-${msg.id}` : undefined} className={`relative animate-fadeIn flex flex-col gap-1 max-w-[85%] ${msg.from?.toLowerCase() === walletAddress?.toLowerCase() ? 'items-end self-end' : 'items-start self-start'}`}>
                                        <div className={`p-4 rounded-2xl shadow-sm relative font-body-md ${msg.from?.toLowerCase() === walletAddress?.toLowerCase() ? 'bg-primary-container text-on-primary-container rounded-br-none' : 'bg-surface-container text-on-surface rounded-bl-none'}`} onDoubleClick={() => !msg.decryptionFailed && handleReply(msg)} onContextMenu={(e) => { if (msg.decryptionFailed) return; e.preventDefault(); setReactionPickerMsgId(msg.id); }}>
                                            {reactionPickerMsgId === msg.id && (
                                                <div className={`reaction-picker ${msg.from === walletAddress ? 'sent' : 'received'}`} onClick={(e) => e.stopPropagation()}>
                                                    {QUICK_EMOJIS.map(emoji => (
                                                        <button key={emoji} className="reaction-picker-emoji" onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, emoji); setReactionPickerMsgId(null); }}>{emoji}</button>
                                                    ))}
                                                </div>
                                            )}
                                            {activeChat.isGroup && msg.from?.toLowerCase() !== walletAddress?.toLowerCase() && <div className="text-xs font-bold mb-1" style={{ color: 'var(--primary)' }}>{msg.senderUsername || formatAddress(msg.from)}</div>}
                                            {msg.replyTo && <div className="message-reply-context" onClick={() => scrollToMessage(msg.replyTo.id)}><div className="reply-bar-line" /><div className="reply-content"><span className="reply-sender">{msg.replyTo.senderUsername}</span><span className="reply-text">{msg.replyTo.content}</span></div></div>}
                                            {msg.decryptionFailed ? <div className="decryption-failed-content"><Lock size={14} className="text-error" /><p className="message-content text-muted italic">Decryption failed</p></div> : (msg.type === 'image' || msg.type === 'video') ? (
                                                <div className="message-image-wrapper" onClick={() => (locallyAvailableMedia.has(msg.mediaId) || !msg.manifest) ? setLightboxMedia({ src: msg.content, type: msg.type, manifest: msg.manifest, mediaId: msg.mediaId }) : null}>
                                                    <img 
                                                        src={msg.content} 
                                                        alt="Media" 
                                                        className={`message-image ${(!locallyAvailableMedia.has(msg.mediaId) && msg.manifest) ? 'blurry' : ''}`} 
                                                    />
                                                    
                                                    {msg.manifest && !locallyAvailableMedia.has(msg.mediaId) && (
                                                        <div className="media-download-overlay" onClick={(e) => { e.stopPropagation(); if (!waitingForPeers.has(msg.mediaId)) downloadMedia(msg); }}>
                                                            {downloadingMedia.has(msg.mediaId) ? (
                                                                <div className="download-progress-container">
                                                                    <div className="spinner-small" style={{ width: '24px', height: '24px' }}></div>
                                                                    <span className="text-xs mt-2 text-white font-bold">{downloadingMedia.get(msg.mediaId)}%</span>
                                                                </div>
                                                            ) : waitingForPeers.has(msg.mediaId) ? (
                                                                <div className="download-progress-container">
                                                                    <div className="download-btn-circle" style={{ background: 'rgba(255, 165, 0, 0.4)', borderColor: 'orange' }}>
                                                                        <Clock size={20} className="text-warning" />
                                                                    </div>
                                                                    <span className="text-xs mt-2 text-white font-bold bg-black/40 px-2 py-0.5 rounded-full">Waiting for peer...</span>
                                                                </div>
                                                            ) : (
                                                                <div className="download-btn-circle">
                                                                    <Zap size={20} />
                                                                </div>
                                                            )}
                                                            {!downloadingMedia.has(msg.mediaId) && !waitingForPeers.has(msg.mediaId) && <span className="text-xs text-white font-medium bg-black/40 px-2 py-0.5 rounded-full">Download Original</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                                            <div className="flex items-center gap-1 mt-1 justify-end opacity-80">
                                                <span className="font-label-sm text-[10px]">{formatTime(msg.timestamp)}</span>
                                                {msg.from?.toLowerCase() === walletAddress?.toLowerCase() && msg.queued && (
                                                    <span className="material-symbols-outlined text-[12px] text-error" title="Queued">schedule</span>
                                                )}
                                            </div>
                                        </div>
                                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                            <div className="reaction-pills">{Object.entries(msg.reactions).map(([emoji, users]) => (<button key={emoji} className="reaction-pill" onClick={() => setReactionDetailModal({ emoji, users, msgId: msg.id })}><span>{emoji}</span>{users.length > 1 && <span className="text-xs">{users.length}</span>}</button>))}</div>
                                        )}
                                        {msg.from?.toLowerCase() === walletAddress?.toLowerCase() && (
                                            <div className="receipt-anchors">
                                                {/* 1. Seen Receipts (Avatars in color) */}
                                                {Object.entries(receiptMap.lastReadMessageIds)
                                                    .filter(([, msgId]) => msgId === msg.id)
                                                    .map(([address]) => {
                                                        const contact = contacts.find(c => c.address.toLowerCase() === address.toLowerCase());
                                                        return (
                                                            <div key={`${address}-read`} className="receipt-avatar" title={`Seen by ${contact?.username || formatAddress(address)}`}>
                                                                {contact?.avatar ? (
                                                                    <img src={contact.avatar} alt="pfp" />
                                                                ) : (
                                                                    <div className="receipt-avatar-fallback">
                                                                        {(contact?.username || address).slice(0, 1).toUpperCase()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                }
                                                
                                                {/* 2. Delivered Receipts (Avatars in grayscale) */}
                                                {Object.entries(receiptMap.lastDeliveredMessageIds)
                                                    .filter(([, msgId]) => msgId === msg.id)
                                                    .map(([address]) => {
                                                        const contact = contacts.find(c => c.address.toLowerCase() === address.toLowerCase());
                                                        return (
                                                            <div key={`${address}-delivered`} className="receipt-avatar delivered" title={`Delivered to ${contact?.username || formatAddress(address)}`}>
                                                                {contact?.avatar ? (
                                                                    <img src={contact.avatar} alt="pfp" />
                                                                ) : (
                                                                    <div className="receipt-avatar-fallback">
                                                                        {(contact?.username || address).slice(0, 1).toUpperCase()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                }

                                                {/* 3. Sent Receipts (Hollow Circle) - Only if it's the latest message we sent and it has no delivery/read receipts yet */}
                                                {msg.id === latestMyMsgId && !msg.queued &&
                                                 (!msg.receipts || (!Object.values(msg.receipts).includes('delivered') && !Object.values(msg.receipts).includes('read'))) && (
                                                    <div className="receipt-avatar sent" title="Sent" />
                                                 )}
                                            </div>
                                        )}
                                    </div>
                                    ));
                                })()
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="w-full px-4 py-2 z-40 bg-surface flex-shrink-0 chat-input-container">
                            <div className="bg-surface-container rounded-[28px] flex flex-col px-2 py-2 gap-2 shadow-lg ring-1 ring-white/5 chat-input-pill">
                                {replyingTo && (
                                    <div className="flex items-center justify-between bg-surface-container-high rounded-2xl px-4 py-2 mx-2 mt-2">
                                        <div className="flex flex-col min-w-0">
                                            <span className="font-label-sm text-[11px] text-primary font-bold">Replying to {replyingTo.senderUsername}</span>
                                            <span className="font-body-md text-sm text-on-surface-variant truncate">{replyingTo.type === 'image' ? '📷 Photo' : replyingTo.type === 'video' ? '🎥 Video' : replyingTo.content}</span>
                                        </div>
                                        <button type="button" onClick={cancelReply} aria-label="Cancel Reply" className="text-on-surface-variant hover:text-on-surface active:scale-95 ml-2">
                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                        </button>
                                    </div>
                                )}
                                {imagePreview && (
                                    <div className="flex flex-col gap-2 bg-surface-container-high rounded-2xl p-2 mx-2 mt-2">
                                        <div className="flex justify-between items-start">
                                            <img src={imagePreview} alt="Preview" className="w-24 h-24 object-cover rounded-xl" />
                                            <button type="button" onClick={cancelMediaPreview} aria-label="Cancel" className="bg-black/50 text-white rounded-full p-1 active:scale-95"><span className="material-symbols-outlined text-[16px]">close</span></button>
                                        </div>
                                        <span className="text-xs text-secondary px-1">Media ready to send</span>
                                    </div>
                                )}
                                
                                {backgroundUploads.size > 0 && (
                                    <div className="flex flex-col gap-1 mx-2 mt-1">
                                        {Array.from(backgroundUploads.entries()).map(([mediaId, progress]) => (
                                            <div key={mediaId} className="w-full">
                                                <div className="flex justify-between text-[9px] text-on-surface-variant mb-0.5">
                                                    <span className="italic">Sending media...</span><span>{progress}%</span>
                                                </div>
                                                <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
                                                    <div className="bg-primary h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <form className="flex items-center gap-2 w-full" onSubmit={imagePreview ? (e) => { e.preventDefault(); handleSendMedia(); } : handleSend}>
                                    <button type="button" className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors active:scale-95 duration-200" onClick={() => fileInputRef.current?.click()} aria-label="Attach File">
                                        <span className="material-symbols-outlined text-[20px]">add</span>
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <input ref={inputRef} type="text" className="w-full bg-transparent border-none text-on-surface placeholder:text-outline focus:ring-0 text-body-lg px-2 h-10 outline-none font-body-md" placeholder="Message..." value={newMessage} onChange={handleInput} />
                                    </div>
                                    <button type="submit" className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors active:scale-95 duration-200 shadow-sm flex-shrink-0 ${(!newMessage.trim() && !imagePreview) || isLoading ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed' : 'bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container'}`} disabled={(!newMessage.trim() && !imagePreview) || isLoading} aria-label="Send Message">
                                        <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                                    </button>
                                </form>
                                <input type="file" ref={fileInputRef} hidden onChange={handleMediaSelect} />
                            </div>
                        </div>
                    </>
                )}

                {error && (
                    <div className={`error-toast animate-fadeIn ${error.level === 'info' ? 'info-toast' : ''}`} onClick={clearError}>
                        <span className="error-icon">{error.level === 'info' ? '💬' : '⚠️'}</span>
                        <span>{typeof error === 'string' ? error : error.message}</span>
                        <button className="close-btn">×</button>
                    </div>
                )}
            </main>

            {reactionDetailModal && (
                <div className="reaction-detail-overlay" onClick={() => setReactionDetailModal(null)}>
                    <div className="reaction-detail-modal glass-card animate-scaleIn" onClick={(e) => e.stopPropagation()}>
                        <div className="reaction-detail-header">
                            <span className="reaction-detail-emoji">{reactionDetailModal.emoji}</span>
                            <span className="reaction-detail-title">Reactions</span>
                            <button className="reaction-detail-close" onClick={() => setReactionDetailModal(null)}>×</button>
                        </div>
                        <div className="reaction-detail-list">
                            {reactionDetailModal.users?.map(user => {
                                const isMe = user.toLowerCase() === walletAddress?.toLowerCase();
                                const contact = contacts.find(c => c.address.toLowerCase() === user.toLowerCase());
                                const displayName = isMe ? 'You' : (contact?.username || formatAddress(user));
                                return (
                                    <div key={user} className="reaction-detail-user">
                                        <div className="avatar avatar-sm" style={{ overflow: 'hidden' }}>{contact?.avatar ? (<img src={contact.avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : user.slice(2, 4).toUpperCase()}</div>
                                        <span className="reaction-detail-name">{displayName}</span>
                                        {isMe && (
                                            <button className="btn btn-ghost reaction-detail-remove" onClick={() => { toggleReaction(reactionDetailModal.msgId, reactionDetailModal.emoji); if (reactionDetailModal.users.length <= 1) setReactionDetailModal(null); else setReactionDetailModal(prev => ({ ...prev, users: prev.users.filter(u => u.toLowerCase() !== walletAddress?.toLowerCase()) })); }} title="Remove your reaction">Remove</button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {lightboxMedia && (
                <div className="lightbox-overlay" onClick={() => setLightboxMedia(null)}>
                    <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxMedia(null); }}>×</button>
                    {lightboxProgress !== null && (
                        <div className="lightbox-progress-overlay" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-glass)', padding: '8px 16px', borderRadius: '20px', zIndex: 100, color: 'white' }}>
                            Downloading High-Res... {lightboxProgress}%
                        </div>
                    )}
                    <div className="lightbox-zoom-container" onClick={(e) => e.stopPropagation()}>
                        {lightboxMedia.type === 'video' ? (
                            lightboxMedia.loadedSrc ? (
                                <video src={lightboxMedia.loadedSrc} controls autoPlay className="lightbox-video" style={{ maxWidth: '90vw', maxHeight: '90vh', outline: 'none' }} />
                            ) : (
                                <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                    <img src={lightboxMedia.src} alt="Video Preview" style={{ maxWidth: '90vw', maxHeight: '90vh', opacity: 0.5, filter: 'blur(10px)' }} />
                                </div>
                            )
                        ) : (
                            <QuickPinchZoom onUpdate={({ x, y, scale }) => { const imgEntry = document.getElementById('lightbox-zoomed-img'); if (imgEntry) imgEntry.style.setProperty('transform', make3dTransformValue({ x, y, scale })); }} maxZoom={5} wheelScaleFactor={500}>
                                <img id="lightbox-zoomed-img" src={lightboxMedia.loadedSrc || lightboxMedia.src} alt="Full size" className="lightbox-image" />
                            </QuickPinchZoom>
                        )}
                    </div>
                </div>
            )}

            {profilePreview && (
                <ProfilePreviewModal
                    user={profilePreview}
                    onClose={() => setProfilePreview(null)}
                    onStartChat={handleStartChatFromPreview}
                />
            )}

            {showSafetyNumbers && activeChat && !activeChat.isGroup && (
                <SafetyNumbers
                    contact={activeChat.info}
                    myKeys={keys}
                    isVerified={activeChat.info?.isVerified}
                    onVerify={(status) => verifyContact(activeChat.address, status)}
                    onClose={() => setShowSafetyNumbers(false)}
                />
            )}

            {showContactProfile && activeChat && !activeChat.isGroup && (
                <ContactProfileModal
                    user={activeChat.info}
                    isVerified={activeChat.info?.isVerified}
                    sharedMedia={sharedMedia}
                    onClose={() => setShowContactProfile(false)}
                    onStartChat={() => setShowContactProfile(false)}
                    onVerify={() => setShowSafetyNumbers(true)}
                    onReportSpam={reportSpam}
                />
            )}

            <BottomNavBar 
                activeTab={activeTab} 
                onTabChange={(tab) => {
                    setActiveTab(tab);
                    if (tab !== 'chats' && tab !== 'contacts') closeChat();
                }} 
                hidden={!!activeChat}
            />
        </div>
    );
}
