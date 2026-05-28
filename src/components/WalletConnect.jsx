import { useState } from 'react';
import { Wallet, Lock, Shield, Zap, ExternalLink, Copy, Check } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import './WalletConnect.css';

export function WalletConnect() {
    const {
        address,
        formattedAddress,
        isConnecting,
        isConnected,
        error,
        isWeb3Detected,
        isElectron,
        isSolvingPoW,
        connect,
        disconnect,
    } = useWallet();

    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    if (!isWeb3Detected) {
        return (
            <main className="wallet-connect-container">
                <div className="wallet-card animate-fadeIn">
                    <div className="wallet-icon-wrapper">
                        <Wallet size={48} className="text-primary" />
                    </div>
                    <h2>Wallet Required</h2>
                    <p className="text-secondary">
                        Install MetaMask or a compatible Web3 wallet to access DecentraChat.
                    </p>
                    <a
                        href="https://metamask.io/download/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary full-width"
                    >
                        Get MetaMask <ExternalLink size={16} />
                    </a>
                </div>
            </main>
        );
    }

    if (!isConnected) {
        return (
            <main className="wallet-connect-container">
                <div className="wallet-card animate-fadeIn">
                    <div className="logo-section">
                        <div className="logo-icon-wrapper">
                            <Lock size={32} className="text-trust" />
                        </div>
                        <h1 className="logo-text">DecentraChat</h1>
                        <p className="tagline">Secure • Private • Decentralized</p>
                    </div>

                    <div className="features-list">
                        <div className="feature-item">
                            <Shield size={20} className="text-primary" />
                            <span>Blockchain Identity</span>
                        </div>
                        <div className="feature-item">
                            <Lock size={20} className="text-trust" />
                            <span>End-to-End Encrypted</span>
                        </div>
                        <div className="feature-item">
                            <Zap size={20} className="text-warning" />
                            <span>No Central Server</span>
                        </div>
                    </div>

                    <button
                        className="btn btn-primary connect-btn full-width"
                        onClick={connect}
                        disabled={isConnecting || isSolvingPoW}
                    >
                        {isSolvingPoW ? (
                            <>
                                <div className="spinner-small"></div>
                                Securing Identity...
                            </>
                        ) : isConnecting ? (
                            <>
                                <div className="spinner-small"></div>
                                {isElectron ? 'Check MetaMask...' : 'Connecting...'}
                            </>
                        ) : (
                            <>
                                <Wallet size={18} />
                                {isElectron ? 'Connect MetaMask' : 'Connect Wallet'}
                            </>
                        )}
                    </button>

                    {error && (
                        <div className="error-message">
                            {error}
                        </div>
                    )}
                </div>
            </main>
        );
    }

    // Connected state - simple status bar
    return (
        <header className="wallet-connected-bar animate-fadeIn">
            <div className="wallet-info">
                <div className="avatar avatar-sm">
                    {address.slice(2, 4).toUpperCase()}
                </div>
                <div className="wallet-details">
                    <div className="flex items-center gap-sm">
                        <span className="wallet-address">{formattedAddress}</span>
                        <button className="icon-btn-sm" onClick={handleCopy} aria-label="Copy Address">
                            {copied ? <Check size={12} className="text-trust" /> : <Copy size={12} />}
                        </button>
                    </div>
                </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>
                Disconnect
            </button>
        </header>
    );
}
