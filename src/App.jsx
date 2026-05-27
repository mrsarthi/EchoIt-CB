// App.jsx - Main Application Component
import { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from './context/WalletContext';
import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { UsernameSetup } from './components/UsernameSetup';
import { initSocket, register, disconnect, updatePushToken } from './services/socketService';
import { getStoredKeys, clearKeys } from './crypto/keyManager';
import { signMessage } from './blockchain/web3Provider';
import { clearAllData } from './services/storageService';
import { UpdateManager } from './components/UpdateManager';
import { platform, notifyUpdateReady } from './services/platformService';
import { initPushNotifications } from './services/pushService';
import React, { Component } from 'react';
import './styles/index.css';
import { hashArgon2 } from './crypto/argon2Client';

// Apply persisted font size on load
const savedFontSize = localStorage.getItem('decentrachat_font_size');
if (savedFontSize) {
  document.documentElement.style.fontSize = `${savedFontSize}px`;
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("UI CRAHSED:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'white', background: '#e11d48', height: '100vh', overflowY: 'auto' }}>
          <h2>App Crashed!</h2>
          <p>{this.state.error && this.state.error.toString()}</p>
          <pre style={{ fontSize: '10px', marginTop: '10px', color: '#ffcccb' }}>
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '20px', padding: '10px', background: 'white', color: 'black' }}>Reload App</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { isConnected, address, pushToken } = useWallet();
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('decentrachat_username') || null;
  });
  const [showUsernameSetup, setShowUsernameSetup] = useState(false);
  const [isSocketReady, setIsSocketReady] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [isSolvingPoW, setIsSolvingPoW] = useState(false);

  const solveProofOfWork = async (challenge, addr) => {
    setIsSolvingPoW(true);
    try {
      const hash = await hashArgon2(challenge, (addr || address).slice(0, 16));
      return hash;
    } finally {
      setIsSolvingPoW(false);
    }
  };

  useEffect(() => {
    // Inform Capacitor Updater that the JS bundle successfully booted!
    // This MUST happen before Capgo's 10-second rollback timer expires.
    notifyUpdateReady();
  }, []);

  // Initialize socket and register when wallet connects
  useEffect(() => {
    if (!isConnected || !address) return;

    let mounted = true;

    (async () => {
      try {
        setConnectionError(null);
        // Initialize socket
        initSocket();

        // Get encryption keys
        const keys = await getStoredKeys();
        if (!keys || !mounted) return;

        // Register with server using V3 challenge-response + PoW
        const storedUsername = localStorage.getItem('decentrachat_username');
        const storedAvatar = localStorage.getItem('decentrachat_avatar') || undefined;
        const storedStatus = localStorage.getItem('decentrachat_status') || undefined;
        
        console.log('🛡️ Starting V3 Registration Flow...');
        await register(
          address, 
          keys.publicKey, 
          keys.signingPublicKey, 
          storedUsername, 
          storedAvatar, 
          storedStatus,
          signMessage,
          solveProofOfWork,
          pushToken
        );

        if (mounted) {
          setIsSocketReady(true);
          setIsSolvingPoW(false);
          
          // Setup push notifications
          initPushNotifications((token) => {
              updatePushToken(token);
          });

          // Force show username setup if missing
          if (!storedUsername) {
            setShowUsernameSetup(true);
          }
        }
      } catch (err) {
        console.error('Failed to initialize:', err);
        if (mounted) {
            setConnectionError(err.message || 'Failed to connect to signaling server.');
            setIsSolvingPoW(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isConnected, address, pushToken]);

  const handleUsernameComplete = (newUsername) => {
    setUsername(newUsername);
    setShowUsernameSetup(false);
  };



  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your account?\n\n' +
      'This will permanently erase:\n' +
      '• All your messages\n' +
      '• Your contacts\n' +
      '• Your encryption keys\n\n' +
      'This action cannot be undone.'
    );
    if (!confirmed) return;

    try {
      // 1. Clear encryption keys
      await clearKeys();
      // 2. Clear all local chat data (messages, contacts)
      await clearAllData();
      // 3. Clear localStorage items
      localStorage.removeItem('decentrachat_address');
      localStorage.removeItem('decentrachat_username');
      // 4. Disconnect from server
      disconnect();
      // 5. Reload app to reset to login
      window.location.reload();
    } catch (err) {
      console.error('Failed to delete account:', err);
      alert('Failed to delete account. Please try again.');
    }
  };

  const content = (() => {
    if (!isConnected) {
      return <WalletConnect />;
    }

    if (!isSocketReady) {
      return (
        <main className="wallet-connect-container">
          <div className="wallet-card glass-card animate-fadeIn">
            {connectionError ? (
                <>
                    <div style={{ color: '#ef4444', marginBottom: '16px', textAlign: 'center' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    </div>
                    <h3 style={{ margin: '0 0 8px 0', color: 'white' }}>Connection Failed</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>{connectionError}</p>
                    <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ width: '100%' }}>Retry Connection</button>
                </>
            ) : (
                <>
                    <div className="spinner" style={{ width: '40px', height: '40px', margin: '0 auto' }}></div>
                    <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>
                        {isSolvingPoW ? 'Solving security puzzle...' : 'Connecting to network...'}
                    </p>
                    {isSolvingPoW && (
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                            This helps prevent spam and protect the network.
                        </p>
                    )}
                </>
            )}
          </div>
        </main>
      );
    }

    if (showUsernameSetup) {
      return <UsernameSetup onComplete={handleUsernameComplete} />;
    }

    return (
      <ChatInterface walletAddress={address} username={username} onDeleteAccount={handleDeleteAccount} />
    );
  })();

  return (
    <div className={`app platform-${platform.type}`}>
      {content}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <WalletProvider>
        <UpdateManager />
        <AppContent />
      </WalletProvider>
    </ErrorBoundary>
  );
}

export default App;
