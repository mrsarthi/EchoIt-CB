import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as DecentraChatClientModule from 'decentrachat-client-sdk';
import { 
  isWeb3Available, 
  connectWallet, 
  getConnectedAddress, 
  signMessage 
} from './blockchain/web3Provider';

const DecentraChatClient = DecentraChatClientModule.default || DecentraChatClientModule;

const DecentraChatContext = createContext(null);

export const useDecentraChat = () => {
  const context = useContext(DecentraChatContext);
  if (!context) {
    throw new Error('useDecentraChat must be used within a DecentraChatProvider');
  }
  return context;
};

export const DecentraChatProvider = ({ children }) => {
  const [clientState, _setClient] = useState(null);
  const client = clientState;
  const setClient = (val) => {
    console.log("[Context setClient] changing client from", clientState?.address, "to", val?.address);
    _setClient(val);
  };

  const [wallet, setWallet] = useState(null);
  const [connected, setConnected] = useState(false);

  const [registeredState, _setRegistered] = useState(false);
  const registered = registeredState;
  const setRegistered = (val) => {
    console.log("[Context setRegistered] changing registered from", registeredState, "to", val);
    _setRegistered(val);
  };

  const [walletRegisteredOnServer, setWalletRegisteredOnServer] = useState(false);
  const [username, setUsername] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [bootPhase, setBootPhase] = useState('checking_crypto');
  const [bootError, setBootError] = useState(null);

  const [loadingState, _setLoading] = useState(true);
  const loading = loadingState;
  const setLoading = (val) => {
    console.log("[Context setLoading] changing loading from", loadingState, "to", val, new Error().stack);
    _setLoading(val);
    if (!val) {
      setBootPhase('ready');
    }
  };

  const [error, setError] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  console.log("[Context Render] loading:", loading, "registered:", registered, "clientAddress:", client?.address, "connected:", connected);

  // Profile details states
  const [bio, setBio] = useState('');
  const [pfp, setPfp] = useState(null);
  const [usernameChangesCount, setUsernameChangesCount] = useState(0);
  const [lastUsernameChangeAt, setLastUsernameChangeAt] = useState(null);
  const [groupMessageStatuses, setGroupMessageStatuses] = useState([]);

  // Privacy Settings States
  const [stealthMode, setStealthMode] = useState(() => {
    return localStorage.getItem('echo_stealth_mode') === 'true';
  });
  const [hideWalletAddress, setHideWalletAddress] = useState(() => {
    return localStorage.getItem('echo_hide_wallet') === 'true';
  });
  const [usernameCache, setUsernameCache] = useState(() => {
    try {
      const saved = sessionStorage.getItem('echo_username_cache');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const updateUsernameCache = useCallback((address, username, hideWallet, bio = '', pfp = null) => {
    if (!address) return;
    setUsernameCache(prev => {
      const next = { ...prev, [address.toLowerCase()]: { username, hideWallet, bio, pfp } };
      sessionStorage.setItem('echo_username_cache', JSON.stringify(next));
      return next;
    });
  }, []);

  // Persist settings locally
  useEffect(() => {
    localStorage.setItem('echo_stealth_mode', stealthMode ? 'true' : 'false');
  }, [stealthMode]);

  useEffect(() => {
    localStorage.setItem('echo_hide_wallet', hideWalletAddress ? 'true' : 'false');
  }, [hideWalletAddress]);

  // Sync settings to server when connected
  useEffect(() => {
    if (connected && client && client.socket) {
      client.socket.emit('updateSettings', { stealthMode, hideWallet: hideWalletAddress }, (res) => {
        if (!res || !res.success) {
          console.error("Failed to sync settings with server:", res?.error);
        } else {
          console.log("Settings successfully synced with server.");
        }
      });
    }
  }, [connected, client, stealthMode, hideWalletAddress]);

  const serverUrl = typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3009'
    : (import.meta.env.VITE_RELAY_URL || 'https://decentrachat-singnalling.onrender.com');

  const wakeUpServer = useCallback(async (maxTries = 3) => {
    console.log(`[Server Wakeup] Pinging signalling server at ${serverUrl}/health...`);
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 15000); // 15s timeout
        
        const res = await fetch(`${serverUrl}/health`, { 
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache' }
        });
        clearTimeout(id);
        
        if (res.ok) {
          console.log(`[Server Wakeup] Server is awake and healthy! (Attempt ${attempt})`);
          return true;
        }
        throw new Error(`Server returned status: ${res.status}`);
      } catch (err) {
        console.warn(`[Server Wakeup] Attempt ${attempt} failed:`, err.message || err);
        if (attempt === maxTries) {
          throw new Error(`Signalling server is unresponsive after ${maxTries} wake-up attempts. Details: ${err.message}`);
        }
        // Wait 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }, [serverUrl]);


  // Helper to initialize DecentraChatClient with a connected wallet address
  const initializeClientForAddress = useCallback(async (walletAddress, checkCurrent = () => true) => {
    try {
      setBootPhase('loading_keys');
      const activeWallet = {
        address: walletAddress.toLowerCase(),
        signMessage: async (msg) => {
          return await signMessage(msg);
        }
      };
      if (!checkCurrent()) return;
      setWallet(activeWallet);

      // Instantiate SDK Client (using a local database file name)
      const dbName = `wallet_db_${walletAddress.substring(0, 10).toLowerCase()}`;
      const newClient = new DecentraChatClient(serverUrl, activeWallet, dbName);
      await newClient.init(); // Initialize IndexedDB database
      
      if (!checkCurrent()) return;
      setClient(newClient);

      // Check registration status from client database metadata
      const isReg = await newClient.getMetadata('registered') === 'true';
      if (!checkCurrent()) return;
      setRegistered(isReg);
      if (isReg) {
        const storedUsername = await newClient.getMetadata('username');
        if (!checkCurrent()) return;
        setUsername(storedUsername || '');

        const storedStealth = await newClient.getMetadata('stealth_mode') === 'true';
        if (!checkCurrent()) return;
        setStealthMode(storedStealth);
        const storedHide = await newClient.getMetadata('hide_wallet') === 'true';
        if (!checkCurrent()) return;
        setHideWalletAddress(storedHide);

        const storedBio = await newClient.getMetadata('bio');
        if (!checkCurrent()) return;
        setBio(storedBio || '');
        const storedPfp = await newClient.getMetadata('pfp');
        if (!checkCurrent()) return;
        setPfp(storedPfp || null);
      } else {
        // Check if address is registered on the server
        try {
          const checkUrl = `${serverUrl}/users/exists/${walletAddress}`;
          const res = await fetch(checkUrl);
          const data = await res.json();
          if (!checkCurrent()) return;
          setWalletRegisteredOnServer(data.exists);
        } catch (e) {
          console.error("Failed to check server registration status:", e);
          if (!checkCurrent()) return;
          setWalletRegisteredOnServer(false);
        }
      }
      if (!checkCurrent()) return;
      setLoading(false);
      setBootPhase('ready');
      return newClient;
    } catch (err) {
      console.error("Initialization error:", err);
      if (!checkCurrent()) return;
      setError("Failed to initialize client database: " + err.message);
      setBootError(err.message);
      setBootPhase('error');
      setLoading(false);
    }
  }, [serverUrl]);

  // Action to log in an already registered wallet address
  const loginUser = async () => {
    if (!client) throw new Error("Client not initialized.");
    setLoading(true);
    setError(null);
    try {
      await wakeUpServer();
      const result = await client.loginWithSignature();
      setUsername(result.username);
      setStealthMode(!!result.stealthMode);
      setHideWalletAddress(!!result.hideWallet);
      setBio(result.bio || '');
      setPfp(result.pfp || null);
      setUsernameChangesCount(result.usernameChangesCount || 0);
      setLastUsernameChangeAt(result.lastUsernameChangeAt || null);
      setRegistered(true);
      await connectClient(client);
      await refreshData(client);
      setLoading(false);
    } catch (err) {
      console.error("[Context] Login error:", err.message);
      setError("Login failed: " + err.message);
      setLoading(false);
      throw err;
    }
  };

  // Action to re-authenticate when session expires
  const reauthenticateUser = async () => {
    if (!client) throw new Error("Client not initialized.");
    setLoading(true);
    setError(null);
    try {
      await wakeUpServer();
      const result = await client.reauthenticateWithSignature();
      setUsername(result.username);
      setStealthMode(!!result.stealthMode);
      setHideWalletAddress(!!result.hideWallet);
      setBio(result.bio || '');
      setPfp(result.pfp || null);
      setUsernameChangesCount(result.usernameChangesCount || 0);
      setLastUsernameChangeAt(result.lastUsernameChangeAt || null);
      setRegistered(true);
      setSessionExpired(false);
      // Reconnect client
      await connectClient(client);
      setLoading(false);
    } catch (err) {
      console.error("[Context] Re-authentication error:", err.message);
      setError("Re-authentication failed: " + err.message);
      setLoading(false);
      throw err;
    }
  };

  // Action to connect wallet manually
  const connectWalletAction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      localStorage.removeItem('decentrachat_explicit_disconnect');
      const { address: walletAddress } = await connectWallet();
      localStorage.setItem('decentrachat_last_wallet_address', walletAddress);
      await initializeClientForAddress(walletAddress);
    } catch (err) {
      console.error("Wallet connection failed:", err);
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, [initializeClientForAddress]);

  // Initial load check
  useEffect(() => {
    let isCurrent = true;
    const checkExistingConnection = async () => {
      try {
        // Step 1: Verify Web Crypto APIs are available
        setBootPhase('checking_crypto');
        if (!window.crypto?.getRandomValues || !window.crypto?.subtle) {
          throw new Error('CRYPTO_UNAVAILABLE');
        }

        const isExplicitDisconnect = localStorage.getItem('decentrachat_explicit_disconnect') === 'true';
        if (isExplicitDisconnect) {
          if (isCurrent) {
            setLoading(false);
            setBootPhase('ready');
          }
          return;
        }

        const connectedAddr = await getConnectedAddress();
        const lastUsedAddr = localStorage.getItem('decentrachat_last_wallet_address');
        
        // If wallet is connected or we have a last used address and Web3 is available
        const targetAddr = connectedAddr || lastUsedAddr;
        if (targetAddr && isWeb3Available()) {
          setBootPhase('loading_keys');
          const newClient = await initializeClientForAddress(targetAddr, () => isCurrent);
          if (isCurrent && newClient) {
            const isReg = await newClient.getMetadata('registered') === 'true';
            if (isReg) {
              setBootPhase('connecting');
              try {
                await connectClient(newClient);
              } catch (e) {
                console.error("Auto-connect failed during init:", e.message);
              }
            }
            setBootPhase('ready');
          }
        } else {
          if (isCurrent) {
            setLoading(false);
            setBootPhase('ready');
          }
        }
      } catch (err) {
        console.error("Check existing connection failed:", err);
        if (isCurrent) {
          if (err.message === 'CRYPTO_UNAVAILABLE') {
            setBootError('CRYPTO_UNAVAILABLE');
          } else {
            setBootError(err.message);
          }
          setBootPhase('error');
          setLoading(false);
        }
      }
    };
    checkExistingConnection();
    return () => {
      isCurrent = false;
    };
  }, [initializeClientForAddress]);


  // Sync data function
  const refreshData = useCallback(async (currentClient = client, activeId = activeConversationId) => {
    if (!currentClient) return;
    try {
      const convs = await currentClient.db.read(db => db.prepare('SELECT * FROM conversations').all());
      const decoratedConvs = [];
      for (const conv of (convs || [])) {
        const msgs = await currentClient.db.read(db =>
          db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(conv.id)
        );
        const incomingUnread = msgs.filter(m => m.sender_address.toLowerCase() !== currentClient.address && m.status === 'unread');
        const lastMsg = msgs[msgs.length - 1];
        
        decoratedConvs.push({
          ...conv,
          unread_count: incomingUnread.length,
          last_message_text: lastMsg ? lastMsg.body_text : '',
          last_message_status: lastMsg ? lastMsg.status : null,
          last_message_sender: lastMsg ? lastMsg.sender_address : null,
          last_message_timestamp: lastMsg ? lastMsg.timestamp : conv.last_message_at
        });
      }
      decoratedConvs.sort((a, b) => b.last_message_timestamp - a.last_message_timestamp);
      setConversations(decoratedConvs);

      // Fetch group message statuses if any
      const gms = await currentClient.db.read(db => db.prepare('SELECT * FROM group_message_status').all());
      setGroupMessageStatuses(gms || []);

      if (activeId) {
        const msgs = await currentClient.db.read(db =>
          db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(activeId)
        );
        console.warn("[Context] refreshData for activeId:", activeId, "retrieved messages:", msgs);
        setMessages(msgs || []);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error("[Context] Data sync failed:", err.message);
    }
  }, [client, activeConversationId]);

  const syncProfiles = useCallback(async (currentClient = client) => {
    if (!currentClient) return;
    try {
      const convs = await currentClient.db.read(db => db.prepare('SELECT * FROM conversations').all());
      const identifiers = new Set();
      
      // Add all DM conversation IDs
      (convs || []).forEach(c => {
        if (c.is_group !== 1) {
          identifiers.add(c.id.toLowerCase());
        }
      });
      
      // Add all group members
      const groups = await currentClient.db.read(db => db.prepare('SELECT members FROM groups').all());
      (groups || []).forEach(g => {
        try {
          const membersList = JSON.parse(g.members);
          if (Array.isArray(membersList)) {
            membersList.forEach(m => {
              if (m) identifiers.add(m.toLowerCase());
            });
          }
        } catch (e) {
          console.error("Failed to parse group members:", e);
        }
      });

      const idList = Array.from(identifiers);
      if (idList.length === 0) return;

      const res = await fetch(`${serverUrl}/users/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: idList })
      });
      const data = await res.json();
      if (data.success && data.profiles) {
        let updatedAny = false;
        await currentClient.db.write(async (db) => {
          for (const conv of convs) {
            if (conv.is_group === 1) continue;
            const profile = data.profiles[conv.id.toLowerCase()];
            if (profile) {
              if (conv.username !== profile.username ||
                  conv.hide_wallet !== (profile.hide_wallet ? 1 : 0) ||
                  conv.bio !== profile.bio ||
                  conv.pfp !== profile.pfp) {
                
                db.prepare(`
                  UPDATE conversations 
                  SET username = ?, hide_wallet = ?, bio = ?, pfp = ? 
                  WHERE id = ?
                `).run(
                  profile.username,
                  profile.hide_wallet ? 1 : 0,
                  profile.bio,
                  profile.pfp,
                  conv.id
                );
                updatedAny = true;
              }
            }
          }
        });

        // Update username cache in frontend for all profiles fetched (both DM and group members)
        Object.keys(data.profiles).forEach(id => {
          const p = data.profiles[id];
          updateUsernameCache(id, p.username, p.hide_wallet, p.bio, p.pfp);
        });

        if (updatedAny) {
          await refreshData(currentClient);
        }
      }
    } catch (err) {
      console.error("Failed to sync profiles:", err);
    }
  }, [client, serverUrl, updateUsernameCache, refreshData]);

  // Connect client to websocket and initialize listeners
  const connectClient = useCallback(async (targetClient = client) => {
    if (!targetClient) return;
    try {
      setError(null);
      setBootPhase('connecting');
      await wakeUpServer();
      await targetClient.connect();
      setConnected(true);
      await refreshData(targetClient);
      
      // Sync profiles in background
      syncProfiles(targetClient);
      
      // Initialize Push notifications in background
      import('./pushManager.js').then(({ initPushNotifications }) => {
        initPushNotifications(targetClient);
      }).catch(err => console.error("Failed to load pushManager:", err));
      
    } catch (err) {
      console.error("[Context] Connection failed:", err.message);
      setError("Failed to connect to relay server: " + err.message);
      setConnected(false);
      if (err.message.includes("refresh token") || err.message.includes("re-authenticate") || err.message.includes("session token") || err.message.includes("401") || err.message.includes("expired") || err.message.includes("Invalid session token")) {
        console.warn("[Context] Session credentials expired or invalid. Setting sessionExpired = true...");
        setSessionExpired(true);
      }
    }
  }, [client, refreshData, syncProfiles, wakeUpServer]);

  const refreshDataRef = useRef(refreshData);
  const connectClientRef = useRef(connectClient);

  useEffect(() => {
    refreshDataRef.current = refreshData;
  }, [refreshData]);

  useEffect(() => {
    connectClientRef.current = connectClient;
  }, [connectClient]);

  const registeredRef = useRef(registered);
  useEffect(() => {
    registeredRef.current = registered;
  }, [registered]);

  // Handle SDK client event subscriptions
  useEffect(() => {
    if (!client) return;

    const handleMessage = async (msg) => {
      console.log("[Context] Received real-time message:", msg);
      if (msg.senderUsername) {
        updateUsernameCache(msg.from, msg.senderUsername, msg.senderHideWallet, msg.senderBio, msg.senderPfp);
      }
      await refreshDataRef.current(client);
    };

    const handleReadReceipt = async (payload) => {
      console.log("[Context] Received read receipt:", payload);
      await refreshDataRef.current(client);
    };

    const handleMessageStatus = async (payload) => {
      console.log("[Context] Received message status update:", payload);
      await refreshDataRef.current(client);
    };

    const handleStatus = (status) => {
      console.log("[Context] SDK status transition:", status);
      setConnected(status === 'connected');
    };

    client.on('message', handleMessage);
    client.on('readReceipt', handleReadReceipt);
    client.on('messageStatus', handleMessageStatus);
    client.on('status', handleStatus);

    // Auto-connect if already registered
    if (registeredRef.current) {
      connectClientRef.current(client);
    }

    return () => {
      client.off('message', handleMessage);
      client.off('readReceipt', handleReadReceipt);
      client.off('messageStatus', handleMessageStatus);
      client.off('status', handleStatus);
      client.disconnect();
    };
  }, [client]);

  // Refresh messages list when active chat changes
  useEffect(() => {
    if (client && activeConversationId) {
      refreshData(client, activeConversationId);
    }
  }, [client, activeConversationId, refreshData]);

  // Mark active conversation messages as read and send read receipts
  const markActiveConversationAsRead = useCallback(async (activeId = activeConversationId) => {
    if (!client || !connected || !activeId) return;
    try {
      const msgs = await client.db.read(db =>
        db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(activeId)
      );
      const unreadMsgs = msgs.filter(m => m.sender_address.toLowerCase() !== client.address && m.status === 'unread');
      
      if (unreadMsgs.length > 0) {
        const unreadIds = unreadMsgs.map(m => m.id);
        
        // Update local database status to 'read'
        await client.markConversationAsRead(activeId);
        
        // Notify peer/group via read receipt
        try {
          const isGroup = conversations.find(c => c.id === activeId)?.is_group === 1;
          if (isGroup) {
            await client.sendGroupReadReceipt(activeId, unreadIds);
          } else {
            await client.sendReadReceipt(activeId, unreadIds);
          }
        } catch (receiptErr) {
          console.warn("Failed to send read receipt to peer/group:", receiptErr.message);
        }
        
        // Refresh conversations & messages
        await refreshData(client, activeId);
      } else {
        // If DB has no unread messages but React state still has them, sync React state from DB to prevent loops
        await refreshData(client, activeId);
      }
    } catch (err) {
      console.error("Error marking active conversation as read:", err.message);
    }
  }, [client, connected, conversations, activeConversationId, refreshData]);

  useEffect(() => {
    if (client && connected && activeConversationId) {
      const hasUnread = messages.some(m => m.sender_address.toLowerCase() !== client.address && m.status === 'unread');
      if (hasUnread) {
        markActiveConversationAsRead(activeConversationId);
      }
    }
  }, [client, connected, activeConversationId, messages, markActiveConversationAsRead]);

  // 1. User Registration Action
  const registerUser = async (usernameInput) => {
    if (!client) throw new Error("Client not initialized.");
    setLoading(true);
    setError(null);
    try {
      await wakeUpServer();
      await client.register(usernameInput);
      setUsername(usernameInput);
      setRegistered(true);
      await connectClient(client);
      await refreshData(client);
      setLoading(false);
    } catch (err) {
      console.error("[Context] Registration error:", err.message);
      setError("Registration failed: " + err.message);
      setLoading(false);
      if (err.message && err.message.toLowerCase().includes("already registered")) {
        setWalletRegisteredOnServer(true);
      }
      throw err;
    }
  };

  // 2. Send E2EE Direct Message
  const sendDirectMessage = async (recipientAddress, text, recipientUsername = null, recipientHideWallet = null, recipientBio = null, recipientPfp = null) => {
    if (!client) throw new Error("Client is offline or uninitialized.");
    try {
      const res = await client.sendMessage(recipientAddress, text, null, recipientUsername, recipientHideWallet, recipientBio, recipientPfp);
      await refreshData(client);
      return res;
    } catch (err) {
      console.error("[Context] Send message error:", err.message);
      setError("Failed to send message: " + err.message);
      throw err;
    }
  };

  // Send media file message
  const sendMediaMessage = async (recipientAddress, fileBuffer, mimeType, onProgress = null) => {
    if (!client) throw new Error("Client is offline or uninitialized.");
    try {
      const res = await client.sendMediaMessage(recipientAddress, fileBuffer, mimeType, onProgress);
      await refreshData(client);
      return res;
    } catch (err) {
      console.error("[Context] Send media message error:", err.message);
      setError("Failed to send media: " + err.message);
      throw err;
    }
  };

  // Download media
  const downloadMedia = async (manifest, onProgress = null, signal = null) => {
    if (!client) throw new Error("Client is offline or uninitialized.");
    try {
      return await client.downloadMedia(manifest, onProgress, signal);
    } catch (err) {
      console.error("[Context] Download media error:", err.message);
      setError("Failed to download media: " + err.message);
      throw err;
    }
  };

  // 3. Send E2EE Group Message (Multicast)
  const sendGroupMessage = async (groupId, text) => {
    if (!client) throw new Error("Client is offline or uninitialized.");
    try {
      const res = await client.sendGroupMessage(groupId, text);
      await refreshData(client);
      return res;
    } catch (err) {
      console.error("[Context] Send group message error:", err.message);
      setError("Failed to send group message: " + err.message);
      throw err;
    }
  };

  // 4. Create E2EE Group Chat
  const createGroup = async (groupName, membersList) => {
    if (!client) throw new Error("Client not initialized.");
    try {
      const { groupId } = await client.createGroup(groupName, membersList);
      await refreshData(client);
      setActiveConversationId(groupId);
      return groupId;
    } catch (err) {
      console.error("[Context] Create group error:", err.message);
      setError("Failed to create group: " + err.message);
      throw err;
    }
  };

  // 5. Database Backup Export
  const exportBackup = async (passphrase) => {
    if (!client) throw new Error("Client not initialized.");
    return client.exportBackup(passphrase);
  };

  // 6. Database Backup Import
  const importBackup = async (passphrase, backupJSON) => {
    if (!client) throw new Error("Client not initialized.");
    setLoading(true);
    try {
      await client.importBackup(passphrase, backupJSON);
      
      // Reload registration states from database metadata
      const isReg = await client.getMetadata('registered') === 'true';
      setRegistered(isReg);
      if (isReg) {
        const storedUsername = await client.getMetadata('username');
        setUsername(storedUsername || '');
        // Connect automatically since DB contains credentials
        await connectClient(client);
      }
      
      await refreshData(client);
      setLoading(false);
      return true;
    } catch (err) {
      console.error("[Context] Backup import error:", err.message);
      setError("Failed to import database backup: " + err.message);
      setLoading(false);
      throw err;
    }
  };

  // 7. Manual reconnect trigger
  const reconnect = async () => {
    if (client) {
      await connectClient(client);
    }
  };

  // 8. Wipe data for demo testing
  const logout = async () => {
    setLoading(true);
    try {
      localStorage.setItem('decentrachat_explicit_disconnect', 'true');
      if (client) {
        try {
          client.disconnect();
        } catch (discErr) {
          console.warn("Client disconnect warning:", discErr);
        }
        try {
          const dbName = `wallet_db_${client.address.substring(0, 10).toLowerCase()}`;
          localStorage.removeItem(`decentrachat_db_${dbName}`);
        } catch (dbErr) {
          console.warn("Database storage remove warning:", dbErr);
        }
      }
    } catch (err) {
      console.error("Logout error during client cleanup:", err);
    } finally {
      localStorage.removeItem('decentrachat_wallet_private');
      localStorage.removeItem('decentrachat_last_wallet_address');
      window.location.reload();
    }
  };

  const updateProfile = async (newUsername, newBio, newPfp) => {
    if (!client || !client.socket) throw new Error("Client is not connected.");
    return new Promise((resolve, reject) => {
      client.socket.emit('updateProfile', {
        username: newUsername,
        bio: newBio,
        pfp: newPfp,
        stealthMode,
        hideWallet: hideWalletAddress
      }, async (res) => {
        if (res && res.success) {
          setUsername(res.username);
          setBio(newBio || '');
          setPfp(newPfp || null);
          setUsernameChangesCount(res.usernameChangesCount || 0);
          setLastUsernameChangeAt(res.lastUsernameChangeAt || null);
          
          await client.setMetadata('username', res.username);
          await client.setMetadata('bio', newBio || '');
          await client.setMetadata('pfp', newPfp || '');
          
          resolve(res);
        } else {
          reject(new Error(res ? res.error : "Failed to update profile."));
        }
      });
    });
  };

  const deleteAccountAction = async () => {
    if (!client) throw new Error("Client not initialized.");
    await client.wipeAccountFromPeers();
    localStorage.setItem('decentrachat_explicit_disconnect', 'true');
    localStorage.removeItem('decentrachat_wallet_private');
    localStorage.removeItem('decentrachat_last_wallet_address');
    window.location.reload();
  };

  return (
    <DecentraChatContext.Provider
      value={{
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
        client,
        connectWalletAction,
        isWeb3Available,
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
        refreshData
      }}
    >
      {children}
    </DecentraChatContext.Provider>
  );
};
