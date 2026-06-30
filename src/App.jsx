import React, { useState, useEffect, useRef } from 'react';
import { Buffer } from 'buffer';
import { useDecentraChat } from './DecentraChatContext';
import logo from './assets/logo.png';
import SplashScreen from './SplashScreen';
import { App as CapacitorApp } from '@capacitor/app';
import QuickPinchZoom, { make3dTransformValue } from 'react-quick-pinch-zoom';

const getMetaMaskLink = () => {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.host;
    if (host && host !== 'localhost' && !host.startsWith('127.0.0.1')) {
      return `https://metamask.app.link/dapp/${host}`;
    }
  }
  // Fallback to a valid public domain so MetaMask deep link parser succeeds
  return 'https://metamask.app.link/dapp/decentrachat-singnalling.onrender.com';
};

function App() {
  const {
    wallet,
    connected,
    registered,
    username,
    conversations,
    activeConversationId,
    messages,
    loading,
    error,
    bootPhase,
    bootError,
    setActiveConversationId,
    registerUser,
    sendDirectMessage,
    sendMediaMessage,
    downloadMedia,
    sendGroupMessage,
    createGroup,
    exportBackup,
    importBackup,
    reconnect,
    logout,
    serverUrl,
    walletRegisteredOnServer,
    loginUser,
    sessionExpired,
    reauthenticateUser,
    stealthMode,
    setStealthMode,
    hideWalletAddress,
    setHideWalletAddress,
    usernameCache,
    updateUsernameCache,
    bio,
    pfp,
    usernameChangesCount,
    lastUsernameChangeAt,
    groupMessageStatuses,
    updateProfile,
    deleteAccountAction,
    refreshData,
    client,
    generateMnemonic,
    validateMnemonic,
    unlockWallet,
    unlockWithBiometrics,
    saveCredentialsAndRegister,
    biometricsSupported,
    deviceBiometricsAvailable,
    enableBiometricLogin,
    disableBiometricLogin,
    resetWallet
  } = useDecentraChat();

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768 || !!window.Capacitor?.isNativePlatform();
    }
    return false;
  });
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768 || !!window.Capacitor?.isNativePlatform());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);



  const mediaUploadControllerRef = useRef(null);
  const lightboxImgRef = useRef(null);

  const cancelMediaUpload = () => {
    if (mediaUploadControllerRef.current) {
      mediaUploadControllerRef.current.abort();
      mediaUploadControllerRef.current = null;
    }
    setUploadingFile(null);
  };

  const [registerUsername, setRegisterUsername] = useState('');
  const [inputText, setInputText] = useState('');
  const [uploadingFile, setUploadingFile] = useState(null);
  const [downloadingMedia, setDownloadingMedia] = useState({});
  const [mediaCache, setMediaCache] = useState({});
  const [newChatAddress, setNewChatAddress] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupJSON, setBackupJSON] = useState('');
  const [activeLightboxUrl, setActiveLightboxUrl] = useState(null);
  const [isDerivingKey, setIsDerivingKey] = useState(false);

  // Profile Hub States
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPfp, setEditPfp] = useState(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Emoji & Media States
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingMedia, setPendingMedia] = useState(null);
  
  // Navigation & Search States
  const [activeTab, setActiveTab] = useState('chats'); // 'chats', 'contacts', 'settings'
  const [searchQuery, setSearchQuery] = useState('');

  // Onboarding & Lockbox states
  const [onboardingStep, setOnboardingStep] = useState('home'); // 'home', 'show-seed', 'verify-seed', 'restore', 'choose-password'
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [mnemonicError, setMnemonicError] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [optInBiometrics, setOptInBiometrics] = useState(true);
  const [unlockPasswordInput, setUnlockPasswordInput] = useState('');
  const [localUnlockError, setLocalUnlockError] = useState('');
  const [passwordVerificationText, setPasswordVerificationText] = useState('');

  // Settings States (stored in localStorage)
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('echo_dark_mode') !== 'false';
  });
  const [compactView, setCompactView] = useState(() => {
    return localStorage.getItem('echo_compact_view') === 'true';
  });
  const [accentColor, setAccentColor] = useState(() => {
    return localStorage.getItem('echo_accent_color') || '#818cf8';
  });
  const [autoConnect, setAutoConnect] = useState(() => {
    return localStorage.getItem('echo_auto_connect') !== 'false';
  });
  const [messageRetention, setMessageRetention] = useState(() => {
    return localStorage.getItem('echo_retention') || 'forever';
  });

  // Modal visibility states
  const [showDMModal, setShowDMModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showNewChatMenu, setShowNewChatMenu] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalTab, setInfoModalTab] = useState('details'); // 'details' or 'attachments'
  const [activeGroupDetails, setActiveGroupDetails] = useState(null);

  // Reset info modal when changing chats, and revoke mediaCache Blob URLs to prevent leaks
  useEffect(() => {
    setShowInfoModal(false);
    setInfoModalTab('details');

    return () => {
      setMediaCache(prev => {
        Object.values(prev).forEach(entry => {
          if (entry?.url) {
            try {
              URL.revokeObjectURL(entry.url);
            } catch (e) {
              console.warn("Failed to revoke blob URL:", e);
            }
          }
        });
        return {};
      });
    };
  }, [activeConversationId]);

  // Clean up pendingMedia preview URL when cleared or replaced
  useEffect(() => {
    return () => {
      if (pendingMedia?.previewUrl) {
        try {
          URL.revokeObjectURL(pendingMedia.previewUrl);
        } catch (e) {
          console.warn("Failed to revoke preview URL:", e);
        }
      }
    };
  }, [pendingMedia]);

  // Load group details when group info modal is opened
  useEffect(() => {
    const isGroup = conversations.find(c => c.id === activeConversationId)?.is_group === 1;
    if (showInfoModal && activeConversationId && isGroup && client) {
      client.db.read(db => db.prepare('SELECT * FROM groups WHERE id = ?').get(activeConversationId))
        .then(group => {
          if (group) {
            setActiveGroupDetails(group);
          }
        })
        .catch(err => {
          console.error("Failed to load group details:", err);
        });
    } else {
      setActiveGroupDetails(null);
    }
  }, [showInfoModal, activeConversationId, conversations, client]);
  
  const messagesEndRef = useRef(null);

  // Sync Settings to Document/LocalStorage
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      localStorage.setItem('echo_dark_mode', 'true');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      localStorage.setItem('echo_dark_mode', 'false');
    }
  }, [darkMode]);

  useEffect(() => {
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#818cf8';
    document.documentElement.style.setProperty('--accent-indigo', safeColor);
    localStorage.setItem('echo_accent_color', safeColor);
  }, [accentColor]);

  useEffect(() => {
    localStorage.setItem('echo_compact_view', compactView ? 'true' : 'false');
  }, [compactView]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform()) {
      const handleBackButton = CapacitorApp.addListener('backButton', () => {
        if (showInfoModal) setShowInfoModal(false);
        else if (showGroupModal) setShowGroupModal(false);
        else if (showDMModal) setShowDMModal(false);
        else if (showNewChatMenu) setShowNewChatMenu(false);
        else if (showProfileModal) setShowProfileModal(false);
        else if (showExportModal) setShowExportModal(false);
        else if (showImportModal) setShowImportModal(false);
        else if (showEmojiPicker) setShowEmojiPicker(false);
        else if (activeConversationId) setActiveConversationId(null);
        else if (activeTab !== 'chats') setActiveTab('chats');
        else CapacitorApp.minimizeApp();
      });
      return () => {
        handleBackButton.then(h => h.remove());
      };
    }
  }, [
    activeConversationId,
    activeTab,
    showInfoModal,
    showGroupModal,
    showDMModal,
    showNewChatMenu,
    showProfileModal,
    showExportModal,
    showImportModal,
    showEmojiPicker,
    setActiveConversationId,
    setActiveTab
  ]);

  // Auto-trigger biometrics on lock screen if supported
  useEffect(() => {
    if (bootPhase === 'lockbox_locked' && biometricsSupported) {
      const timer = setTimeout(async () => {
        try {
          await unlockWithBiometrics();
        } catch (e) {
          // Silent fallback to password entry
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [bootPhase, biometricsSupported, unlockWithBiometrics]);

  useEffect(() => {
    localStorage.setItem('echo_auto_connect', autoConnect ? 'true' : 'false');
  }, [autoConnect]);

  useEffect(() => {
    localStorage.setItem('echo_retention', messageRetention);
  }, [messageRetention]);

  // Synchronize profile editing values
  useEffect(() => {
    if (showProfileModal) {
      setEditUsername(username);
      setEditBio(bio);
      setEditPfp(pfp);
    }
  }, [showProfileModal, username, bio, pfp]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (bootPhase === 'lockbox_locked') {
    return (
      <div className="mesh-gradient-bg" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', backgroundColor: 'var(--bg-primary)', padding: '24px' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: 'rgba(29, 32, 33, 0.75)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: '16px' }}>
            <img style={{ width: '48px', height: '48px', objectFit: 'contain' }} alt="Echo Logo" src={logo} />
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-primary)' }}>Unlock Echo</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '24px' }}>
            Enter your secure password to decrypt your credentials and synchronize keys.
          </p>

          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!unlockPasswordInput) return;
            setLocalUnlockError('');
            try {
              await unlockWallet(unlockPasswordInput);
            } catch (err) {
              setLocalUnlockError("Incorrect password or key decryption error.");
            }
          }} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="auth-input-group" style={{ display: 'flex', width: '100%', position: 'relative' }}>
              <input
                type="password"
                className="auth-input"
                placeholder="Enter password"
                value={unlockPasswordInput}
                onChange={(e) => setUnlockPasswordInput(e.target.value)}
                style={{ width: '100%', paddingRight: biometricsSupported ? '48px' : '16px' }}
                required
                autoFocus
              />
              {biometricsSupported && (
                <button
                  type="button"
                  onClick={async () => {
                    setLocalUnlockError('');
                    try {
                      await unlockWithBiometrics();
                    } catch (err) {
                      setLocalUnlockError("Biometrics failed. Please enter password.");
                    }
                  }}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--accent-indigo)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px' }}
                  title="Unlock with Biometrics"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>fingerprint</span>
                </button>
              )}
            </div>

            {localUnlockError && (
              <div style={{ color: 'var(--accent-rose)', fontSize: '13px', textAlign: 'center', marginTop: '4px' }}>
                {localUnlockError}
              </div>
            )}

            <button type="submit" className="auth-btn" style={{ width: '100%', height: '48px', borderRadius: '8px', background: 'var(--accent-indigo)', color: '#ffffff', border: 'none', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Unlock Lockbox
            </button>
          </form>

          <div style={{ marginTop: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Forgot password? Use your 12-word seed phrase to restore access.
            </span>
            <button
              onClick={() => {
                if (window.confirm("WARNING: This will permanently delete your local database and credentials from this device. You will need your 12-word seed phrase to restore your account. Proceed?")) {
                  resetWallet();
                }
              }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Reset App (Wipe local keys)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (bootPhase !== 'ready') {
    return <SplashScreen phase={bootPhase} error={bootError} />;
  }

  // Helpers
  const truncateAddress = (addr) => {
    if (!addr) return '';
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const sanitizePfpUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('data:image/')) {
      if (url.length > 3 * 1024 * 1024) return null;
      return url;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return null;
      if (url.length > 500) return null;
      return url;
    } catch {
      return null;
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((!inputText.trim() && !pendingMedia) || !activeConversationId) return;
    const text = inputText;
    setInputText('');
    
    const media = pendingMedia;
    setPendingMedia(null);

    try {
      const activeChat = conversations.find(c => c.id === activeConversationId);
      const isGroup = activeChat?.is_group === 1;
      
      if (media) {
        if (isGroup) {
          await client.sendGroupMessage(activeConversationId, text || "[Attachment]", media.manifest);
        } else {
          const contact = getCombinedContacts().find(item => item.address.toLowerCase() === activeConversationId.toLowerCase());
          await client.sendMessage(activeConversationId, text || "[Attachment]", media.manifest, contact?.username, contact?.hide_wallet);
        }
      } else {
        if (isGroup) {
          await sendGroupMessage(activeConversationId, text);
        } else {
          await sendDirectMessage(activeConversationId, text);
        }
      }
      await refreshData(client);
    } catch (err) {
      console.error("Message send failed:", err);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeConversationId) return;

    // Validate file size (max 50MB)
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert("File too large. Maximum allowed size is 50MB.");
      e.target.value = '';
      return;
    }

    // Validate MIME types
    const ALLOWED_MIME_TYPES = [
      'image/', 'video/', 'audio/', 'application/pdf', 
      'application/zip', 'application/x-zip-compressed', 
      'text/'
    ];
    const isAllowed = ALLOWED_MIME_TYPES.some(type => file.type.startsWith(type));
    if (file.type && !isAllowed) {
      alert("Unsupported file type. You can upload images, videos, audios, PDFs, ZIPs, and text documents.");
      e.target.value = '';
      return;
    }

    e.target.value = '';

    const controller = new AbortController();
    mediaUploadControllerRef.current = controller;

    setUploadingFile({ name: file.name, progress: 0 });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      // Upload to homing relays
      const manifest = await client.uploadMedia(
        fileBuffer,
        file.type || 'application/octet-stream',
        (progress) => {
          setUploadingFile(prev => prev ? { ...prev, progress } : null);
        },
        controller.signal
      );

      if (controller.signal.aborted) {
        return;
      }

      // Save to pending media preview state
      setPendingMedia({
        manifest,
        name: file.name,
        type: file.type,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      });
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted') || controller.signal.aborted) {
        console.log("Media upload cancelled by user.");
      } else {
        console.error("Media upload failed:", err);
        alert("Failed to upload file: " + err.message);
      }
    } finally {
      setUploadingFile(null);
      mediaUploadControllerRef.current = null;
    }
  };

  const triggerMediaDownload = async (mediaObj) => {
    const { mediaId, mimeType } = mediaObj;
    if (downloadingMedia[mediaId]) return;

    setDownloadingMedia(prev => ({ ...prev, [mediaId]: 0 }));

    try {
      const decryptedBuffer = await downloadMedia(mediaObj, (progress) => {
        setDownloadingMedia(prev => ({ ...prev, [mediaId]: progress }));
      });

      const blob = new Blob([decryptedBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);

      setMediaCache(prev => ({ ...prev, [mediaId]: { url, name: mediaId } }));

      if (!mimeType.startsWith('image/')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `file_${mediaId.substring(6, 12)}.${mimeType.split('/')[1] || 'bin'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error("Media download failed:", err);
      alert("Failed to download file: " + err.message);
    } finally {
      setDownloadingMedia(prev => {
        const next = { ...prev };
        delete next[mediaId];
        return next;
      });
    }
  };


  // Mock contacts list to match the Stitch Contacts view
  const mockContacts = [
    { address: '0x446662f42ad4f3cc86fd25764970644744ded851', username: 'crypto_sentinel' },
    { address: '0x8a92f0367a941ac9da783606853c85da03a202b5', username: 'aria_vance' },
    { address: '0x2bfd3ede922f3bd3c6b837f21f7e7b9e41daa943', username: 'alex_rivera' }
  ];

  const getCombinedContacts = () => {
    const list = [];
    
    // Add real DM conversation contacts
    conversations.forEach(c => {
      if (c.is_group !== 1) {
        const cached = usernameCache[c.id.toLowerCase()];
        list.push({ 
          address: c.id, 
          username: cached?.username || c.username,
          hide_wallet: cached ? cached.hideWallet : c.hide_wallet,
          bio: (cached && cached.bio !== undefined) ? cached.bio : (c.bio || ''),
          pfp: (cached && cached.pfp !== undefined) ? cached.pfp : (c.pfp || null)
        });
      }
    });

    // Add mock contacts if not already present
    mockContacts.forEach(mc => {
      if (!list.some(item => item.address.toLowerCase() === mc.address.toLowerCase())) {
        list.push({
          address: mc.address,
          username: mc.username,
          hide_wallet: false,
          bio: 'Crypto enthusiast',
          pfp: null
        });
      }
    });

    // Add any other cached entries not yet in the list
    Object.keys(usernameCache).forEach(addr => {
      if (!list.some(item => item.address.toLowerCase() === addr.toLowerCase())) {
        list.push({
          address: addr,
          username: usernameCache[addr].username,
          hide_wallet: usernameCache[addr].hideWallet,
          bio: '',
          pfp: null
        });
      }
    });

    return list;
  };

  // 0. Loading State
  if (loading) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-logo-container">
            <img src={logo} alt="Echo Logo" className="auth-logo-img" style={{ height: '48px', width: 'auto' }} />
            <span className="auth-logo-text">Echo</span>
          </div>
          <div className="auth-desc">Accessing local secure enclave databases...</div>
        </div>
      </div>
    );
  }

  // 0.5. Session Expired Re-authentication State
  if (sessionExpired) {
    return (
      <div className="mesh-gradient-bg" style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowY: 'auto' }}>
        <header style={{ width: '100%', height: '64px', position: 'fixed', top: 0, left: 0, zIndex: 40, backgroundColor: 'rgba(17, 20, 21, 0.85)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src={logo} alt="Echo Logo" style={{ height: '32px', width: 'auto' }} />
            <span className="font-headline-md font-bold" style={{ fontSize: '20px', fontFamily: 'Manrope, sans-serif', color: 'var(--text-primary)' }}>Echo</span>
          </div>
          <div>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => window.open('https://metamask.io/faqs/', '_blank')}>
              <span className="material-symbols-outlined">help</span>
            </button>
          </div>
        </header>

        <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: '40px 24px', paddingTop: '90px', width: '100%' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', overflow: 'hidden', backgroundColor: 'rgba(29, 32, 33, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ position: 'absolute', top: '-96px', left: '-96px', width: '192px', height: '192px', borderRadius: '50%', background: 'rgba(129, 140, 248, 0.1)', filter: 'blur(80px)' }}></div>
            
            <div style={{ position: 'relative', marginBottom: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ width: '96px', height: '96px', borderRadius: '50%', backgroundColor: 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255, 255, 255, 0.1)', overflow: 'hidden' }}>
                <img src={logo} alt="Echo Logo" style={{ height: '48px', width: 'auto' }} />
              </div>
              <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', backgroundColor: '#f59e0b', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '3px solid var(--bg-primary)' }}>
                <span className="material-symbols-outlined font-bold" style={{ fontSize: '12px', color: '#ffffff' }}>lock_open</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)', fontFamily: 'Manrope, sans-serif' }}>Session Expired</h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px', maxWidth: '320px', lineHeight: '1.5' }}>
                Your Web3 session has expired. Sign the challenge with your wallet to decrypt your messages and unlock your contacts.
              </p>
            </div>

            {error && (
              <div className="error-banner" style={{ width: '100%', marginBottom: '16px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid var(--accent-rose)', color: '#fda4af', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
              <button 
                type="button" 
                onClick={reauthenticateUser}
                style={{ border: 'none', background: 'var(--accent-indigo)', color: '#ffffff', fontSize: '16px', fontWeight: 'bold', gap: '8px', height: '56px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', width: '100%' }}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>key</span>
                Sign and Unlock App
              </button>

              <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', letterSpacing: '1px', padding: '0 8px' }}>OR</span>
                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
              </div>

              <button 
                type="button" 
                className="action-btn" 
                onClick={logout}
                style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--accent-rose)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', width: '100%' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
                Disconnect & Clear Local Cache
              </button>
            </div>

            <div style={{ marginTop: '24px', background: 'rgba(76, 214, 251, 0.1)', border: '1px solid rgba(76, 214, 251, 0.2)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div className="animate-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-emerald)', animation: 'pulse 2s infinite' }}></div>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--accent-emerald)' }}>DATA SECURITY: LOCAL STORAGE LOCKED</span>
            </div>
          </div>
        </main>

        <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 24px', fontSize: '11px', color: 'var(--text-secondary)', width: '100%' }}>
          <div style={{ display: 'flex', gap: '16px' }}>
            <a href="#" className="hover:text-primary transition-colors">PRIVACY POLICY</a>
            <a href="#" className="hover:text-primary transition-colors">TERMS OF SERVICE</a>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>VERSION 4.0.1-STABLE</span>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.3)' }}></span>
            <span>BUILD 9301</span>
          </div>
        </footer>
      </div>
    );
  }

  // 1. Wallet Connection State (Mockup: Connect Wallet (Desktop / Mobile))
  if (!wallet) {
    const handleCreateAccount = () => {
      const phrase = generateMnemonic();
      setGeneratedMnemonic(phrase);
      setOnboardingStep('show-seed');
    };

    const handleRestoreAccount = () => {
      setMnemonicInput('');
      setMnemonicError('');
      setOnboardingStep('restore');
    };

    const handleBackToHome = () => {
      setOnboardingStep('home');
    };

    const handleVerifySeed = () => {
      const trimmedInput = mnemonicInput.trim().toLowerCase().replace(/\s+/g, ' ');
      if (trimmedInput === generatedMnemonic.toLowerCase()) {
        setOnboardingStep('choose-password');
      } else {
        setMnemonicError("The entered seed phrase does not match. Please verify and try again.");
      }
    };

    const handleRestoreMnemonic = () => {
      const cleaned = mnemonicInput.trim().toLowerCase().replace(/\s+/g, ' ');
      if (validateMnemonic(cleaned)) {
        setGeneratedMnemonic(cleaned);
        setOnboardingStep('choose-password');
      } else {
        setMnemonicError("Invalid 12-word seed phrase. Check spelling and formatting.");
      }
    };

    const validatePassword = (pass) => {
      const hasMinLength = pass.length >= 8;
      const hasUppercase = /[A-Z]/.test(pass);
      const hasLowercase = /[a-z]/.test(pass);
      const hasNumber = /[0-9]/.test(pass);
      return hasMinLength && hasUppercase && hasLowercase && hasNumber;
    };

    const handlePasswordSubmit = async (e) => {
      e.preventDefault();
      if (!validatePassword(localPassword)) {
        alert("Password does not meet complexity requirements.");
        return;
      }
      if (localPassword !== confirmPassword) {
        alert("Passwords do not match.");
        return;
      }

      setIsDerivingKey(true);
      try {
        await saveCredentialsAndRegister(generatedMnemonic, localPassword, optInBiometrics);
      } catch (err) {
        alert("Account setup failed: " + err.message);
      } finally {
        setIsDerivingKey(false);
      }
    };

    return (
      <div className="mesh-gradient-bg" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', backgroundColor: 'var(--bg-primary)' }}>
        <header className="safe-header" style={{ width: '100%', position: 'fixed', top: 0, left: 0, zIndex: 40, borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', backgroundColor: 'rgba(27, 27, 34, 0.85)', backdropFilter: 'blur(10px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--accent-indigo)' }}>shield</span>
            <span className="font-headline-md font-bold" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>Echo</span>
          </div>
        </header>

        <main className="safe-pt safe-pb" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: '24px 20px', paddingTop: '100px', width: '100%' }}>
          
          {onboardingStep === 'home' && (
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: 'rgba(29, 32, 33, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="animate-float" style={{ position: 'relative', marginBottom: '24px', width: '120px', height: '120px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img style={{ width: '80px', height: '80px', objectFit: 'contain' }} alt="Echo Logo" src={logo} />
              </div>
              <h1 className="font-headline-lg-mobile" style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)', textAlign: 'center', marginBottom: '8px' }}>Welcome to Echo</h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '340px', lineHeight: '1.6', marginBottom: '32px' }}>
                Echo is a fully decentralized, peer-to-peer messaging application. All cryptographic keys are generated and stored locally on your device.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                <button onClick={handleCreateAccount} className="auth-btn" style={{ width: '100%', height: '52px', borderRadius: '10px', background: 'var(--accent-indigo)', color: '#ffffff', fontWeight: 'bold', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined">add_circle</span>
                  Create New Account
                </button>
                <button onClick={handleRestoreAccount} className="action-btn" style={{ width: '100%', height: '52px', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined">restore</span>
                  Restore Account
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 'show-seed' && (
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '480px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: 'rgba(29, 32, 33, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px', textAlign: 'center' }}>Secure Recovery Mnemonic</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '20px', textAlign: 'center' }}>
                Write down these 12 words in order and store them in a secure place. This is your master key. <strong style={{ color: 'var(--accent-rose)' }}>If you forget your password, this seed phrase is the ONLY way to recover your account.</strong> If you lose this phrase, you lose your account and all encrypted chats forever.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', margin: '16px 0' }}>
                {generatedMnemonic.split(' ').map((word, idx) => (
                  <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', padding: '10px 8px', borderRadius: '8px', textAlign: 'center', fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--text-secondary)', marginRight: '4px', fontSize: '10px' }}>{idx + 1}.</span>
                    {word}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button onClick={handleBackToHome} className="action-btn" style={{ flex: 1, height: '48px', borderRadius: '8px', cursor: 'pointer' }}>
                  Back
                </button>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generatedMnemonic);
                    alert("Mnemonic copied to clipboard!");
                  }} 
                  className="action-btn" 
                  style={{ flex: 1, height: '48px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>content_copy</span>
                  Copy Seed
                </button>
                <button onClick={() => setOnboardingStep('verify-seed')} className="auth-btn" style={{ flex: 1, height: '48px', borderRadius: '8px', background: 'var(--accent-indigo)', color: '#ffffff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                  Saved It
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 'verify-seed' && (
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: 'rgba(29, 32, 33, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px', textAlign: 'center' }}>Verify Mnemonic Phrase</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '20px', textAlign: 'center' }}>
                To confirm you have stored the phrase safely, please type or paste your 12 words here exactly as they were shown.
              </p>

              <div className="auth-input-group">
                <textarea
                  className="textarea-field"
                  value={mnemonicInput}
                  onChange={(e) => {
                    setMnemonicInput(e.target.value);
                    setMnemonicError('');
                  }}
                  placeholder="Enter 12 words separated by spaces"
                  style={{ minHeight: '100px', width: '100%', borderRadius: '8px', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5' }}
                  required
                />
              </div>

              {mnemonicError && (
                <div style={{ color: 'var(--accent-rose)', fontSize: '13px', marginTop: '8px', textAlign: 'center' }}>
                  {mnemonicError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button onClick={() => setOnboardingStep('show-seed')} className="action-btn" style={{ flex: 1, height: '48px', borderRadius: '8px', cursor: 'pointer' }}>
                  Back
                </button>
                <button onClick={handleVerifySeed} className="auth-btn" style={{ flex: 2, height: '48px', borderRadius: '8px', background: 'var(--accent-indigo)', color: '#ffffff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                  Verify & Continue
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 'restore' && (
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: 'rgba(29, 32, 33, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px', textAlign: 'center' }}>Restore Account</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '20px', textAlign: 'center' }}>
                Enter your 12-word recovery seed phrase to rebuild your identity and retrieve keys.
              </p>

              <div className="auth-input-group">
                <textarea
                  className="textarea-field"
                  value={mnemonicInput}
                  onChange={(e) => {
                    setMnemonicInput(e.target.value);
                    setMnemonicError('');
                  }}
                  placeholder="Enter 12 words separated by spaces"
                  style={{ minHeight: '100px', width: '100%', borderRadius: '8px', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5' }}
                  required
                />
              </div>

              {mnemonicError && (
                <div style={{ color: 'var(--accent-rose)', fontSize: '13px', marginTop: '8px', textAlign: 'center' }}>
                  {mnemonicError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button onClick={handleBackToHome} className="action-btn" style={{ flex: 1, height: '48px', borderRadius: '8px', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleRestoreMnemonic} className="auth-btn" style={{ flex: 2, height: '48px', borderRadius: '8px', background: 'var(--accent-indigo)', color: '#ffffff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                  Confirm Restore
                </button>
              </div>
            </div>
          )}

          {onboardingStep === 'choose-password' && (
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: 'rgba(29, 32, 33, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px', textAlign: 'center' }}>Set Account Password</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '20px', textAlign: 'center' }}>
                Choose a strong password to lock and encrypt your credentials locally. <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>Note: If you forget this password, you will need your 12-word recovery seed phrase to restore your account.</span>
              </p>

              <form onSubmit={handlePasswordSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="auth-input-group">
                  <label className="auth-label">Password</label>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="Minimum 8 characters"
                    value={localPassword}
                    onChange={(e) => setLocalPassword(e.target.value)}
                    required
                  />
                  <div style={{ fontSize: '11px', marginTop: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <span style={{ color: localPassword.length >= 8 ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>✓ Min 8 chars</span>
                    <span style={{ color: /[A-Z]/.test(localPassword) ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>✓ One Uppercase</span>
                    <span style={{ color: /[a-z]/.test(localPassword) ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>✓ One Lowercase</span>
                    <span style={{ color: /[0-9]/.test(localPassword) ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>✓ One Number</span>
                  </div>
                </div>

                <div className="auth-input-group">
                  <label className="auth-label">Confirm Password</label>
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  {confirmPassword && localPassword !== confirmPassword && (
                    <span style={{ color: 'var(--accent-rose)', fontSize: '11px', marginTop: '4px' }}>Passwords do not match</span>
                  )}
                </div>

                {/* Biometrics Toggle (Capacitor Native only) */}
                {window.Capacitor?.isNativePlatform() && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', margin: '8px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 'bold' }}>Enable Biometric Login</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Unlock app using FaceID or Fingerprint</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={optInBiometrics}
                      onChange={(e) => setOptInBiometrics(e.target.checked)}
                      style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent-indigo)' }}
                    />
                  </div>
                )}

                {isDerivingKey ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', margin: '12px 0' }}>
                    <div className="animate-spin" style={{ width: '24px', height: '24px', borderRadius: '50%', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-indigo)' }}></div>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Running Argon2id key derivation...</span>
                  </div>
                ) : (
                  <button 
                    type="submit" 
                    className="auth-btn" 
                    disabled={!validatePassword(localPassword) || localPassword !== confirmPassword}
                    style={{ width: '100%', height: '48px', borderRadius: '8px', background: 'var(--accent-indigo)', color: '#ffffff', border: 'none', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Generate Credentials & Unlock
                  </button>
                )}
              </form>
            </div>
          )}

        </main>
        
        <footer style={{ padding: '16px 24px', display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-light)' }}>
          <span>PROTOCOL_V2.0.48_STABLE</span>
        </footer>
      </div>
    );
  }

  if (!registered) {
    if (walletRegisteredOnServer) {
      return (
        <div className="auth-overlay" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '40px 24px' }}>
          <div className="auth-card">
            <div className="auth-logo-container">
              <img src={logo} alt="Echo Logo" className="auth-logo-img" style={{ height: '48px', width: 'auto' }} />
              <span className="auth-logo-text">Echo</span>
            </div>
            <div className="auth-desc">
              Your account is already registered on the Echo network. Click login below to retrieve your secure session and access your inbox.
            </div>
            
            <div className="profile-card" style={{ textAlign: 'left' }}>
              <div className="profile-username">Account Address</div>
              <div className="profile-address" title="Click to copy" onClick={() => {
                navigator.clipboard.writeText(wallet.address);
                alert("Address copied!");
              }}>
                {wallet.address} (Click to copy)
              </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <button type="button" className="auth-btn" onClick={loginUser} style={{ marginTop: '12px' }}>
              Login to Echo
            </button>

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button className="action-btn" onClick={() => setShowImportModal(true)}>
                Import Database Backup
              </button>
              <button className="action-btn" style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)' }} onClick={resetWallet}>
                Wipe Local Keys
              </button>
            </div>

            {/* Import Backup Modal inside Auth view */}
            {showImportModal && (
              <div className="modal-overlay">
                <div className="modal-card">
                  <div className="modal-header">Import Database Backup</div>
                  <div className="auth-input-group">
                    <label className="auth-label">Passphrase</label>
                    <input
                      type="password"
                      className="auth-input"
                      value={backupPassphrase}
                      onChange={(e) => setBackupPassphrase(e.target.value)}
                      placeholder="Enter decryption passphrase"
                    />
                  </div>
                  <div className="auth-input-group">
                    <label className="auth-label">Encrypted Backup JSON</label>
                    <textarea
                      className="textarea-field"
                      value={backupJSON}
                      onChange={(e) => setBackupJSON(e.target.value)}
                      placeholder="Paste exported backup string here"
                    />
                  </div>
                  <div className="modal-actions">
                    <button className="cancel-btn" onClick={() => setShowImportModal(false)}>Cancel</button>
                    <button className="confirm-btn" onClick={async () => {
                      if (backupPassphrase && backupJSON) {
                        try {
                          await importBackup(backupPassphrase, backupJSON);
                          setShowImportModal(false);
                           setBackupPassphrase('');
                           setBackupJSON('');
                         } catch (err) {
                           alert(err.message);
                         }
                       }
                     }}>Decrypt & Restore</button>
                   </div>
                 </div>
               </div>
             )}
           </div>
         </div>
       );
     }
 
     return (
       <div className="auth-overlay" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '40px 24px' }}>
         <div className="auth-card">
           <div className="auth-logo-container">
             <img src={logo} alt="Echo Logo" className="auth-logo-img" style={{ height: '48px', width: 'auto' }} />
             <span className="auth-logo-text">Echo</span>
           </div>
           <div className="auth-desc">
             Local account initialized. Pick an immutable username to register your key bundles on the relay server.
           </div>
           
           <div className="profile-card" style={{ textAlign: 'left' }}>
             <div className="profile-username">Account Address</div>
            <div className="profile-address" title="Click to copy" onClick={() => {
              navigator.clipboard.writeText(wallet.address);
              alert("Address copied!");
            }}>
              {wallet.address} (Click to copy)
            </div>
          </div>

          <form onSubmit={async (e) => {
            e.preventDefault();
            if (registerUsername.trim()) {
              try {
                await registerUser(registerUsername.trim());
              } catch (e) {
                // Error shown via context error
              }
            }
          }} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="auth-input-group">
              <label className="auth-label">Choose Username</label>
              <input
                type="text"
                className="auth-input"
                placeholder="lowercase_alphanumeric_only"
                value={registerUsername}
                onChange={(e) => setRegisterUsername(e.target.value.toLowerCase())}
                pattern="^[a-z0-9_]{3,20}$"
                required
              />
            </div>
            
            {error && <div className="error-banner">{error}</div>}
            
            <button type="submit" className="auth-btn">
              Register Username
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Already registered? </span>
            <button
              type="button"
              onClick={loginUser}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-indigo)',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
                fontSize: '0.9rem',
                fontFamily: 'inherit',
                fontWeight: '500'
              }}
            >
              Sign in
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="action-btn" onClick={() => setShowImportModal(true)}>
              Import Database Backup
            </button>
            <button className="action-btn" style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)' }} onClick={resetWallet}>
              Wipe Local Keys
            </button>
          </div>

          {/* Import Backup Modal inside Auth view */}
          {showImportModal && (
            <div className="modal-overlay">
              <div className="modal-card">
                <div className="modal-header">Import Database Backup</div>
                <div className="auth-input-group">
                  <label className="auth-label">Passphrase</label>
                  <input
                    type="password"
                    className="auth-input"
                    value={backupPassphrase}
                    onChange={(e) => setBackupPassphrase(e.target.value)}
                    placeholder="Enter decryption passphrase"
                  />
                </div>
                <div className="auth-input-group">
                  <label className="auth-label">Encrypted Backup JSON</label>
                  <textarea
                    className="textarea-field"
                    value={backupJSON}
                    onChange={(e) => setBackupJSON(e.target.value)}
                    placeholder="Paste exported backup string here"
                  />
                </div>
                <div className="modal-actions">
                  <button className="cancel-btn" onClick={() => setShowImportModal(false)}>Cancel</button>
                  <button className="confirm-btn" onClick={async () => {
                    if (backupPassphrase && backupJSON) {
                      try {
                        await importBackup(backupPassphrase, backupJSON);
                        setShowImportModal(false);
                        setBackupPassphrase('');
                        setBackupJSON('');
                      } catch (err) {
                        alert(err.message);
                      }
                    }
                  }}>Decrypt & Restore</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2.5. Registered but Disconnected State (Keep on connection screen until logged in)
  if (registered && !connected) {
    return (
      <div className="auth-overlay" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '40px 24px' }}>
        <div className="auth-card">
          <div className="auth-logo-container">
            <img src={logo} alt="Echo Logo" className="auth-logo-img" style={{ height: '48px', width: 'auto' }} />
            <span className="auth-logo-text">Echo</span>
          </div>
          <div className="auth-desc">
            You are currently disconnected from the Echo relay network. Authenticate your session with your wallet signature to access your secure inbox.
          </div>
          
          <div className="profile-card" style={{ textAlign: 'left' }}>
            <div className="profile-username">Logged in as</div>
            <div style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>@{username}</div>
            <div className="profile-address" style={{ fontSize: '11px', marginTop: '4px' }}>{wallet?.address}</div>
          </div>

          {error && (
            <div className="error-banner" style={{ marginTop: '12px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid var(--accent-rose)', color: '#fda4af', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
              {error}
            </div>
          )}

          <button 
            type="button" 
            className="auth-btn" 
            onClick={async () => {
              try {
                await loginUser();
              } catch (e) {
                console.error("Manual login failed:", e);
              }
            }} 
            style={{ marginTop: '16px' }}
          >
            Authenticate & Connect
          </button>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="action-btn" style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)' }} onClick={logout}>
              Disconnect Wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Registered & Connected State: Full Three-pane Layout Dashboard
  const activeChat = conversations.find(c => c.id === activeConversationId);
  const isGroupActive = activeChat?.is_group === 1;

  // Filter Conversations by Search
  const filteredConversations = conversations.filter(c =>
    c.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter Contacts by Search
  const filteredContacts = getCombinedContacts().filter(contact =>
    contact.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`app-container ${activeConversationId ? 'chat-active' : ''} ${compactView ? 'compact-view' : ''}`}>
      
      {/* 1. Left Navigation Sidebar (mockup: Recent Chats / Settings Desktop aside) */}
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-header">
          <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center shrink-0 shadow-sm" style={{ background: 'transparent', borderRadius: '8px', padding: '4px' }}>
            <img src={logo} alt="Echo Logo" style={{ height: '28px', width: 'auto' }} />
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md font-bold text-primary truncate" style={{ fontSize: '18px', fontWeight: 'bold' }}>Echo</h1>
            <p className="text-on-surface-variant font-body-md text-xs opacity-70" style={{ fontSize: '10px' }}>Secure Desktop</p>
          </div>
        </div>

        <nav className="desktop-nav">
          <div 
            className={`desktop-nav-item ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => { setActiveTab('chats'); setActiveConversationId(null); }}
          >
            <span className="material-symbols-outlined">chat</span>
            <span>Chats</span>
          </div>
          <div 
            className={`desktop-nav-item ${activeTab === 'contacts' ? 'active' : ''}`}
            onClick={() => { setActiveTab('contacts'); }}
          >
            <span className="material-symbols-outlined">group</span>
            <span>Contacts</span>
          </div>
          <div 
            className={`desktop-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => { setActiveTab('settings'); }}
          >
            <span className="material-symbols-outlined">settings</span>
            <span>Settings</span>
          </div>
        </nav>

        <div className="desktop-sidebar-footer">
          <div className="desktop-nav-item" onClick={() => alert("Support: For technical assistance visit our repo.")}>
            <span className="material-symbols-outlined">help</span>
            <span>Support</span>
          </div>
          <div className="desktop-nav-item" onClick={() => {
            navigator.clipboard.writeText(wallet.address);
            alert(`Wallet address copied to clipboard: ${wallet.address}`);
          }}>
            <span className="material-symbols-outlined">account_balance_wallet</span>
            <span>Wallet Details</span>
          </div>
          <div className="profile-card" style={{ marginTop: '8px', cursor: 'pointer' }} onClick={() => setShowProfileModal(true)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="avatar-container" style={{ width: '32px', height: '32px', fontSize: '12px', overflow: 'hidden' }}>
                {sanitizePfpUrl(pfp) ? (
                  <img src={sanitizePfpUrl(pfp)} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  username.substring(0, 2).toUpperCase()
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <p className="text-body-md font-bold text-on-surface truncate" style={{ fontSize: '13px' }}>@{username}</p>
                <p className="text-[10px] font-label-mono text-tertiary" style={{ fontSize: '10px', color: 'var(--accent-emerald)', fontFamily: 'monospace' }}>
                  {truncateAddress(wallet.address)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Middle Pane (mockup: Recent Chats list / Contacts list) */}
      {activeTab === 'chats' && (
        <section className={`middle-pane ${isMobile ? 'safe-pb' : ''}`}>
          {isMobile ? (
            /* Mobile Recent Chats Header */
            <header style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 36px)', paddingBottom: '16px', paddingLeft: '20px', paddingRight: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--bg-secondary)', zIndex: 40 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="font-headline-sm text-headline-sm font-bold" style={{ color: 'var(--accent-indigo)', fontSize: '20px' }}>Echo</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => setShowDMModal(true)}>
                    <span className="material-symbols-outlined">search</span>
                  </button>
                  <div 
                    className="avatar-container" 
                    style={{ width: '32px', height: '32px', fontSize: '12px', overflow: 'hidden', cursor: 'pointer', border: '2px solid var(--accent-indigo)' }}
                    onClick={() => setShowProfileModal(true)}
                  >
                    {sanitizePfpUrl(pfp) ? (
                      <img src={sanitizePfpUrl(pfp)} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      username.substring(0, 2).toUpperCase()
                    )}
                  </div>
                </div>
              </div>
            </header>
          ) : (
            /* Desktop Recent Chats Header */
            <header style={{ padding: '24px 24px 12px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="font-headline-sm text-headline-sm text-on-surface" style={{ fontSize: '20px', fontWeight: 'bold' }}>Messages</h2>
                <button 
                  className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high text-primary transition-colors"
                  onClick={() => setShowDMModal(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-indigo)', cursor: 'pointer' }}
                >
                  <span className="material-symbols-outlined">edit_square</span>
                </button>
              </div>
              <div className="relative group" style={{ position: 'relative' }}>
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}>search</span>
                <input 
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-full pl-10 pr-4 py-2 text-body-md focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary transition-all" 
                  placeholder="Search secure chats..." 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '20px', padding: '8px 12px 8px 36px', color: 'var(--text-primary)', width: '100%' }}
                />
              </div>
            </header>
          )}

          {isMobile && (
            /* Mobile Status/Stories Bar */
            <section className="hide-scrollbar" style={{ overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '16px', padding: '12px 20px', borderBottom: '1px solid var(--border-light)', backgroundColor: 'var(--bg-primary)' }}>
              {/* Add Status */}
              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', verticalAlign: 'top' }} onClick={() => setShowProfileModal(true)}>
                <div style={{ position: 'relative', width: '56px', height: '56px', borderRadius: '50%', border: '2px dashed var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-indigo)', fontSize: '20px' }}>add</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>My Status</span>
              </div>
              {/* Contact Statuses */}
              {getCombinedContacts().slice(0, 5).map(contact => (
                <div 
                  key={contact.address} 
                  style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', verticalAlign: 'top' }} 
                  onClick={async () => {
                    const peerId = contact.hide_wallet ? contact.username.toLowerCase() : contact.address.toLowerCase();
                    try {
                      await sendDirectMessage(peerId, "👋 Initiated secure channel.", contact.username, contact.hide_wallet, contact.bio, contact.pfp);
                    } catch {}
                    setActiveConversationId(peerId);
                  }}
                >
                  <div style={{ width: '56px', height: '56px', borderRadius: '50%', border: '2px solid var(--accent-indigo)', padding: '2px', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                      {sanitizePfpUrl(contact.pfp) ? (
                        <img src={sanitizePfpUrl(contact.pfp)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        contact.username.substring(0, 2).toUpperCase()
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '56px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {contact.username}
                  </span>
                </div>
              ))}
            </section>
          )}
          
          <div className="conversations-section" style={{ flex: 1, overflowY: 'auto' }}>
            {filteredConversations.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                No conversations found. Start a new DM or Group!
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const contact = getCombinedContacts().find(item => item.address.toLowerCase() === conv.id.toLowerCase());
                const isOnline = true; // Mock online status
                return (
                  <div
                    key={conv.id}
                    className={`conv-item ${activeConversationId === conv.id ? 'active' : ''} ${conv.unread_count > 0 ? 'unread' : ''}`}
                    onClick={() => setActiveConversationId(conv.id)}
                    style={isMobile ? { borderBottom: '1px solid rgba(255,255,255,0.02)', borderRadius: 0 } : {}}
                  >
                    <div className={`avatar-container ${conv.is_group ? 'group' : ''}`} style={{ overflow: 'hidden', position: 'relative' }}>
                      {conv.is_group 
                        ? 'G' 
                        : (() => {
                            const pfpUrl = contact?.pfp;
                            if (sanitizePfpUrl(pfpUrl)) {
                              return <img src={sanitizePfpUrl(pfpUrl)} alt="Contact Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
                            }
                            const name = contact ? contact.username : conv.username;
                            return name.substring(0, 2).toUpperCase();
                          })()
                      }
                      {!conv.is_group && isOnline && (
                        <div style={{ position: 'absolute', bottom: 0, right: 0, width: '10px', height: '10px', backgroundColor: 'var(--accent-emerald)', borderRadius: '50%', border: '2px solid var(--bg-secondary)' }}></div>
                      )}
                    </div>
                    <div className="conv-details">
                      <div className="conv-top">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="conv-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {conv.is_group 
                              ? conv.username 
                              : (contact ? `@${contact.username}` : `@${conv.username}`)
                            }
                            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--accent-indigo)', fontVariationSettings: "'FILL' 1" }}>verified</span>
                          </span>
                          {conv.unread_count > 0 && (
                            <span className="unread-badge" style={{ backgroundColor: 'var(--accent-indigo)', color: 'white', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                        <span className="conv-time">
                          {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="conv-last-msg" style={{ fontWeight: conv.unread_count > 0 ? '600' : '400', color: conv.unread_count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {conv.last_message_text || (conv.is_group ? 'Group Chat' : 'Secure Channel')}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          {!isMobile && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '8px' }}>
              <button className="action-btn" style={{ padding: '8px' }} onClick={() => setShowGroupModal(true)}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>group</span>
                + New Group
              </button>
            </div>
          )}

          {isMobile && (
            /* Floating Action Button on mobile Chats */
            <button 
              className="fixed shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 duration-100"
              style={{ position: 'fixed', right: '24px', bottom: '80px', width: '56px', height: '56px', backgroundColor: 'var(--accent-indigo)', color: '#ffffff', borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: 40 }}
              onClick={() => setShowNewChatMenu(true)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>add</span>
            </button>
          )}
        </section>
      )}

      {activeTab === 'contacts' && (
        <section className={`middle-pane ${isMobile ? 'safe-pb' : ''}`}>
          {isMobile ? (
            /* Mobile Contacts Header */
            <header style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 36px)', paddingBottom: '16px', paddingLeft: '20px', paddingRight: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="font-headline-sm text-headline-sm font-bold" style={{ color: 'var(--accent-indigo)', fontSize: '20px' }}>Contacts</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => setShowDMModal(true)}>
                    <span className="material-symbols-outlined">person_add</span>
                  </button>
                </div>
              </div>
            </header>
          ) : (
            /* Desktop Contacts Header */
            <header style={{ padding: '24px 24px 12px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="font-headline-sm text-headline-sm text-on-surface" style={{ fontSize: '20px', fontWeight: 'bold' }}>Contacts</h2>
                <button 
                  className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high text-primary transition-colors"
                  onClick={() => setShowDMModal(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-indigo)', cursor: 'pointer' }}
                >
                  <span className="material-symbols-outlined">person_add</span>
                </button>
              </div>
              <div className="relative group" style={{ position: 'relative' }}>
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}>search</span>
                <input 
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-full pl-10 pr-4 py-2 text-body-md focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary transition-all" 
                  placeholder="Search contacts..." 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '20px', padding: '8px 12px 8px 36px', color: 'var(--text-primary)', width: '100%' }}
                />
              </div>
            </header>
          )}

          {isMobile && (
            /* Quick Access Grid */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', padding: '16px 20px', borderBottom: '1px solid var(--border-light)', backgroundColor: 'var(--bg-primary)' }}>
              <div onClick={() => setShowDMModal(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '14px', backgroundColor: 'rgba(129, 140, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-indigo)', fontSize: '22px' }}>person_add</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Add New</span>
              </div>
              <div onClick={() => alert("QR Scanner V4: Camera permissions required.")} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '14px', backgroundColor: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-emerald)', fontSize: '22px' }}>qr_code_scanner</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Scan QR</span>
              </div>
              <div onClick={() => alert("Trust List: 100% of contacts verified under consensus.")} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '14px', backgroundColor: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-amber)', fontSize: '22px' }}>verified</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Trust List</span>
              </div>
              <div onClick={() => alert("Channels feature is launching in V5.")} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-rose)', fontSize: '22px' }}>campaign</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Channels</span>
              </div>
            </div>
          )}
          
          <div className="conversations-section" style={{ flex: 1, overflowY: 'auto' }}>
            {filteredContacts.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                No contacts found.
              </div>
            ) : isMobile ? (
              /* Grouped Alphabetical List on Mobile */
              (() => {
                const groups = {};
                filteredContacts.forEach(contact => {
                  const firstLetter = contact.username.substring(0, 1).toUpperCase();
                  const letter = /^[A-Z]$/.test(firstLetter) ? firstLetter : '#';
                  if (!groups[letter]) groups[letter] = [];
                  groups[letter].push(contact);
                });
                
                const sortedKeys = Object.keys(groups).sort((a, b) => {
                  if (a === '#') return 1;
                  if (b === '#') return -1;
                  return a.localeCompare(b);
                });

                return sortedKeys.map(letter => (
                  <div key={letter}>
                    <div style={{ padding: '8px 20px', fontSize: '11px', fontWeight: 'bold', color: 'var(--accent-indigo)', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      {letter}
                    </div>
                    {groups[letter].map(contact => (
                      <div
                        key={contact.address}
                        className="conv-item"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', borderRadius: 0 }}
                        onClick={async () => {
                          const peerId = contact.hide_wallet ? contact.username.toLowerCase() : contact.address.toLowerCase();
                          try {
                            await sendDirectMessage(peerId, "👋 Initiated secure channel.", contact.username, contact.hide_wallet, contact.bio, contact.pfp);
                            setActiveTab('chats');
                            setActiveConversationId(peerId);
                          } catch (e) {
                            setActiveTab('chats');
                            setActiveConversationId(peerId);
                          }
                        }}
                      >
                        <div className="avatar-container" style={{ overflow: 'hidden' }}>
                          {sanitizePfpUrl(contact.pfp) ? (
                            <img src={sanitizePfpUrl(contact.pfp)} alt="Contact Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            contact.username.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="conv-details">
                          <div className="conv-top">
                            <span className="conv-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              @{contact.username}
                              <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--accent-indigo)', fontVariationSettings: "'FILL' 1" }}>verified</span>
                            </span>
                          </div>
                          <div className="conv-last-msg" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {contact.bio || (contact.hide_wallet ? 'Address Hidden' : truncateAddress(contact.address))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ));
              })()
            ) : (
              /* Flat List on Desktop */
              filteredContacts.map((contact) => (
                <div
                  key={contact.address}
                  className="conv-item"
                  onClick={async () => {
                    const peerId = contact.hide_wallet ? contact.username.toLowerCase() : contact.address.toLowerCase();
                    try {
                      await sendDirectMessage(peerId, "👋 Initiated secure channel.", contact.username, contact.hide_wallet, contact.bio, contact.pfp);
                      setActiveTab('chats');
                      setActiveConversationId(peerId);
                    } catch (e) {
                      setActiveTab('chats');
                      setActiveConversationId(peerId);
                    }
                  }}
                >
                  <div className="avatar-container" style={{ overflow: 'hidden' }}>
                    {sanitizePfpUrl(contact.pfp) ? (
                      <img src={sanitizePfpUrl(contact.pfp)} alt="Contact Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      contact.username.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="conv-details">
                    <div className="conv-top">
                      <span className="conv-name">@{contact.username}</span>
                    </div>
                    <div className="conv-last-msg" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {contact.bio || (contact.hide_wallet ? 'Address Hidden' : truncateAddress(contact.address))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* 3. Detail Pane (mockup: Active Chat (Desktop) vs Empty Screen Placeholder vs Settings Page) */}
      {activeTab === 'chats' && (
        <section className="chat-pane" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {activeConversationId ? (
            <>
              {/* Active Chat Header */}
              {isMobile ? (
                <header style={{ height: 'auto', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 36px)', paddingBottom: '12px', paddingLeft: '16px', paddingRight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)' }}>
                  <div className="chat-header-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button type="button" className="back-btn" onClick={() => setActiveConversationId(null)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                    <div style={{ position: 'relative' }}>
                      <div className={`avatar-container ${isGroupActive ? 'group' : ''}`} style={{ width: '40px', height: '40px', overflow: 'hidden' }}>
                        {isGroupActive 
                          ? 'G' 
                          : (() => {
                              const contact = getCombinedContacts().find(item => 
                                item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                                item.username.toLowerCase() === activeChat.id.toLowerCase()
                              );
                              if (sanitizePfpUrl(contact?.pfp)) {
                                return <img src={sanitizePfpUrl(contact.pfp)} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
                              }
                              const name = contact ? contact.username : activeChat.username;
                              return name.substring(0, 2).toUpperCase();
                            })()
                        }
                      </div>
                      {!isGroupActive && (
                        <div style={{ position: 'absolute', bottom: 0, right: 0, width: '10px', height: '10px', backgroundColor: 'var(--accent-emerald)', borderRadius: '50%', border: '2px solid var(--bg-secondary)' }}></div>
                      )}
                    </div>
                    <div>
                      <div className="chat-header-title" style={{ fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {isGroupActive 
                          ? activeChat.username 
                          : (() => {
                              const contact = getCombinedContacts().find(item => 
                                item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                                item.username.toLowerCase() === activeChat.id.toLowerCase()
                              );
                              return contact ? `@${contact.username}` : `@${activeChat.username}`;
                            })()
                        }
                        <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--accent-indigo)', fontVariationSettings: "'FILL' 1" }}>verified</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Secure Enclave Active
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button className="p-2 hover:bg-surface-container-high rounded-full transition-colors" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => alert("Calls not supported in V4.")}>
                      <span className="material-symbols-outlined">call</span>
                    </button>
                    <button className="p-2 hover:bg-surface-container-high rounded-full transition-colors" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => {
                      setShowInfoModal(true);
                      setInfoModalTab('details');
                    }}>
                      <span className="material-symbols-outlined">info</span>
                    </button>
                  </div>
                </header>
              ) : (
                <header className="chat-header">
                  <div className="chat-header-info">
                    <button type="button" className="back-btn" onClick={() => setActiveConversationId(null)}>
                      ←
                    </button>
                    <div className={`avatar-container ${isGroupActive ? 'group' : ''}`} style={{ overflow: 'hidden' }}>
                      {isGroupActive 
                        ? 'G' 
                        : (() => {
                            const contact = getCombinedContacts().find(item => 
                              item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                              item.username.toLowerCase() === activeChat.id.toLowerCase()
                            );
                            if (sanitizePfpUrl(contact?.pfp)) {
                              return <img src={sanitizePfpUrl(contact.pfp)} alt="Contact Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
                            }
                            const name = contact ? contact.username : activeChat.username;
                            return name.substring(0, 2).toUpperCase();
                          })()
                      }
                    </div>
                    <div>
                      <div className="chat-header-title">
                        {isGroupActive 
                          ? activeChat.username 
                          : (() => {
                              const contact = getCombinedContacts().find(item => 
                                item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                                item.username.toLowerCase() === activeChat.id.toLowerCase()
                              );
                              return contact ? `@${contact.username}` : `@${activeChat.username}`;
                            })()
                        }
                      </div>
                      <div className="chat-header-sub" title={activeChat.id}>
                        {isGroupActive ? 'Secure Group Chat' : 'Active Secure Session'} • {(() => {
                          const contact = getCombinedContacts().find(item => 
                            item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                            item.username.toLowerCase() === activeChat.id.toLowerCase()
                          );
                          return contact?.hide_wallet ? 'Address Hidden' : (activeChat.id.startsWith('0x') ? truncateAddress(activeChat.id) : 'Address Hidden');
                        })()}
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="hidden md:flex items-center gap-xs px-sm py-1.5 rounded-full bg-primary-container/10 border border-primary/20 text-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '6px 12px', borderRadius: '20px', color: 'var(--accent-indigo)' }}>
                      <img src={logo} alt="Echo Logo" style={{ height: '16px', width: 'auto' }} />
                      <span className="text-xs font-bold tracking-tight" style={{ fontSize: '11px', fontWeight: 'bold' }}>Secure Session</span>
                    </div>
                    <button className="p-2 hover:bg-surface-container-high rounded-full transition-colors" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => alert("Video calls not supported in V4 client.")}>
                      <span className="material-symbols-outlined">videocam</span>
                    </button>
                    <button className="p-2 hover:bg-surface-container-high rounded-full transition-colors" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => {
                      setShowInfoModal(true);
                      setInfoModalTab('details');
                    }}>
                      <span className="material-symbols-outlined">info</span>
                    </button>
                  </div>
                </header>
              )}

              {/* Chat Message Scroll */}
              <div className="chat-messages" style={{ flex: 1, overflowY: 'auto' }}>
                {isMobile ? (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-light)', borderRadius: '20px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span className="material-symbols-outlined text-[14px]" style={{ color: 'var(--accent-indigo)', fontVariationSettings: "'FILL' 1" }}>lock</span>
                      <span>Secure channel established. Messages are E2E encrypted.</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                    <span className="px-3 py-1 bg-surface-container-high rounded-full text-[10px] uppercase tracking-widest font-bold text-on-surface-variant" style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '20px', fontSize: '10px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Today</span>
                  </div>
                )}

                {messages.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '40px' }}>
                    🔒 End-to-End Encrypted channel established. Messages are zero-knowledge and stored locally.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isSentByMe = msg.sender_address.toLowerCase() === wallet.address.toLowerCase();
                    const isSystem = msg.media_metadata === 'system' || msg.ciphertext === 'system' || msg.body_text?.startsWith('[Joined');

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="message-row system">
                          <div className="system-bubble">{msg.body_text}</div>
                        </div>
                      );
                    }

                    let mediaObj = null;
                    if (msg.media_metadata) {
                      try {
                        mediaObj = typeof msg.media_metadata === 'string' ? JSON.parse(msg.media_metadata) : msg.media_metadata;
                      } catch (e) {
                        console.error("Failed to parse media metadata:", e);
                      }
                    }

                    return (
                      <div 
                        key={msg.id} 
                        className={`message-row ${isSentByMe ? 'sent' : 'received'}`}
                        style={
                          isMobile 
                            ? (isSentByMe 
                                ? { display: 'flex', flexDirection: 'column', alignItems: 'end', maxWidth: '85%', marginLeft: 'auto', marginBottom: '12px' } 
                                : { display: 'flex', flexDirection: 'column', alignItems: 'start', maxWidth: '85%', marginRight: 'auto', marginBottom: '12px' })
                            : (!isSentByMe && isGroupActive 
                                ? { display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px', width: '100%', justifyContent: 'flex-start' } 
                                : {})
                        }
                      >
                        {!isMobile && !isSentByMe && isGroupActive && (
                          <div 
                            className="message-avatar-wrapper" 
                            style={{ 
                              width: '28px', 
                              height: '28px', 
                              borderRadius: '50%', 
                              overflow: 'hidden', 
                              flexShrink: 0, 
                              background: 'var(--bg-tertiary)', 
                              border: '1px solid var(--border-light)', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              fontSize: '10px', 
                              fontWeight: 'bold',
                              color: 'var(--text-primary)'
                            }}
                            title={(() => {
                              const contact = getCombinedContacts().find(item => item.address.toLowerCase() === msg.sender_address.toLowerCase());
                              return contact ? `@${contact.username}` : `@${usernameCache[msg.sender_address.toLowerCase()]?.username || msg.sender_address.substring(0, 8)}`;
                            })()}
                          >
                            {(() => {
                              const contact = getCombinedContacts().find(item => item.address.toLowerCase() === msg.sender_address.toLowerCase());
                              const pfpUrl = contact?.pfp || usernameCache[msg.sender_address.toLowerCase()]?.pfp;
                              if (sanitizePfpUrl(pfpUrl)) {
                                return <img src={sanitizePfpUrl(pfpUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
                              }
                              const name = contact ? contact.username : (usernameCache[msg.sender_address.toLowerCase()]?.username || msg.sender_address.substring(2, 8));
                              return name.substring(0, 2).toUpperCase();
                            })()}
                          </div>
                        )}
                        <div 
                          className="message-bubble"
                          style={
                            isMobile 
                              ? (isSentByMe 
                                  ? { background: 'linear-gradient(135deg, var(--accent-indigo) 0%, #4338ca 100%)', color: '#ffffff', borderRadius: '16px', borderBottomRightRadius: '4px', maxWidth: '100%', padding: '12px 16px', fontSize: '14px', lineHeight: '1.5' }
                                  : { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderRadius: '16px', borderBottomLeftRadius: '4px', border: '1px solid var(--border-light)', maxWidth: '100%', padding: '12px 16px', fontSize: '14px', lineHeight: '1.5' })
                              : {}
                          }
                        >
                          {!isSentByMe && !isGroupActive && !isMobile && (
                            <span className="message-sender">
                              {(() => {
                                const contact = getCombinedContacts().find(item => item.address.toLowerCase() === activeChat.id.toLowerCase());
                                return contact ? `@${contact.username}` : `@${activeChat.username}`;
                              })()}
                            </span>
                          )}
                          {!isSentByMe && isGroupActive && !isMobile && (
                            <span className="message-sender" style={{ color: 'var(--accent-indigo)', fontSize: '11px', fontWeight: '700', marginBottom: '2px', display: 'block' }}>
                              {(() => {
                                const contact = getCombinedContacts().find(item => item.address.toLowerCase() === msg.sender_address.toLowerCase());
                                return contact ? `@${contact.username}` : `@${usernameCache[msg.sender_address.toLowerCase()]?.username || msg.sender_address.substring(0, 8)}`;
                              })()}
                            </span>
                          )}
                          
                          {mediaObj ? (
                            mediaCache[mediaObj.mediaId] ? (
                              mediaObj.mimeType.startsWith('image/') ? (
                                <div style={{ marginTop: '4px', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                                  <img 
                                    src={mediaCache[mediaObj.mediaId].url} 
                                    alt="Attachment" 
                                    style={{ maxWidth: '100%', maxHeight: '240px', display: 'block', cursor: 'zoom-in' }} 
                                    onClick={() => setActiveLightboxUrl(mediaCache[mediaObj.mediaId].url)}
                                  />
                                </div>
                              ) : (
                                <div style={{
                                  marginTop: '4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  background: 'rgba(255,255,255,0.05)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: '12px',
                                  padding: '12px 16px',
                                  cursor: 'pointer'
                                }} onClick={() => {
                                  const a = document.createElement('a');
                                  a.href = mediaCache[mediaObj.mediaId].url;
                                  a.download = `file_${mediaObj.mediaId.substring(6, 12)}.${mediaObj.mimeType.split('/')[1] || 'bin'}`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--accent-indigo)' }}>description</span>
                                  <div style={{ flex: 1, overflow: 'hidden', textAlign: 'left' }}>
                                    <div style={{ fontSize: '13px', fontWeight: '600', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                      {`file_${mediaObj.mediaId.substring(6, 12)}.${mediaObj.mimeType.split('/')[1] || 'bin'}`}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                      {mediaObj.mimeType} (Decrypted)
                                    </div>
                                  </div>
                                  <span className="material-symbols-outlined" style={{ color: 'var(--text-secondary)' }}>download</span>
                                </div>
                              )
                            ) : downloadingMedia[mediaObj.mediaId] !== undefined ? (
                              <div style={{
                                marginTop: '4px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                padding: '12px 16px',
                                width: '220px'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '24px', color: 'var(--accent-indigo)', animation: 'spin 2s linear infinite' }}>sync</span>
                                  <div style={{ flex: 1, textAlign: 'left' }}>
                                    <div style={{ fontSize: '12px', fontWeight: '600' }}>Decrypting file...</div>
                                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                      Progress: {downloadingMedia[mediaObj.mediaId]}%
                                    </div>
                                  </div>
                                </div>
                                <div style={{
                                  background: 'rgba(255,255,255,0.1)',
                                  borderRadius: '4px',
                                  height: '4px',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{
                                    background: 'var(--accent-indigo)',
                                    width: `${downloadingMedia[mediaObj.mediaId]}%`,
                                    height: '100%',
                                    transition: 'width 0.2s'
                                  }} />
                                </div>
                              </div>
                            ) : (
                              <div style={{
                                marginTop: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                padding: '12px 16px',
                                cursor: 'pointer',
                                width: '220px'
                              }} onClick={() => triggerMediaDownload(mediaObj)}>
                                <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--text-secondary)' }}>cloud_download</span>
                                <div style={{ flex: 1, overflow: 'hidden', textAlign: 'left' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    {`file_${mediaObj.mediaId.substring(6, 12)}.${mediaObj.mimeType.split('/')[1] || 'bin'}`}
                                  </div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                    {mediaObj.mimeType} ({mediaObj.totalChunks} chunks)
                                  </div>
                                </div>
                                <span className="material-symbols-outlined" style={{ color: 'var(--text-secondary)' }}>download</span>
                              </div>
                            )
                          ) : (
                            <div>{msg.body_text}</div>
                          )}

                          <div className="message-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'end', gap: '4px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', marginTop: '4px' }}>
                            <span style={isMobile ? { color: 'rgba(255,255,255,0.5)' } : {}}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {isSentByMe && (
                              <span className="message-status-tick">
                                {(() => {
                                  if (isGroupActive) {
                                    const readMembers = groupMessageStatuses
                                      .filter(status => status.message_id === msg.id && status.status === 'read')
                                      .map(status => {
                                        const contact = getCombinedContacts().find(item => item.address.toLowerCase() === status.user_address.toLowerCase());
                                        return {
                                          address: status.user_address,
                                          username: contact ? contact.username : status.user_address.substring(0, 6),
                                          pfp: contact ? contact.pfp : null
                                        };
                                      });

                                    if (readMembers.length > 0) {
                                      return (
                                        <div className="group-seen-avatars" style={{ display: 'flex', gap: '2px', flexDirection: 'row-reverse', marginTop: '2px', justifyContent: 'flex-end' }}>
                                          {readMembers.map(member => (
                                            <div key={member.address} className="group-seen-avatar-wrapper" title={`Seen by @${member.username}`} style={{ width: '14px', height: '14px', borderRadius: '50%', overflow: 'hidden', border: '1px solid var(--border-light)' }}>
                                              {member.pfp ? (
                                                <img src={member.pfp} alt={member.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                              ) : (
                                                <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--accent-indigo)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 'bold' }}>
                                                  {member.username.substring(0, 1).toUpperCase()}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    }
                                    return <span className="seen-status hollow-circle" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '1.5px solid var(--text-secondary)', opacity: 0.5 }}></span>;
                                  } else {
                                    const contact = getCombinedContacts().find(item =>
                                      item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                                      item.username.toLowerCase() === activeChat.id.toLowerCase()
                                    );
                                    const pfpUrl = contact?.pfp;
                                    const initials = (contact?.username || activeChat.username || 'U').substring(0, 2).toUpperCase();

                                    if (msg.status === 'sending') {
                                      return <span className="material-symbols-outlined animate-spin" style={{ fontSize: '13px', opacity: 0.5 }}>progress_activity</span>;
                                    }
                                    if (msg.status === 'sent') {
                                      return <span className="material-symbols-outlined" style={{ fontSize: '13px', opacity: 0.5, fontVariationSettings: "'FILL' 0" }}>check_circle</span>;
                                    }
                                    if (msg.status === 'delivered') {
                                      return <span className="material-symbols-outlined" style={{ fontSize: '13px', color: 'var(--accent-indigo)', opacity: 0.8, fontVariationSettings: "'FILL' 1" }}>check_circle</span>;
                                    }
                                    if (msg.status === 'read') {
                                      return (
                                        <div className="seen-status-avatar-wrapper" title="Seen" style={{ width: '14px', height: '14px', borderRadius: '50%', overflow: 'hidden', border: '1px solid var(--border-light)', display: 'inline-block' }}>
                                          {pfpUrl ? (
                                            <img src={pfpUrl} alt="Seen" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                          ) : (
                                            <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--accent-indigo)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 'bold' }}>
                                              {initials}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                  }
                                  return null;
                                })()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input Footer */}
              <footer className={isMobile ? 'safe-footer' : ''} style={{ padding: isMobile ? '12px 16px 24px 16px' : '20px 24px', background: 'rgba(16, 22, 42, 0.4)', borderTop: '1px solid var(--border-light)' }}>
                <form onSubmit={handleSendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '800px', margin: '0 auto' }}>
                  {pendingMedia && (
                    <div className="pending-media-preview" style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      background: 'rgba(99, 102, 241, 0.1)',
                      border: '1px solid var(--accent-indigo)',
                      borderRadius: '12px',
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      backdropFilter: 'blur(8px)',
                      position: 'relative',
                      marginBottom: '4px'
                    }}>
                      {pendingMedia.previewUrl ? (
                        <img 
                          src={pendingMedia.previewUrl} 
                          alt="Preview" 
                          style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' }} 
                        />
                      ) : (
                        <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--accent-indigo)' }}>description</span>
                      )}
                      <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingMedia.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Ready to send with caption</div>
                      </div>
                      <button 
                        type="button" 
                        style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => setPendingMedia(null)}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                  )}

                  {uploadingFile && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      background: 'rgba(99, 102, 241, 0.1)',
                      border: '1px solid var(--accent-indigo)',
                      borderRadius: '12px',
                      padding: '12px 16px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      backdropFilter: 'blur(8px)'
                    }}>
                      <span className="material-symbols-outlined" style={{ animation: 'spin 2s linear infinite', fontSize: '18px', color: 'var(--accent-indigo)' }}>sync</span>
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div>Uploading <strong>{uploadingFile.name}</strong> to Render homing relays...</div>
                        <div style={{
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          height: '6px',
                          marginTop: '6px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            background: 'var(--accent-indigo)',
                            width: `${uploadingFile.progress}%`,
                            height: '100%',
                            transition: 'width 0.2s'
                          }} />
                        </div>
                      </div>
                      <span style={{ fontWeight: 'bold' }}>{uploadingFile.progress}%</span>
                      <button 
                        type="button" 
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0', marginLeft: '4px' }}
                        onClick={cancelMediaUpload}
                        title="Cancel Upload"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#ef4444' }}>cancel</span>
                      </button>
                    </div>
                  )}

                  {isMobile ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                      <button 
                        type="button" 
                        style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                        onClick={() => document.getElementById('mobile-file-input').click()}
                        disabled={!connected}
                      >
                        <span className="material-symbols-outlined">add</span>
                      </button>
                      <input
                        type="file"
                        id="mobile-file-input"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        disabled={!connected}
                      />
                      <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '24px', padding: '0 16px' }}>
                        <input 
                          type="text"
                          className="chat-input-field"
                          placeholder="Type a secure message..."
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          disabled={!connected}
                          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '15px', padding: '12px 0' }}
                        />
                        <button 
                          type="button" 
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', paddingLeft: '8px', flexShrink: 0 }}
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        >
                          <span className="material-symbols-outlined">sentiment_satisfied</span>
                        </button>
                        {showEmojiPicker && (
                          <div className="emoji-picker-popover" style={{ position: 'absolute', bottom: '54px', right: '0', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '12px', zIndex: 100, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', width: '180px' }}>
                            {['😀', '😂', '😍', '👍', '🔥', '👏', '🎉', '❤️', '🤔', '🙌', '👀', '✨', '🚀', '🔒', '🔑', '💬'].map(emoji => (
                              <button
                                key={emoji}
                                type="button"
                                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => {
                                  setInputText(prev => prev + emoji);
                                  setShowEmojiPicker(false);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button 
                        type="submit" 
                        disabled={!connected}
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--accent-indigo)',
                          color: '#ffffff',
                          border: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(129, 140, 248, 0.3)',
                          flexShrink: 0
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {inputText.trim() || pendingMedia ? 'send' : 'mic'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '16px', padding: '8px 16px' }}>
                      <button 
                        type="button" 
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }} 
                        onClick={() => document.getElementById('media-file-input').click()}
                        disabled={!connected}
                      >
                        <span className="material-symbols-outlined">add</span>
                      </button>
                      <input
                        type="file"
                        id="media-file-input"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        disabled={!connected}
                      />
                      <input 
                        type="text"
                        className="chat-input-field"
                        placeholder="Type a secure message..."
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        disabled={!connected}
                        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px', padding: '8px 0' }}
                      />
                      <div style={{ position: 'relative' }}>
                        <button 
                          type="button" 
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} 
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        >
                          <span className="material-symbols-outlined">sentiment_satisfied</span>
                        </button>
                        {showEmojiPicker && (
                          <div className="emoji-picker-popover" style={{ position: 'absolute', bottom: '50px', right: '0', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '12px', zIndex: 100, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', width: '180px' }}>
                            {['😀', '😂', '😍', '👍', '🔥', '👏', '🎉', '❤️', '🤔', '🙌', '👀', '✨', '🚀', '🔒', '🔑', '💬'].map(emoji => (
                              <button
                                key={emoji}
                                type="button"
                                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => {
                                  setInputText(prev => prev + emoji);
                                  setShowEmojiPicker(false);
                                }}
                                className="emoji-btn"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button 
                        type="submit" 
                        disabled={!connected}
                        style={{
                          background: 'var(--accent-indigo)',
                          border: 'none',
                          color: 'white',
                          width: '40px',
                          height: '40px',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'transform 0.1s'
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--accent-emerald)' }}>verified_user</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontFamily: 'monospace' }}>End-to-End Encrypted</span>
                  </div>
                </form>
              </footer>
            </>
          ) : (
            // Empty State (mockup: Recent Chats detail pane placeholder)
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
              <div className="glass-card" style={{ width: '96px', height: '96px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(99, 102, 241, 0.05)', animation: 'pulse 3s infinite ease-in-out' }}></div>
                <span className="material-symbols-outlined text-primary text-5xl" style={{ fontSize: '48px', color: 'var(--accent-indigo)' }}>shield</span>
              </div>
              <h2 className="font-display-lg text-display-lg text-on-surface" style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '12px' }}>Secure Protocol Established</h2>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '32px' }}>
                Select a conversation from the sidebar to begin messaging. All communications are protected by end-to-end hardware encryption and decentralized identity verification.
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', width: '100%' }}>
                <div className="glass-card" style={{ padding: '20px', borderRadius: '16px', textAlign: 'left', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-emerald)', marginBottom: '12px' }}>verified_user</span>
                  <h4 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '6px' }}>Verified Identity</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Check the trust score of your contacts before sharing sensitive keys.</p>
                </div>
                <div className="glass-card" style={{ padding: '20px', borderRadius: '16px', textAlign: 'left', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-rose)', marginBottom: '12px' }}>history</span>
                  <h4 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '6px' }}>Ephemeral Chats</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Enable self-destructing messages for maximum privacy on high-risk threads.</p>
                </div>
              </div>
              
              <div style={{ marginTop: '32px', background: 'rgba(255, 255, 255, 0.05)', padding: '6px 16px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-emerald)', display: 'inline-block' }}></span>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent-emerald)' }}>Global Network Status: Optimal</span>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'contacts' && (
        <section className="chat-pane" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', padding: '32px', maxWidth: '500px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '64px', color: 'var(--accent-indigo)', marginBottom: '16px' }}>group</span>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>Contacts Directory</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
              Select a user from the middle directory column to establish a secure Double Ratchet session, or add a new recipient by wallet address.
            </p>
            <button className="action-btn" style={{ margin: '0 auto' }} onClick={() => setShowDMModal(true)}>
              + Start Chatting
            </button>
          </div>
        </section>
      )}

      {/* 4. Settings Bento Grid Page (mockup: Settings (Desktop)) */}
      {activeTab === 'settings' && (
        <div className={`settings-pane ${isMobile ? 'safe-pb' : ''}`} style={isMobile ? { paddingBottom: '90px' } : {}}>
          {isMobile ? (
            /* Mobile Settings Header */
            <header style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 36px)', paddingBottom: '16px', paddingLeft: '20px', paddingRight: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', marginBottom: '16px' }}>
              <div>
                <h1 className="font-headline-sm text-headline-sm font-bold" style={{ color: 'var(--accent-indigo)', fontSize: '20px' }}>Settings</h1>
              </div>
              <button 
                type="button" 
                className="action-btn" 
                style={{ flex: 'none', background: 'var(--accent-indigo)', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px' }}
                onClick={() => alert("Settings saved locally!")}
              >
                Save
              </button>
            </header>
          ) : (
            <header className="settings-header">
              <div>
                <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface" style={{ fontSize: '24px', fontWeight: 'bold' }}>Global Settings</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>Configure client nodes and visual parameters</p>
              </div>
              <div>
                <button 
                  type="button" 
                  className="action-btn" 
                  style={{ flex: 'none', background: 'var(--accent-indigo)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold' }}
                  onClick={() => alert("Settings saved locally!")}
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>save</span>
                  Save Changes
                </button>
              </div>
            </header>
          )}

          <div className="settings-grid" style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 16px' } : {}}>
            
            {/* Appearance Card */}
            <section className="glass-card settings-card">
              <div className="settings-card-header">
                <div className="settings-icon-wrapper">
                  <span className="material-symbols-outlined">palette</span>
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>Appearance</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Visual theme & display</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
                <div className="setting-row">
                  <span className="setting-label">Dark Mode</span>
                  <label className="switch">
                    <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="setting-row">
                  <span className="setting-label">Compact View</span>
                  <label className="switch">
                    <input type="checkbox" checked={compactView} onChange={(e) => setCompactView(e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Accent Color</span>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div 
                      className={`color-dot ${accentColor === '#818cf8' ? 'active' : ''}`} 
                      style={{ backgroundColor: '#818cf8' }} 
                      onClick={() => setAccentColor('#818cf8')}
                    ></div>
                    <div 
                      className={`color-dot ${accentColor === '#4cd6fb' ? 'active' : ''}`} 
                      style={{ backgroundColor: '#4cd6fb' }} 
                      onClick={() => setAccentColor('#4cd6fb')}
                    ></div>
                    <div 
                      className={`color-dot ${accentColor === '#ffb4ab' ? 'active' : ''}`} 
                      style={{ backgroundColor: '#ffb4ab' }} 
                      onClick={() => setAccentColor('#ffb4ab')}
                    ></div>
                    <div 
                      className={`color-dot ${accentColor === '#10b981' ? 'active' : ''}`} 
                      style={{ backgroundColor: '#10b981' }} 
                      onClick={() => setAccentColor('#10b981')}
                    ></div>
                  </div>
                </div>
              </div>
            </section>

            {/* Security & Privacy Card */}
            <section className="glass-card settings-card col-span-2">
              <div className="settings-card-header">
                <div className="settings-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-emerald)' }}>
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>security</span>
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>Security & Privacy</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Manage encryption keys and metadata visibility</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '12px' }}>
                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>End-to-End Encryption</span>
                    <span style={{ fontSize: '10px', background: 'rgba(76, 214, 251, 0.2)', color: 'var(--accent-emerald)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}>Active</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>All messages are signed with your Web3 keys: {truncateAddress(wallet.address)}.</p>
                  <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent-indigo)', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => alert("Rotating pre-keys bundle...")}>Rotate Keys</button>
                </div>
                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Stealth Mode</span>
                    <label className="switch">
                      <input type="checkbox" checked={stealthMode} onChange={(e) => setStealthMode(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Obscures your username and online status from public directories.</p>
                </div>
                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Hide Wallet Address</span>
                    <label className="switch">
                      <input type="checkbox" checked={hideWalletAddress} onChange={(e) => setHideWalletAddress(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Hides your Web3 wallet address from your profile in others' views.</p>
                </div>
                {deviceBiometricsAvailable && (
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Biometric Login</span>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={biometricsSupported} 
                          onChange={async (e) => {
                            if (e.target.checked) {
                              const password = prompt("Enter your account password to enable biometric login:");
                              if (password) {
                                try {
                                  await enableBiometricLogin(password);
                                  alert("Biometric login enabled successfully!");
                                } catch (err) {
                                  alert(err.message);
                                }
                              }
                            } else {
                              try {
                                await disableBiometricLogin();
                                alert("Biometric login disabled.");
                              } catch (err) {
                                alert(err.message);
                              }
                            }
                          }} 
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Unlock the application using fingerprint or FaceID.</p>
                  </div>
                )}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => alert("Connected devices: 1 browser client.")}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--text-secondary)' }}>history</span>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 'bold' }}>Active Sessions</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>1 device connected</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginTop: '8px' }} onClick={() => alert("Blocked users: 0 addresses.")}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--text-secondary)' }}>block</span>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 'bold' }}>Blocked Entities</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>0 wallets blocked</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </div>
              </div>
            </section>

            {/* Connectivity Card */}
            <section className="glass-card settings-card col-span-2">
              <div className="settings-card-header">
                <div className="settings-icon-wrapper" style={{ background: 'rgba(29, 185, 84, 0.15)', color: 'var(--accent-emerald)' }}>
                  <span className="material-symbols-outlined">lan</span>
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>Connectivity</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Node configurations and relay endpoints</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 'bold' }}>Relay Endpoint Protocol</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Direct Encrypted Socket Connection (Port 3009)</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ fontSize: '11px', background: 'rgba(99, 102, 241, 0.2)', color: 'var(--accent-indigo)', padding: '6px 12px', borderRadius: '8px', fontWeight: 'bold' }}>Fast Relay</span>
                    <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }} onClick={() => alert("Tor router proxy requires extension.")}>Tor proxy</span>
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 'bold' }}>Auto-connect to Peers</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Maintain message latency under 200ms</p>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={autoConnect} onChange={(e) => setAutoConnect(e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </section>

            {/* Data Management Card */}
            <section className="glass-card settings-card">
              <div className="settings-card-header">
                <div className="settings-icon-wrapper" style={{ background: 'rgba(244, 63, 94, 0.15)', color: 'var(--accent-rose)' }}>
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>database</span>
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>Data Management</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Storage sizes and message retention</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 'bold' }}>Database Storage Used</span>
                    <span>1.2 KB / 10 MB</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: '5%', height: '100%', backgroundColor: 'var(--accent-indigo)' }}></div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)' }}>Message Retention</label>
                  <select 
                    value={messageRetention} 
                    onChange={(e) => setMessageRetention(e.target.value)}
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                  >
                    <option value="forever">Forever</option>
                    <option value="year">1 Year</option>
                    <option value="month">30 Days</option>
                    <option value="destruct">Self-destruct (1hr)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button 
                    type="button" 
                    style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                    onClick={logout}
                  >
                    Disconnect Wallet
                  </button>
                  <button 
                    type="button" 
                    style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                    onClick={() => {
                      if (confirm("Are you sure you want to clear your local database cache? This wipes the local mock database.")) {
                        logout();
                      }
                    }}
                  >
                    Clear Cache
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Bottom Security Alert */}
          <div className="glass-card warning-box" style={{ borderLeft: '4px solid var(--accent-rose)', background: 'rgba(29, 32, 33, 0.4)', padding: isMobile ? '16px' : '24px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '12px' : '20px', alignItems: isMobile ? 'stretch' : 'flex-start', margin: isMobile ? '16px 16px 32px 16px' : '0' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ width: '40px', height: '40px', background: 'rgba(255, 180, 171, 0.15)', color: 'var(--accent-rose)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span className="material-symbols-outlined">warning</span>
              </div>
              {isMobile && <h4 style={{ fontSize: '15px', fontWeight: 'bold' }}>Private Key Custody Notice</h4>}
            </div>
            <div style={{ flex: 1 }}>
              {!isMobile && <h4 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '4px' }}>Private Key Custody Notice</h4>}
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                Echo does not store your private keys on any central server. If you lose your recovery phrase, you will lose access to all encrypted messages. Ensure you have a physical backup of your credentials.
              </p>
            </div>
            <button 
              type="button" 
              className="action-btn"
              onClick={() => setShowExportModal(true)}
              style={{ width: isMobile ? '100%' : 'auto', padding: '10px 20px', textAlign: 'center' }}
            >
              Export Backup
            </button>
          </div>
        </div>
      )}

      {/* 5. Bottom Navigation Bar for Mobile View */}
      <div className="mobile-bottom-nav">
        <div className={`nav-item ${activeTab === 'chats' ? 'active' : ''}`} onClick={() => { setActiveTab('chats'); setActiveConversationId(null); }}>
          <span className="material-symbols-outlined">chat</span>
          <span>Chats</span>
        </div>
        <div className={`nav-item ${activeTab === 'contacts' ? 'active' : ''}`} onClick={() => setActiveTab('contacts')}>
          <span className="material-symbols-outlined">group</span>
          <span>Contacts</span>
        </div>
        <div className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <span className="material-symbols-outlined">settings</span>
          <span>Settings</span>
        </div>
      </div>

      {/* Modals Implementations */}
      {/* Start Conversation Choice Modal */}
      {showNewChatMenu && (
        <div className="modal-overlay" onClick={() => setShowNewChatMenu(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '340px', padding: '24px' }}>
            <div className="modal-header" style={{ marginBottom: '16px', textAlign: 'center' }}>Start Conversation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                type="button"
                className="confirm-btn"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px', fontSize: '15px' }}
                onClick={() => {
                  setShowNewChatMenu(false);
                  setShowDMModal(true);
                }}
              >
                <span className="material-symbols-outlined">chat</span>
                Direct Message
              </button>
              <button 
                type="button"
                className="confirm-btn"
                style={{ background: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px', fontSize: '15px' }}
                onClick={() => {
                  setShowNewChatMenu(false);
                  setShowGroupModal(true);
                }}
              >
                <span className="material-symbols-outlined">group</span>
                Create Group Chat
              </button>
              <button 
                type="button"
                className="cancel-btn"
                style={{ marginTop: '4px', padding: '12px' }}
                onClick={() => setShowNewChatMenu(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showDMModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Start a Direct Message</span>
              {isMobile && (
                <button 
                  type="button" 
                  onClick={() => { setShowDMModal(false); setShowGroupModal(true); setNewChatAddress(''); }} 
                  style={{ background: 'none', border: 'none', color: 'var(--accent-indigo)', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Create Group
                </button>
              )}
            </div>
            <div className="auth-input-group">
              <label className="auth-label">Recipient Username</label>
              <input
                type="text"
                className="auth-input"
                value={newChatAddress}
                onChange={(e) => setNewChatAddress(e.target.value)}
                placeholder="Enter username (or wallet address)"
                required
              />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => { setShowDMModal(false); setNewChatAddress(''); }}>Cancel</button>
              <button className="confirm-btn" onClick={async () => {
                const targetInput = newChatAddress.trim();
                if (!targetInput) return;

                const isWalletAddress = targetInput.startsWith('0x') && targetInput.length === 42;

                try {
                  if (isWalletAddress) {
                    const checkRes = await fetch(`${serverUrl}/users/exists/${targetInput}`);
                    const checkData = await checkRes.json();
                    if (!checkData.exists) {
                      alert("Wallet address is not registered on the server.");
                      return;
                    }
                    // Start direct message by address
                    await sendDirectMessage(targetInput.toLowerCase(), "👋 Initiated secure channel.");
                    setShowDMModal(false);
                    setActiveTab('chats');
                    setActiveConversationId(targetInput.toLowerCase());
                    setNewChatAddress('');
                  } else {
                    const searchRes = await fetch(`${serverUrl}/users/search/${targetInput}`);
                    if (searchRes.status === 404) {
                      alert("User not found.");
                      return;
                    }
                    const searchData = await searchRes.json();
                    if (searchData.success) {
                      // Update cache
                      const resolvedAddress = searchData.address || targetInput.toLowerCase();
                      updateUsernameCache(resolvedAddress, searchData.username, searchData.hide_wallet, searchData.bio, searchData.pfp);

                      // If hide_wallet is true, the peer identifier is the username itself!
                      const peerIdentifier = searchData.hide_wallet ? searchData.username.toLowerCase() : resolvedAddress.toLowerCase();

                      await sendDirectMessage(peerIdentifier, "👋 Initiated secure channel.", searchData.username, searchData.hide_wallet, searchData.bio, searchData.pfp);

                      setShowDMModal(false);
                      setActiveTab('chats');
                      setActiveConversationId(peerIdentifier);
                      setNewChatAddress('');
                    } else {
                      alert(searchData.error || "User search failed.");
                    }
                  }
                } catch (err) {
                  alert("Error starting chat: " + err.message);
                }
              }}>Start Chat</button>
            </div>
          </div>
        </div>
      )}

      {showGroupModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Create E2EE Group Chat</span>
              {isMobile && (
                <button 
                  type="button" 
                  onClick={() => { setShowGroupModal(false); setShowDMModal(true); setNewGroupName(''); setSelectedGroupMembers([]); }} 
                  style={{ background: 'none', border: 'none', color: 'var(--accent-indigo)', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Start DM
                </button>
              )}
            </div>
            <div className="auth-input-group">
              <label className="auth-label">Group Name</label>
              <input
                type="text"
                className="auth-input"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="My Secure Space"
                required
              />
            </div>
            <div className="auth-input-group">
              <label className="auth-label">Select Group Members</label>
              <div className="contacts-checkbox-list" style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-tertiary)', marginBottom: '12px' }}>
                {getCombinedContacts().length === 0 ? (
                  <div style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>No contacts found.</div>
                ) : (
                  getCombinedContacts().map(contact => {
                    const isChecked = selectedGroupMembers.includes(contact.address);
                    return (
                      <label key={contact.address} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', padding: '4px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGroupMembers(prev => [...prev, contact.address]);
                            } else {
                              setSelectedGroupMembers(prev => prev.filter(addr => addr !== contact.address));
                            }
                          }}
                        />
                        <div className="avatar-container" style={{ width: '24px', height: '24px', fontSize: '10px' }}>
                          {contact.pfp ? (
                            <img src={contact.pfp} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            contact.username.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <span>@{contact.username}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>({truncateAddress(contact.address)})</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => { setShowGroupModal(false); setNewGroupName(''); setSelectedGroupMembers([]); }}>Cancel</button>
              <button className="confirm-btn" onClick={async () => {
                if (newGroupName.trim() && selectedGroupMembers.length > 0) {
                  try {
                    await createGroup(newGroupName.trim(), selectedGroupMembers);
                    setShowGroupModal(false);
                    setNewGroupName('');
                    setSelectedGroupMembers([]);
                  } catch (err) {
                    alert(err.message);
                  }
                } else if (selectedGroupMembers.length === 0) {
                  alert("Please select at least one member.");
                }
              }}>Create Group</button>
            </div>
          </div>
        </div>
      )}

      {showInfoModal && activeChat && (
        <div className="modal-overlay" onClick={() => setShowInfoModal(false)}>
          <div className="modal-card" style={{ width: '520px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                {isGroupActive ? 'Group Information' : 'User Profile'}
              </div>
              <button 
                onClick={() => setShowInfoModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Main Tabs Navigation */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', gap: '16px' }}>
              <button 
                onClick={() => setInfoModalTab('details')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: infoModalTab === 'details' ? '2px solid var(--accent-indigo)' : '2px solid transparent',
                  color: infoModalTab === 'details' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'all 0.2s'
                }}
              >
                {isGroupActive ? 'Details' : 'About'}
              </button>
              <button 
                onClick={() => setInfoModalTab('attachments')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: infoModalTab === 'attachments' ? '2px solid var(--accent-indigo)' : '2px solid transparent',
                  color: infoModalTab === 'attachments' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'all 0.2s'
                }}
              >
                Shared Attachments ({
                  messages.filter(msg => {
                    if (msg.media_metadata) {
                      try {
                        const mediaObj = typeof msg.media_metadata === 'string' ? JSON.parse(msg.media_metadata) : msg.media_metadata;
                        return mediaObj && mediaObj.mediaId;
                      } catch {
                        return false;
                      }
                    }
                    return false;
                  }).length
                })
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
              
              {/* Tab 1: Details / About */}
              {infoModalTab === 'details' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
                  
                  {/* PFP Display */}
                  <div style={{
                    width: '96px',
                    height: '96px',
                    borderRadius: '50%',
                    background: 'var(--bg-tertiary)',
                    border: '2px solid var(--border-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '36px',
                    fontWeight: 'bold',
                    color: 'var(--text-primary)',
                    overflow: 'hidden'
                  }}>
                    {isGroupActive ? (
                      'G'
                    ) : (() => {
                      const contact = getCombinedContacts().find(item => 
                        item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                        item.username.toLowerCase() === activeChat.id.toLowerCase()
                      );
                      if (sanitizePfpUrl(contact?.pfp)) {
                        return <img src={sanitizePfpUrl(contact.pfp)} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
                      }
                      const name = contact ? contact.username : activeChat.username;
                      return name.substring(0, 2).toUpperCase();
                    })()}
                  </div>

                  {/* Name / Username */}
                  <div>
                    <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>
                      {isGroupActive ? activeChat.username : (() => {
                        const contact = getCombinedContacts().find(item => 
                          item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                          item.username.toLowerCase() === activeChat.id.toLowerCase()
                        );
                        return contact ? `@${contact.username}` : `@${activeChat.username}`;
                      })()}
                    </h3>
                    
                    {!isGroupActive && (
                      <div style={{ fontSize: '12px', color: 'var(--accent-indigo)', marginTop: '4px', fontWeight: '600' }}>
                        Active Secure DM Session
                      </div>
                    )}
                  </div>

                  {/* Wallet Address section */}
                  {!isGroupActive && (() => {
                    const contact = getCombinedContacts().find(item => 
                      item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                      item.username.toLowerCase() === activeChat.id.toLowerCase()
                    );
                    const hideWallet = contact?.hide_wallet;
                    const addressToShow = contact?.address || activeChat.id;
                    if (hideWallet) {
                      return (
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-light)', width: '100%' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', tracking: '0.05em', fontWeight: 'bold', textAlign: 'left' }}>Wallet Address</div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '4px', textAlign: 'left' }}>Hidden for privacy</div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-light)', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', tracking: '0.05em', fontWeight: 'bold' }}>Wallet Address</div>
                          <div style={{ fontSize: '13px', color: 'var(--accent-emerald)', fontFamily: 'monospace', marginTop: '4px', wordBreak: 'break-all' }}>
                            {addressToShow}
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(addressToShow);
                            alert("Address copied to clipboard!");
                          }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                          title="Copy Address"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>content_copy</span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* Bio details (if 1-1 chat) */}
                  {!isGroupActive && (() => {
                    const contact = getCombinedContacts().find(item => 
                      item.address.toLowerCase() === activeChat.id.toLowerCase() ||
                      item.username.toLowerCase() === activeChat.id.toLowerCase()
                    );
                    const bioText = contact?.bio || activeChat.bio || 'No biography set.';
                    return (
                      <div style={{ textAlign: 'left', width: '100%' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', tracking: '0.05em', fontWeight: 'bold', marginBottom: '6px' }}>Biography</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-primary)', background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--border-light)', minHeight: '44px', fontStyle: contact?.bio ? 'normal' : 'italic' }}>
                          {bioText}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Group Members list (if Group Chat) */}
                  {isGroupActive && activeGroupDetails && (
                    <div style={{ textAlign: 'left', width: '100%' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', tracking: '0.05em', fontWeight: 'bold', marginBottom: '8px' }}>
                        Group Members ({JSON.parse(activeGroupDetails.members || '[]').length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                        {JSON.parse(activeGroupDetails.members || '[]').map((memberAddress) => {
                          const mid = memberAddress.toLowerCase();
                          const mContact = getCombinedContacts().find(item => item.address.toLowerCase() === mid || item.username.toLowerCase() === mid);
                          const mCached = usernameCache[mid];
                          const member = {
                            address: mContact?.address || (mCached ? mid : memberAddress),
                            username: mContact?.username || mCached?.username || memberAddress,
                            pfp: mContact?.pfp || mCached?.pfp || null,
                            bio: mContact?.bio || mCached?.bio || '',
                            hide_wallet: mContact ? mContact.hide_wallet : (mCached ? mCached.hideWallet : false)
                          };
                          const isMe = memberAddress.toLowerCase() === wallet.address.toLowerCase();
                          return (
                            <div 
                              key={memberAddress} 
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '12px', 
                                padding: '8px 12px', 
                                borderRadius: '12px', 
                                background: 'rgba(255,255,255,0.02)', 
                                border: '1px solid var(--border-light)' 
                              }}
                            >
                              <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-light)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                flexShrink: 0
                              }}>
                                {sanitizePfpUrl(member.pfp) ? (
                                  <img src={sanitizePfpUrl(member.pfp)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  member.username.substring(0, 2).toUpperCase()
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                    {member.username.startsWith('0x') && member.username.length === 42 ? truncateAddress(member.username) : `@${member.username}`}
                                  </span>
                                  {isMe && (
                                    <span style={{ fontSize: '10px', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-indigo)', padding: '2px 6px', borderRadius: '8px', fontWeight: 'bold' }}>
                                      You
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  {member.hide_wallet ? 'Address Hidden' : member.address}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* Tab 2: Shared Attachments */}
              {infoModalTab === 'attachments' && (() => {
                const attachments = messages.filter(msg => {
                  if (msg.media_metadata) {
                    try {
                      const mediaObj = typeof msg.media_metadata === 'string' ? JSON.parse(msg.media_metadata) : msg.media_metadata;
                      return mediaObj && mediaObj.mediaId;
                    } catch {
                      return false;
                    }
                  }
                  return false;
                });

                if (attachments.length === 0) {
                  return (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '48px', opacity: 0.3, display: 'block', marginBottom: '12px' }}>draft</span>
                      No shared media or attachments found in this chat.
                    </div>
                  );
                }

                // Categorize images and general files
                const images = [];
                const documents = [];

                attachments.forEach(msg => {
                  const mediaObj = typeof msg.media_metadata === 'string' ? JSON.parse(msg.media_metadata) : msg.media_metadata;
                  const isCached = mediaCache[mediaObj.mediaId] !== undefined;
                  const isImage = mediaObj.mimeType.startsWith('image/');
                  const item = {
                    msgId: msg.id,
                    mediaObj,
                    isCached,
                    timestamp: msg.timestamp,
                    senderAddress: msg.sender_address
                  };
                  if (isImage) {
                    images.push(item);
                  } else {
                    documents.push(item);
                  }
                });

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '8px 0' }}>
                    
                    {/* Images Section */}
                    {images.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', tracking: '0.05em', fontWeight: 'bold', marginBottom: '10px', textAlign: 'left' }}>
                          Images ({images.length})
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                          {images.map(item => {
                            const { mediaObj, isCached } = item;
                            return (
                              <div 
                                key={mediaObj.mediaId} 
                                style={{ 
                                  position: 'relative', 
                                  aspectRatio: '1', 
                                  background: 'var(--bg-tertiary)', 
                                  borderRadius: '8px', 
                                  border: '1px solid var(--border-light)',
                                  overflow: 'hidden',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: isCached ? 'pointer' : 'default'
                                }}
                                onClick={() => isCached && setActiveLightboxUrl(mediaCache[mediaObj.mediaId].url)}
                                title={isCached ? 'Open Image' : 'Download to Decrypt'}
                              >
                                {isCached ? (
                                  <img 
                                    src={mediaCache[mediaObj.mediaId].url} 
                                    alt="" 
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                  />
                                ) : (
                                  <div 
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px', width: '100%', height: '100%', justifyContent: 'center' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      triggerMediaDownload(mediaObj);
                                    }}
                                  >
                                    {downloadingMedia[mediaObj.mediaId] !== undefined ? (
                                      <>
                                        <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--accent-indigo)', animation: 'spin 2s linear infinite' }}>sync</span>
                                        <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{downloadingMedia[mediaObj.mediaId]}%</span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="material-symbols-outlined" style={{ fontSize: '24px', color: 'var(--text-secondary)', cursor: 'pointer' }}>cloud_download</span>
                                        <span style={{ fontSize: '8px', color: 'var(--text-secondary)', textAlign: 'center' }}>Click to Decrypt</span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Documents Section */}
                    {documents.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', tracking: '0.05em', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                          Files & Documents ({documents.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {documents.map(item => {
                            const { mediaObj, isCached } = item;
                            const filename = `file_${mediaObj.mediaId.substring(6, 12)}.${mediaObj.mimeType.split('/')[1] || 'bin'}`;
                            return (
                              <div 
                                key={mediaObj.mediaId} 
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '12px', 
                                  padding: '10px 14px', 
                                  borderRadius: '12px', 
                                  background: 'rgba(255,255,255,0.02)', 
                                  border: '1px solid var(--border-light)' 
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '28px', color: isCached ? 'var(--accent-indigo)' : 'var(--text-secondary)' }}>
                                  {isCached ? 'description' : 'draft'}
                                </span>
                                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    {filename}
                                  </div>
                                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                    {mediaObj.mimeType} • {mediaObj.totalChunks} chunks
                                  </div>
                                </div>
                                {isCached ? (
                                  <button 
                                    onClick={() => {
                                      const a = document.createElement('a');
                                      a.href = mediaCache[mediaObj.mediaId].url;
                                      a.download = filename;
                                      document.body.appendChild(a);
                                      a.click();
                                      document.body.removeChild(a);
                                    }}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent-emerald)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                    title="Save file"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>download</span>
                                  </button>
                                ) : (
                                  <button 
                                    onClick={() => triggerMediaDownload(mediaObj)}
                                    disabled={downloadingMedia[mediaObj.mediaId] !== undefined}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                    title="Decrypt file"
                                  >
                                    {downloadingMedia[mediaObj.mediaId] !== undefined ? (
                                      <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--accent-indigo)', animation: 'spin 2s linear infinite' }}>sync</span>
                                    ) : (
                                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>cloud_download</span>
                                    )}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                );
              })()}

            </div>

            {/* Modal Footer / Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
              <button 
                className="confirm-btn" 
                onClick={() => setShowInfoModal(false)}
                style={{
                  background: 'var(--accent-indigo)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">Backup Database Export</div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Export all local histories, conversations, and cryptographic keys encrypted with scrypt.
            </p>
            <div className="auth-input-group">
              <label className="auth-label">Enter Protection Passphrase</label>
              <input
                type="password"
                className="auth-input"
                value={backupPassphrase}
                onChange={(e) => setBackupPassphrase(e.target.value)}
                placeholder="Choose a strong password"
                required
              />
            </div>
            {backupJSON && (
              <div className="auth-input-group" style={{ marginTop: '12px' }}>
                <label className="auth-label">Encrypted Backup Data</label>
                <textarea
                  className="textarea-field"
                  value={backupJSON}
                  readOnly
                  onClick={(e) => e.target.select()}
                />
                <span style={{ fontSize: '11px', color: 'var(--accent-emerald)' }}>
                  Copy this backup string and save it securely.
                </span>
              </div>
            )}
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => { setShowExportModal(false); setBackupPassphrase(''); setBackupJSON(''); }}>Close</button>
              {!backupJSON ? (
                <button className="confirm-btn" onClick={async () => {
                  if (backupPassphrase) {
                    setIsDerivingKey(true);
                    setTimeout(async () => {
                      try {
                        const backup = await exportBackup(backupPassphrase);
                        setBackupJSON(backup);
                      } catch (err) {
                        alert(err.message);
                      } finally {
                        setIsDerivingKey(false);
                      }
                    }, 50);
                  }
                }}>Encrypt & Export</button>
              ) : (
                <button className="confirm-btn" onClick={() => {
                  navigator.clipboard.writeText(backupJSON);
                  alert("Copied to clipboard!");
                }}>Copy String</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showImportModal && !registered && null}
      {showImportModal && registered && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">Restore Database Backup</div>
            <div className="auth-input-group">
              <label className="auth-label">Passphrase</label>
              <input
                type="password"
                className="auth-input"
                value={backupPassphrase}
                onChange={(e) => setBackupPassphrase(e.target.value)}
                placeholder="Enter decryption passphrase"
                required
              />
            </div>
            <div className="auth-input-group">
              <label className="auth-label">Encrypted Backup JSON</label>
              <textarea
                className="textarea-field"
                value={backupJSON}
                onChange={(e) => setBackupJSON(e.target.value)}
                placeholder="Paste backup string here"
                required
              />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => { setShowImportModal(false); setBackupPassphrase(''); setBackupJSON(''); }}>Cancel</button>
              <button className="confirm-btn" onClick={async () => {
                if (backupPassphrase && backupJSON) {
                  setIsDerivingKey(true);
                  setTimeout(async () => {
                    try {
                      await importBackup(backupPassphrase, backupJSON);
                      setShowImportModal(false);
                      setBackupPassphrase('');
                      setBackupJSON('');
                      alert("Database restored successfully!");
                    } catch (err) {
                      alert(err.message);
                    } finally {
                      setIsDerivingKey(false);
                    }
                  }, 50);
                }
              }}>Restore Backup</button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div 
          className={isMobile ? "full-bleed-mobile-pane animate-fade-in" : "modal-overlay"}
          style={isMobile ? { position: 'fixed', inset: 0, backgroundColor: 'var(--bg-primary)', zIndex: 1000, display: 'flex', flexDirection: 'column', overflowY: 'auto' } : {}}
        >
          {isMobile ? (
            /* Mobile Full-Bleed Profile Header */
            <header className="safe-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 100 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button type="button" className="back-btn" onClick={() => setShowProfileModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <span className="material-symbols-outlined">arrow_back</span>
                </button>
                <h1 className="font-headline-sm text-headline-sm font-bold" style={{ fontSize: '20px' }}>User Profile</h1>
              </div>
              <button 
                className="action-btn" 
                disabled={isSavingProfile}
                onClick={async () => {
                  setIsSavingProfile(true);
                  try {
                    await updateProfile(editUsername.trim(), editBio.trim(), editPfp);
                    alert("Profile updated successfully!");
                    setShowProfileModal(false);
                  } catch (err) {
                    alert(err.message);
                  } finally {
                    setIsSavingProfile(false);
                  }
                }}
                style={{ flex: 'none', background: 'var(--accent-indigo)', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px' }}
              >
                {isSavingProfile ? 'Saving...' : 'Save'}
              </button>
            </header>
          ) : null}

          <div 
            className={isMobile ? "safe-footer" : "modal-card profile-hub-card"} 
            style={isMobile ? { flex: 1, padding: '24px 20px 40px 20px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' } : { maxWidth: '450px' }}
          >
            {!isMobile && <div className="modal-header">Edit Profile Hub</div>}
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px', gap: '8px' }}>
              <div className="avatar-container" style={{ width: '96px', height: '96px', fontSize: '32px', position: 'relative', overflow: 'hidden', cursor: 'pointer', border: '3px solid var(--accent-indigo)', borderRadius: '50%' }} onClick={() => document.getElementById('profile-pfp-input').click()}>
                {sanitizePfpUrl(editPfp) ? (
                  <img src={sanitizePfpUrl(editPfp)} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  editUsername.substring(0, 2).toUpperCase()
                )}
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', opacity: 0, transition: 'opacity 0.2s' }} className="avatar-hover">
                  <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>photo_camera</span>
                </div>
              </div>
              <input
                type="file"
                id="profile-pfp-input"
                style={{ display: 'none' }}
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 150 * 1024) {
                    alert("Profile picture must be under 150KB. Please choose a smaller image.");
                    e.target.value = '';
                    return;
                  }
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    setEditPfp(reader.result);
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Click avatar to upload photo</span>
            </div>

            <div className="glass-card" style={{ padding: '16px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="auth-input-group">
                <label className="auth-label" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-indigo)' }}>Username</label>
                <input
                  type="text"
                  className="auth-input"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value.toLowerCase())}
                  placeholder="username"
                  pattern="^[a-z0-9_]{3,20}$"
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '8px', color: 'var(--text-primary)', marginTop: '6px' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                  Changes count: {usernameChangesCount} / 3. 
                  {lastUsernameChangeAt && ` Last changed: ${new Date(Number(lastUsernameChangeAt)).toLocaleDateString()}`}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--accent-rose)', marginTop: '2px' }}>
                  Note: Max 3 changes allowed, with a 14-day gap in between.
                </div>
              </div>

              <div className="auth-input-group">
                <label className="auth-label" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-indigo)' }}>Bio</label>
                <textarea
                  className="textarea-field"
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Write something about yourself..."
                  rows="3"
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '8px', color: 'var(--text-primary)', marginTop: '6px', resize: 'none' }}
                />
              </div>
            </div>

            <div className="glass-card" style={{ padding: '16px', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent-rose)', marginBottom: '8px' }}>Danger Zone</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.4' }}>
                Deleting your account will completely delete your registration records from the server and send a secure wipe command to all your contacts to delete your messages from their devices.
              </p>
              <button 
                className="action-btn" 
                style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)', width: '100%', padding: '12px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', fontWeight: 'bold' }}
                onClick={() => {
                  if (confirm("WARNING: Are you sure you want to completely DELETE your account and wipe all your data from other's devices? This action is irreversible.")) {
                    deleteAccountAction();
                  }
                }}
              >
                Delete Account & Wipe from Peers
              </button>
            </div>

            {!isMobile && (
              <div className="modal-actions" style={{ marginTop: '12px', display: 'flex', gap: '12px', justifyContent: 'end' }}>
                <button className="cancel-btn" onClick={() => setShowProfileModal(false)}>Cancel</button>
                <button 
                  className="confirm-btn" 
                  disabled={isSavingProfile}
                  onClick={async () => {
                    setIsSavingProfile(true);
                    try {
                      await updateProfile(editUsername.trim(), editBio.trim(), editPfp);
                      alert("Profile updated successfully!");
                      setShowProfileModal(false);
                    } catch (err) {
                      alert(err.message);
                    } finally {
                      setIsSavingProfile(false);
                    }
                  }}
                >
                  {isSavingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {activeLightboxUrl && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.92)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out'
          }}
          onClick={() => setActiveLightboxUrl(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '90vw', height: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <QuickPinchZoom
              onUpdate={({ x, y, scale }) => {
                if (lightboxImgRef.current) {
                  lightboxImgRef.current.style.transform = make3dTransformValue({ x, y, scale });
                }
              }}
              tapZoomFactor={2}
            >
              <img 
                ref={lightboxImgRef}
                src={activeLightboxUrl} 
                alt="Enlarged Media" 
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '100%', 
                  objectFit: 'contain',
                  borderRadius: '12px',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
                }}
              />
            </QuickPinchZoom>
          </div>
          <button 
            style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveLightboxUrl(null);
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Key Derivation Loader Overlay */}
      {isDerivingKey && (
        <div className="modal-overlay" style={{ zIndex: 10000, backgroundColor: 'rgba(0, 0, 0, 0.8)' }}>
          <div className="modal-card" style={{ textAlign: 'center', padding: '30px 20px', maxWidth: '350px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--accent-indigo)', animation: 'spin 2s linear infinite' }}>sync</span>
              <div style={{ fontWeight: 'bold', fontSize: '15px' }}>Deriving secure key...</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Computing PBKDF2-SHA256 (600,000 iterations). This will take a moment.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
