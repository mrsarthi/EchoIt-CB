// App.jsx - Main Application Component
import { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from './context/WalletContext';
import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { UsernameSetup } from './components/UsernameSetup';
import { initSocket, register, disconnect, updatePushToken } from './services/socketService';
import { getStoredKeys, clearKeys } from './crypto/keyManager';
import { clearAllData } from './services/storageService';
import { UpdateManager } from './components/UpdateManager';
import { platform, notifyUpdateReady } from './services/platformService';
import { initPushNotifications } from './services/pushService';
import React, { Component } from 'react';
import './styles/index.css';

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
  const { address, isConnected } = useWallet();
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('decentrachat_username') || null;
  });
  const [showUsernameSetup, setShowUsernameSetup] = useState(false);
  const [isSocketReady, setIsSocketReady] = useState(false);

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
        // Initialize socket
        initSocket();

        // Get encryption keys
        const keys = await getStoredKeys();
        if (!keys || !mounted) return;

        // Register with server
        const storedUsername = localStorage.getItem('decentrachat_username');
        const storedAvatar = localStorage.getItem('decentrachat_avatar') || undefined;
        const storedStatus = localStorage.getItem('decentrachat_status') || undefined;
        await register(address, keys.publicKey, storedUsername, storedAvatar, storedStatus);

        if (mounted) {
          setIsSocketReady(true);
          
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
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isConnected, address]);

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
        <div className="wallet-connect-container">
          <div className="wallet-card glass-card animate-fadeIn">
            <div className="spinner" style={{ width: '40px', height: '40px', margin: '0 auto' }}></div>
            <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Connecting to network...</p>
          </div>
        </div>
      );
    }

    if (showUsernameSetup) {
      return <UsernameSetup onComplete={handleUsernameComplete} />;
    }

    return (
      <>
        <WalletConnect username={username} />
        <ChatInterface walletAddress={address} username={username} onDeleteAccount={handleDeleteAccount} />
      </>
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
