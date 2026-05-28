import React, { useState } from 'react';
import { 
    Shield, 
    Wallet, 
    Cloud, 
    Lock, 
    Fingerprint, 
    Bell, 
    Download, 
    Trash2,
    Copy,
    ChevronRight,
    Smartphone
} from 'lucide-react';
import './SettingsTab.css';

const PINATA_JWT_KEY = 'decentrachat_pinata_jwt';

export function SettingsTab({ walletAddress, username, onDeleteAccount }) {
    const [pinataJwt, setPinataJwt] = useState(() => localStorage.getItem(PINATA_JWT_KEY) || '');
    const [copied, setCopied] = useState(false);

    const handlePinataChange = (e) => {
        const val = e.target.value;
        setPinataJwt(val);
        localStorage.setItem(PINATA_JWT_KEY, val);
    };

    const copyAddress = () => {
        navigator.clipboard.writeText(walletAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleBackupIdentity = async () => {
        try {
            const { getStoredKeys } = await import('../crypto/keyManager');
            const keys = await getStoredKeys();
            if (!keys) {
                alert("No keys found to backup. Ensure you are fully logged in.");
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(keys, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `decentrachat_keys_${walletAddress?.slice(0, 6)}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        } catch (err) {
            console.error("Backup failed", err);
            alert("Failed to backup identity.");
        }
    };

    return (
        <div className="settings-tab-container animate-fadeIn">
            {/* Account Overview */}
            <div className="settings-profile-section">
                <div className="settings-avatar-wrapper">
                    <div className="avatar avatar-lg">
                        {username ? username[0].toUpperCase() : 'A'}
                    </div>
                    <div className="trust-indicator-badge">
                        <Shield size={12} className="text-trust" />
                    </div>
                </div>
                <h2>{username || 'Anonymous User'}</h2>
                <div className="wallet-pill" onClick={copyAddress}>
                    <Wallet size={14} />
                    <code>{walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}</code>
                    {copied ? <span className="text-xs text-trust">Copied!</span> : <Copy size={12} />}
                </div>
            </div>

            <div className="settings-scroll-area">
                {/* Security Section */}
                <div className="settings-group">
                    <h3 className="settings-group-title">Security & Privacy</h3>
                    <div className="settings-list">
                        <div className="settings-item">
                            <div className="settings-item-icon">
                                <Lock size={20} />
                            </div>
                            <div className="settings-item-content">
                                <span className="settings-item-label">End-to-End Encryption</span>
                                <span className="settings-item-sub">Double Ratchet & Epochs Active</span>
                            </div>
                            <Shield size={16} className="text-trust" />
                        </div>
                        <div className="settings-item" onClick={() => alert('Coming soon: Biometrics & PIN Lock configuration')} style={{ cursor: 'pointer' }}>
                            <div className="settings-item-icon">
                                <Fingerprint size={20} />
                            </div>
                            <div className="settings-item-content">
                                <span className="settings-item-label">App Authentication</span>
                                <span className="settings-item-sub">Biometrics & PIN Lock</span>
                            </div>
                            <ChevronRight size={16} className="text-muted" />
                        </div>
                    </div>
                </div>

                {/* Storage Section */}
                <div className="settings-group">
                    <h3 className="settings-group-title">Storage & Media</h3>
                    <div className="settings-list">
                        <div className="settings-item col">
                            <div className="settings-item-header">
                                <div className="settings-item-icon">
                                    <Cloud size={20} />
                                </div>
                                <div className="settings-item-content">
                                    <span className="settings-item-label">Decentralized Storage</span>
                                    <span className="settings-item-sub">IPFS Media Hosting (Pinata)</span>
                                </div>
                            </div>
                            <div className="pinata-input-wrapper">
                                <input 
                                    type="password" 
                                    value={pinataJwt}
                                    onChange={handlePinataChange}
                                    placeholder="Pinata JWT Key"
                                    className="input"
                                />
                                <p className="input-hint">Locally encrypted before upload</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Preferences Section */}
                <div className="settings-group">
                    <h3 className="settings-group-title">System</h3>
                    <div className="settings-list">
                        <div className="settings-item" onClick={() => alert('Coming soon: Push Notifications configuration')} style={{ cursor: 'pointer' }}>
                            <div className="settings-item-icon">
                                <Bell size={20} />
                            </div>
                            <div className="settings-item-content">
                                <span className="settings-item-label">Notifications</span>
                                <span className="settings-item-sub">FCM Background Wake</span>
                            </div>
                            <ChevronRight size={16} className="text-muted" />
                        </div>
                        <div className="settings-item" onClick={handleBackupIdentity} style={{ cursor: 'pointer' }}>
                            <div className="settings-item-icon">
                                <Download size={20} />
                            </div>
                            <div className="settings-item-content">
                                <span className="settings-item-label">Backup Identity</span>
                                <span className="settings-item-sub">Export Private Keys</span>
                            </div>
                            <ChevronRight size={16} className="text-muted" />
                        </div>
                    </div>
                </div>

                {/* Danger Zone */}
                <div className="settings-group">
                    <h3 className="settings-group-title text-error">Account Actions</h3>
                    <div className="settings-list">
                        <button className="settings-item danger" onClick={onDeleteAccount}>
                            <div className="settings-item-icon">
                                <Trash2 size={20} />
                            </div>
                            <div className="settings-item-content">
                                <span className="settings-item-label">Delete Account</span>
                                <span className="settings-item-sub">Wipe all local data and sessions</span>
                            </div>
                        </button>
                    </div>
                </div>

                <div className="settings-footer">
                    <div className="flex items-center gap-sm justify-center text-muted">
                        <Smartphone size={14} />
                        <span className="text-xs">Version 2.1.3 Premium Redesign</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
